// ─────────────────────────────────────────────────────────────────────────────
// DataManager.ts — Single source of truth for all data operations.
//
// Responsibilities:
//   1. Read/write data.json (primary fast store)
//   2. Sync completions to Daily Note YAML frontmatter (backup layer)
//   3. Recover data.json from Daily Notes if it's lost or corrupted
//   4. Compute streak statistics on demand
//   5. Write/update HabitTracker_Config.md (metadata backup)
// ─────────────────────────────────────────────────────────────────────────────

import { App, TFile, normalizePath } from "obsidian";
import moment from "moment";
import type {
	Habit,
	HabitData,
	HabitTrackerSettings,
	StreakStats,
} from "./types";

const DATA_VERSION = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's date as an ISO string "YYYY-MM-DD" */
export function todayISO(): string {
	return moment().format("YYYY-MM-DD");
}

/**
 * Given an array of sorted ISO date strings, compute streak stats.
 * O(n) single pass — called on every render, not stored.
 */
export function computeStreakStats(completions: string[]): StreakStats {
	if (completions.length === 0) {
		return {
			currentStreak: 0,
			bestStreak: 0,
			totalCompletions: 0,
			lastCompletedDate: null,
		};
	}

	// Work with a deduplicated, sorted copy
	const dates = [...new Set(completions)].sort();
	const total = dates.length;
	const today = todayISO();
	const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");

	let bestStreak = 1;
	let runStreak = 1;

	// Walk forward through the sorted date array
	for (let i = 1; i < dates.length; i++) {
		const diff = moment(dates[i]).diff(moment(dates[i - 1]), "days");
		if (diff === 1) {
			runStreak++;
			if (runStreak > bestStreak) bestStreak = runStreak;
		} else {
			runStreak = 1;
		}
	}

	// Current streak: walk backward from today
	let current = 0;
	const lastDate = dates[dates.length - 1];

	// Streak is alive if the last completion is today or yesterday
	if (lastDate === today || lastDate === yesterday) {
		current = 1;
		for (let i = dates.length - 2; i >= 0; i--) {
			const diff = moment(dates[i + 1]).diff(moment(dates[i]), "days");
			if (diff === 1) {
				current++;
			} else {
				break;
			}
		}
	}

	// Edge: bestStreak should always be >= current
	if (current > bestStreak) bestStreak = current;

	return {
		currentStreak: current,
		bestStreak,
		totalCompletions: total,
		lastCompletedDate: lastDate,
	};
}

/**
 * Returns a new array sorted ascending — never mutates in place.
 * Used to keep completions tidy after every toggle.
 */
function sortedUnique(dates: string[]): string[] {
	return [...new Set(dates)].sort();
}

// ── DataManager class ─────────────────────────────────────────────────────────

export class DataManager {
	private app: App;
	private settings: HabitTrackerSettings;

	/** In-memory cache — always in sync with what's on disk */
	private cache: HabitData | null = null;

	constructor(app: App, settings: HabitTrackerSettings) {
		this.app = app;
		this.settings = settings;
	}

	// ── Settings hot-reload ──────────────────────────────────────────────────

	updateSettings(settings: HabitTrackerSettings): void {
		this.settings = settings;
	}

	// ── Core JSON persistence ────────────────────────────────────────────────

	/**
	 * Load data.json from the plugin's internal storage directory.
	 * Obsidian exposes this through `this.app.vault.adapter` at the path
	 * `.obsidian/plugins/habitgrid-by-bishwaa/data.json`. We read it ourselves so we
	 * can cache it and perform partial updates without round-tripping.
	 *
	 * NOTE: In the actual plugin class (main.ts) we call `this.loadData()` which
	 * Obsidian manages for us. DataManager mirrors that for direct vault access.
	 */
	async load(): Promise<HabitData> {
		if (this.cache) return this.cache;

		try {
			const raw = await this.app.vault.adapter.read(this.getDataPath());
			const parsed: HabitData = JSON.parse(raw);
			this.cache = this.migrate(parsed);
			return this.cache;
		} catch {
			// First run or corrupted file — start fresh
			const empty = this.emptyData();
			this.cache = empty;
			await this.persist();
			return empty;
		}
	}

	/** Flush the in-memory cache back to data.json */
	async persist(): Promise<void> {
		if (!this.cache) return;
		this.cache.lastModified = new Date().toISOString();
		const json = JSON.stringify(this.cache, null, 2);
		await this.app.vault.adapter.write(this.getDataPath(), json);
	}

	private getDataPath(): string {
		return normalizePath(
			`${this.app.vault.configDir}/plugins/habitgrid-by-bishwaa/data.json`,
		);
	}

	private getMetaPath(): string {
		return normalizePath(
			`${this.app.vault.configDir}/plugins/habitgrid-by-bishwaa/meta.json`,
		);
	}

	/**
	 * Writes habit metadata (color, icon, quote, kind, target, unit, sortOrder)
	 * to meta.json alongside data.json. This file survives data.json deletion
	 * and is used by rebuildFromDailyNotes to restore full habit appearance.
	 * Counter counts are NOT stored here — they come from data.json only.
	 */
	private async writeMetaBackup(): Promise<void> {
		const data = await this.load();
		const meta: Record<
			string,
			{
				name: string;
				color: string;
				icon?: string;
				quote: string;
				kind: "boolean" | "counter";
				target?: number;
				unit?: string;
				createdDate: string;
				sortOrder: number;
				archived: boolean;
				frontmatterKey: string;
			}
		> = {};

		for (const [id, habit] of Object.entries(data.habits)) {
			meta[id] = {
				name: habit.name,
				color: habit.color,
				icon: habit.icon,
				quote: habit.quote,
				kind: habit.kind ?? "boolean",
				target: habit.target,
				unit: habit.unit,
				createdDate: habit.createdDate,
				sortOrder: habit.sortOrder,
				archived: habit.archived,
				frontmatterKey: this.habitNameToFrontmatterKey(habit.name),
			};
		}

		await this.app.vault.adapter.write(
			this.getMetaPath(),
			JSON.stringify(
				{
					version: 1,
					habits: meta,
					deletedHabitKeys: data.deletedHabitKeys,
				},
				null,
				2,
			),
		);
	}

	private async readMetaBackup(): Promise<
		Record<
			string,
			{
				name: string;
				color: string;
				icon?: string;
				quote: string;
				kind: "boolean" | "counter";
				target?: number;
				unit?: string;
				createdDate: string;
				sortOrder: number;
				archived: boolean;
				frontmatterKey: string;
			}
		>
	> {
		try {
			const raw = await this.app.vault.adapter.read(this.getMetaPath());
			const parsed = JSON.parse(raw);
			return parsed.habits ?? {};
		} catch {
			return {};
		}
	}

	private emptyData(): HabitData {
		return {
			version: DATA_VERSION,
			habits: {},
			habitOrder: [],
			uiState: {
				openHabitIds: [],
				selectedYear: new Date().getFullYear(),
				archivedSectionOpen: false,
			},
			lastModified: new Date().toISOString(),
			deletedHabitKeys: [],
			resetLog: [],
		};
	}

	private migrate(data: HabitData): HabitData {
		if (!data.version || data.version < DATA_VERSION)
			data.version = DATA_VERSION;
		if (!data.uiState)
			data.uiState = {
				openHabitIds: [],
				selectedYear: new Date().getFullYear(),
				archivedSectionOpen: false,
			};
		if (!data.deletedHabitKeys) data.deletedHabitKeys = [];
		if (!data.resetLog) data.resetLog = [];
		for (const habit of Object.values(data.habits)) {
			if (!habit.kind) habit.kind = "boolean";
		}
		return data;
	}

	// ── Habit CRUD ───────────────────────────────────────────────────────────

	async createHabit(params: {
		name: string;
		quote?: string;
		color?: string;
		icon?: string;
		kind?: "boolean" | "counter";
		target?: number;
		unit?: string;
	}): Promise<Habit> {
		const data = await this.load();

		const habit: Habit = {
			id: crypto.randomUUID(),
			name: params.name,
			quote: params.quote ?? "",
			color: params.color ?? "#6366f1",
			icon: params.icon,
			createdDate: todayISO(),
			completions: [],
			sortOrder: data.habitOrder.length,
			archived: false,
			kind: params.kind ?? "boolean",
			target: params.target,
			unit: params.unit,
			counts: params.kind === "counter" ? {} : undefined,
		};

		data.habits[habit.id] = habit;
		data.habitOrder.push(habit.id);
		await this.persist();
		this.writeMetaBackup().catch(() => {}); // fire-and-forget
		return habit;
	}

	async updateHabit(
		id: string,
		updates: Partial<
			Pick<
				Habit,
				"name" | "quote" | "color" | "icon" | "kind" | "target" | "unit"
			>
		>,
	): Promise<void> {
		const data = await this.load();
		if (!data.habits[id]) throw new Error(`Habit ${id} not found`);
		Object.assign(data.habits[id], updates);
		// If switching to counter, ensure counts map exists
		if (updates.kind === "counter" && !data.habits[id].counts) {
			data.habits[id].counts = {};
		}
		// If switching to boolean, clear counts
		if (updates.kind === "boolean") {
			data.habits[id].counts = undefined;
			data.habits[id].target = undefined;
			data.habits[id].unit = undefined;
		}
		await this.persist();
		this.writeMetaBackup().catch(() => {});
	}

	// ── Counter methods ──────────────────────────────────────────────────────

	/**
	 * Increment count for a counter habit on a given date.
	 * Returns the new count.
	 */
	async incrementCount(habitId: string, dateISO: string): Promise<number> {
		const data = await this.load();
		const habit = data.habits[habitId];
		if (!habit || habit.kind !== "counter")
			throw new Error("Not a counter habit");
		if (!habit.counts) habit.counts = {};

		habit.counts[dateISO] = (habit.counts[dateISO] ?? 0) + 1;
		const newCount = habit.counts[dateISO];

		// If reached target, add to completions (for streak math)
		const target = habit.target ?? 1;
		if (newCount >= target && !habit.completions.includes(dateISO)) {
			habit.completions = sortedUnique([...habit.completions, dateISO]);
		}

		await this.persist();

		// Always sync to HabitGrid folder
		{
			this.syncToDailyNote(habit.name, dateISO, newCount >= target).catch(
				(err) => console.warn("[HabitGrid] Sync failed:", err),
			);
		}

		return newCount;
	}

	/**
	 * Decrement count for a counter habit on a given date.
	 * Returns the new count (minimum 0).
	 */
	async decrementCount(habitId: string, dateISO: string): Promise<number> {
		const data = await this.load();
		const habit = data.habits[habitId];
		if (!habit || habit.kind !== "counter")
			throw new Error("Not a counter habit");
		if (!habit.counts) habit.counts = {};

		const current = habit.counts[dateISO] ?? 0;
		const newCount = Math.max(0, current - 1);

		if (newCount === 0) {
			delete habit.counts[dateISO];
		} else {
			habit.counts[dateISO] = newCount;
		}

		// If dropped below target, remove from completions
		const target = habit.target ?? 1;
		if (newCount < target) {
			habit.completions = habit.completions.filter((d) => d !== dateISO);
		}

		await this.persist();
		return newCount;
	}

	/** Get count for a counter habit on a specific date */
	getCount(habit: Habit, dateISO: string): number {
		return habit.counts?.[dateISO] ?? 0;
	}

	/** Get progress ratio (0–1) for a counter habit on a date */
	getProgress(habit: Habit, dateISO: string): number {
		if (habit.kind !== "counter")
			return habit.completions.includes(dateISO) ? 1 : 0;
		const count = habit.counts?.[dateISO] ?? 0;
		const target = habit.target ?? 1;
		return Math.min(1, count / target);
	}

	/**
	 * Atomically set the count for a counter habit on a given date.
	 * Much cleaner than looping increment/decrement.
	 */
	async setCount(
		habitId: string,
		dateISO: string,
		count: number,
	): Promise<void> {
		const data = await this.load();
		const habit = data.habits[habitId];
		if (!habit || habit.kind !== "counter")
			throw new Error("Not a counter habit");
		if (!habit.counts) habit.counts = {};

		if (count <= 0) {
			delete habit.counts[dateISO];
			habit.completions = habit.completions.filter((d) => d !== dateISO);
		} else {
			habit.counts[dateISO] = count;
			const target = habit.target ?? 1;
			if (count >= target && !habit.completions.includes(dateISO)) {
				habit.completions = sortedUnique([
					...habit.completions,
					dateISO,
				]);
			} else if (count < target) {
				habit.completions = habit.completions.filter(
					(d) => d !== dateISO,
				);
			}
		}

		await this.persist();

		// Always sync to HabitGrid folder with the count value
		{
			const target = habit.target ?? 1;
			this.syncToDailyNote(
				habit.name,
				dateISO,
				count >= target,
				count > 0 ? count : undefined,
			).catch((err) => console.warn("[HabitGrid] Sync failed:", err));
		}
	}

	async archiveHabit(id: string): Promise<void> {
		const data = await this.load();
		if (!data.habits[id]) return;
		data.habits[id].archived = true;
		await this.persist();
	}

	async deleteHabit(id: string): Promise<void> {
		const data = await this.load();
		const habit = data.habits[id];
		if (!habit) return;
		// Add frontmatter key to tombstone so rebuild never recreates this habit
		const key = this.habitNameToFrontmatterKey(habit.name);
		if (!data.deletedHabitKeys.includes(key)) {
			data.deletedHabitKeys.push(key);
		}
		delete data.habits[id];
		data.habitOrder = data.habitOrder.filter((hid) => hid !== id);
		await this.persist();
		this.writeMetaBackup().catch(() => {});
	}

	async reorderHabits(orderedIds: string[]): Promise<void> {
		const data = await this.load();
		data.habitOrder = orderedIds;
		orderedIds.forEach((id, i) => {
			if (data.habits[id]) data.habits[id].sortOrder = i;
		});
		await this.persist();
	}

	async getHabit(id: string): Promise<Habit | null> {
		const data = await this.load();
		const h = data.habits[id];
		if (!h) return null;
		return {
			...h,
			completions: [...h.completions],
			counts: h.counts ? { ...h.counts } : undefined,
		};
	}

	/** Returns all non-archived habits in display order */
	async getActiveHabits(): Promise<Habit[]> {
		const data = await this.load();
		return data.habitOrder
			.map((id) => data.habits[id])
			.filter((h) => h && !h.archived)
			.map((h) => ({
				...h,
				completions: [...h.completions],
				counts: h.counts ? { ...h.counts } : undefined,
			}));
	}

	/** Returns all archived habits */
	async getArchivedHabits(): Promise<Habit[]> {
		const data = await this.load();
		return Object.values(data.habits)
			.filter((h) => h.archived)
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((h) => ({
				...h,
				completions: [...h.completions],
				counts: h.counts ? { ...h.counts } : undefined,
			}));
	}

	async unarchiveHabit(id: string): Promise<void> {
		const data = await this.load();
		if (!data.habits[id]) return;
		data.habits[id].archived = false;
		// Put back at the end of the order if not already there
		if (!data.habitOrder.includes(id)) {
			data.habitOrder.push(id);
		}
		await this.persist();
	}

	// ── UI State ─────────────────────────────────────────────────────────────

	async getUIState(): Promise<{
		openHabitIds: string[];
		selectedYear: number;
		archivedSectionOpen: boolean;
	}> {
		const data = await this.load();
		return { ...data.uiState };
	}

	async saveUIState(
		state: Partial<{
			openHabitIds: string[];
			selectedYear: number;
			archivedSectionOpen: boolean;
		}>,
	): Promise<void> {
		const data = await this.load();
		data.uiState = { ...data.uiState, ...state };
		await this.persist();
	}

	// ── Completion toggling ──────────────────────────────────────────────────

	/**
	 * Core interaction: toggle a specific date for a habit.
	 * Returns the new completion state (true = now complete).
	 *
	 * This is the only method that should write completion data —
	 * all other paths (recovery, import) funnel through here or directly
	 * manipulate the completions array before calling persist().
	 */
	async toggleCompletion(habitId: string, dateISO: string): Promise<boolean> {
		const data = await this.load();
		const habit = data.habits[habitId];
		if (!habit) throw new Error(`Habit ${habitId} not found`);

		const idx = habit.completions.indexOf(dateISO);
		let isNowComplete: boolean;

		if (idx === -1) {
			habit.completions = sortedUnique([...habit.completions, dateISO]);
			isNowComplete = true;
		} else {
			habit.completions = habit.completions.filter((d) => d !== dateISO);
			isNowComplete = false;
		}

		await this.persist();

		// Always write to HabitGrid folder (fire-and-forget)
		this.syncToDailyNote(habit.name, dateISO, isNowComplete).catch((err) =>
			console.warn("[HabitGrid] Sync failed:", err),
		);

		return isNowComplete;
	}

	isCompleted(habit: Habit, dateISO: string): boolean {
		return habit.completions.includes(dateISO);
	}

	// ── HabitGrid folder ─────────────────────────────────────────────────────

	/** Full path to the HabitGrid folder, e.g. "Notes/HabitGrid" or "HabitGrid" */
	getHabitGridFolderPath(): string {
		const parent = this.settings.habitGridParentFolder?.trim();
		return normalizePath(parent ? `${parent}/HabitGrid` : "HabitGrid");
	}

	/** Creates the HabitGrid folder if it doesn't exist yet */
	async ensureHabitGridFolder(): Promise<void> {
		const path = this.getHabitGridFolderPath();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) {
			await this.app.vault.createFolder(path);
		}
	}

	/** Path to a specific date file inside the HabitGrid folder */
	private getHabitGridNotePath(dateISO: string): string {
		return normalizePath(`${this.getHabitGridFolderPath()}/${dateISO}.md`);
	}

	/**
	 * Moves all HabitGrid date files from old folder to new folder.
	 * Called when user changes habitGridParentFolder in settings.
	 */
	async moveHabitGridFolder(
		oldParent: string,
		newParent: string,
	): Promise<void> {
		const oldFolder = normalizePath(
			oldParent ? `${oldParent}/HabitGrid` : "HabitGrid",
		);
		const newFolder = normalizePath(
			newParent ? `${newParent}/HabitGrid` : "HabitGrid",
		);
		if (oldFolder === newFolder) return;

		const oldDir = this.app.vault.getAbstractFileByPath(oldFolder);
		if (!oldDir) return; // nothing to move

		// Ensure new folder exists
		await this.app.vault.createFolder(newFolder).catch(() => {});

		// Move each .md file
		const { Vault } = await import("obsidian");
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(oldFolder + "/"));
		for (const file of files) {
			const newPath = normalizePath(newFolder + "/" + file.name);
			await this.app.fileManager.renameFile(file, newPath);
		}

		// Remove old folder if empty
		try {
			await this.app.vault.delete(oldDir as any);
		} catch {
			/* ignore if not empty */
		}
	}

	// ── Daily Note / HabitGrid sync ───────────────────────────────────────────

	/**
	 * Writes habit completion data to the HabitGrid folder date file.
	 * File format:
	 *   - YAML frontmatter with tags: [habitgrid], date, and habit keys
	 *   - A warning callout so users know not to edit manually
	 */
	async syncToDailyNote(
		habitName: string,
		dateISO: string,
		completed: boolean,
		count?: number,
	): Promise<void> {
		await this.ensureHabitGridFolder();
		const notePath = this.getHabitGridNotePath(dateISO);
		const key = this.habitNameToFrontmatterKey(habitName);
		const valueStr =
			count !== undefined ? String(count) : completed ? "true" : "false";

		const existing = this.app.vault.getAbstractFileByPath(
			notePath,
		) as TFile | null;

		if (!existing) {
			if (!completed && !count) return; // Don't create file just to write false/0
			const content = this.buildHabitGridNote(dateISO, {
				[key]: valueStr,
			});
			await this.app.vault.create(notePath, content);
			return;
		}

		// Update existing file's frontmatter key
		const content = await this.app.vault.read(existing);
		if (content.startsWith("---")) {
			const endIdx = content.indexOf("---", 3);
			if (endIdx === -1) return;
			const frontmatter = content.slice(3, endIdx);
			const keyRegex = new RegExp(`^${key}:.*$`, "m");
			const newFrontmatter = keyRegex.test(frontmatter)
				? frontmatter.replace(keyRegex, `${key}: ${valueStr}`)
				: frontmatter.trimEnd() + `\n${key}: ${valueStr}\n`;
			await this.app.vault.modify(
				existing,
				"---" + newFrontmatter + "---" + content.slice(endIdx + 3),
			);
		} else {
			// Prepend frontmatter
			await this.app.vault.modify(
				existing,
				this.buildHabitGridNote(dateISO, { [key]: valueStr }) +
					"\n\n" +
					content,
			);
		}
	}

	private buildHabitGridNote(
		dateISO: string,
		habits: Record<string, string>,
	): string {
		const habitLines = Object.entries(habits)
			.map(([k, v]) => `${k}: ${v}`)
			.join("\n");
		return [
			"---",
			`date: ${dateISO}`,
			"tags: [habitgrid]",
			habitLines,
			"---",
			"",
			"> [!warning] Do not edit this file manually",
			"> This file is managed by **HabitGrid**. Manual edits may be lost or cause data conflicts. Use the HabitGrid plugin to track your habits.",
			"",
		].join("\n");
	}

	private getDailyNotePath(dateISO: string): string {
		// Kept for rebuild scanning of user's own Daily Notes folder
		const fmt = "YYYY-MM-DD";
		const filename = moment(dateISO, "YYYY-MM-DD").format(fmt);
		const folder = "";
		return normalizePath(
			folder ? `${folder}/${filename}.md` : `${filename}.md`,
		);
	}

	/**
	 * Converts a habit name to a safe YAML frontmatter key.
	 * "Morning Run" → "habit_morning_run"
	 */
	private habitNameToFrontmatterKey(name: string): string {
		return (
			"habit_" +
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "_")
				.replace(/^_|_$/g, "")
		);
	}

	// ── Recovery Engine ──────────────────────────────────────────────────────

	/**
	 * "Rebuild Habit Database" command.
	 *
	 * Scans every Daily Note in the configured folder for `habit_*` frontmatter
	 * keys and reconstructs the completions arrays. Existing habits already in
	 * data.json are merged (not overwritten), so manual edits survive.
	 *
	 * Returns a summary of what was found for display in a Notice.
	 */
	async rebuildFromDailyNotes(): Promise<{
		habitsFound: number;
		completionsRestored: number;
	}> {
		const data = await this.load();

		// Load meta backup — restores color, icon, quote, kind, target, unit
		const metaBackup = await this.readMetaBackup();

		// Build lookup: frontmatterKey → meta entry
		const keyToMeta: Record<string, (typeof metaBackup)[string]> = {};
		for (const entry of Object.values(metaBackup)) {
			if (entry.frontmatterKey) keyToMeta[entry.frontmatterKey] = entry;
		}

		// Also merge any metadata from backup into existing habits in data
		for (const [id, meta] of Object.entries(metaBackup)) {
			if (data.habits[id]) {
				// Restore appearance fields if they look default (i.e. lost)
				const h = data.habits[id];
				if (!h.color || h.color === "#6366f1") h.color = meta.color;
				if (!h.icon && meta.icon) h.icon = meta.icon;
				if (!h.quote && meta.quote) h.quote = meta.quote;
				if (!h.kind) h.kind = meta.kind;
				if (meta.kind === "counter") {
					h.target = meta.target;
					h.unit = meta.unit;
				}
			}
		}

		// Build a reverse map: frontmatter key → habit id
		const keyToId: Record<string, string> = {};
		for (const [id, habit] of Object.entries(data.habits)) {
			if (!habit.archived) {
				keyToId[this.habitNameToFrontmatterKey(habit.name)] = id;
			}
		}

		const folder = "";
		const habitGridFolder = this.getHabitGridFolderPath();

		// Scan both the user's Daily Notes folder AND the HabitGrid folder
		const files = this.app.vault.getMarkdownFiles().filter((f) => {
			if (f.path.startsWith(habitGridFolder + "/")) return true;
			if (folder) return f.path.startsWith(folder + "/");
			return true;
		});

		let completionsRestored = 0;
		const discoveredKeys = new Set<string>();

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache?.frontmatter) continue;

			const dateISO = this.parseDateFromFilename(file.basename);
			if (!dateISO) continue;

			if (data.resetAt && dateISO < data.resetAt) continue;

			for (const [key, value] of Object.entries(cache.frontmatter)) {
				if (!key.startsWith("habit_")) continue;
				if (data.deletedHabitKeys.includes(key)) continue;

				discoveredKeys.add(key);

				if (
					value !== true &&
					value !== "true" &&
					typeof value !== "number"
				)
					continue;

				let habitId = keyToId[key];

				if (!habitId) {
					// Try to restore from meta backup first
					const meta = keyToMeta[key];
					const newHabit: Habit = {
						id: crypto.randomUUID(),
						name:
							meta?.name ??
							key
								.replace(/^habit_/, "")
								.replace(/_/g, " ")
								.replace(/\b\w/g, (c) => c.toUpperCase()),
						quote: meta?.quote ?? "",
						color: meta?.color ?? "#6366f1",
						icon: meta?.icon,
						createdDate: meta?.createdDate ?? dateISO,
						completions: [],
						sortOrder: meta?.sortOrder ?? data.habitOrder.length,
						archived: false,
						kind: meta?.kind ?? "boolean",
						target: meta?.target,
						unit: meta?.unit,
						counts: meta?.kind === "counter" ? {} : undefined,
					};

					data.habits[newHabit.id] = newHabit;
					data.habitOrder.push(newHabit.id);
					keyToId[key] = newHabit.id;
					habitId = newHabit.id;
				}

				const habit = data.habits[habitId];

				if (
					habit.kind === "counter" &&
					typeof value === "number" &&
					value > 0
				) {
					// Restore counter count for this date
					if (!habit.counts) habit.counts = {};
					const existing = habit.counts[dateISO] ?? 0;
					if (value > existing) {
						habit.counts[dateISO] = value;
						completionsRestored++;
					}
					// If count meets target, also add to completions
					const target = habit.target ?? 1;
					if (
						value >= target &&
						!habit.completions.includes(dateISO)
					) {
						habit.completions.push(dateISO);
					}
				} else if (habit.kind !== "counter") {
					// Boolean habit — restore completion
					if (!habit.completions.includes(dateISO)) {
						habit.completions.push(dateISO);
						completionsRestored++;
					}
				}
			}
		}

		for (const habit of Object.values(data.habits)) {
			habit.completions = sortedUnique(habit.completions);
		}

		await this.persist();

		return {
			habitsFound: discoveredKeys.size,
			completionsRestored,
		};
	}

	private parseDateFromFilename(basename: string): string | null {
		const fmt = "YYYY-MM-DD";
		const parsed = moment(basename, fmt, true);
		if (!parsed.isValid()) return null;
		return parsed.format("YYYY-MM-DD");
	}

	// ── Heatmap data helpers ─────────────────────────────────────────────────

	getCompletionsForYear(habit: Habit, year: number): Set<string> {
		const prefix = `${year}-`;
		return new Set(habit.completions.filter((d) => d.startsWith(prefix)));
	}

	// ── Full reset ────────────────────────────────────────────────────────────

	async resetAll(): Promise<void> {
		const today = todayISO();
		const now = new Date();
		const logEntry = `${now.toISOString()}: Full reset performed`;

		const fresh: HabitData = {
			version: DATA_VERSION,
			habits: {},
			habitOrder: [],
			uiState: {
				openHabitIds: [],
				selectedYear: now.getFullYear(),
				archivedSectionOpen: false,
			},
			lastModified: now.toISOString(),
			resetAt: today,
			deletedHabitKeys: [],
			resetLog: [logEntry],
		};

		this.cache = fresh;
		await this.persist();
	}

	async getResetLog(): Promise<string[]> {
		const data = await this.load();
		return data.resetLog ?? [];
	}

	getActiveYears(habit: Habit): number[] {
		const years = new Set<number>();
		years.add(moment().year());
		for (const date of habit.completions) {
			years.add(parseInt(date.slice(0, 4)));
		}
		return [...years].sort((a, b) => a - b);
	}
}
