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
	 * `.obsidian/plugins/habit-tracker/data.json`. We read it ourselves so we
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
		// Obsidian stores plugin data at .obsidian/plugins/<id>/data.json
		// We use a dedicated file alongside it for clarity.
		return normalizePath(
			`${this.app.vault.configDir}/plugins/habit-tracker/data.json`,
		);
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
		};
	}

	/** Schema migrations */
	private migrate(data: HabitData): HabitData {
		if (!data.version || data.version < DATA_VERSION) {
			data.version = DATA_VERSION;
		}
		if (!data.uiState) {
			data.uiState = {
				openHabitIds: [],
				selectedYear: new Date().getFullYear(),
				archivedSectionOpen: false,
			};
		}
		// Backfill kind for habits created before counters existed
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
		await this.writeConfigBackup();
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
		await this.writeConfigBackup();
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

		if (this.settings.syncToDailyNotes) {
			this.syncToDailyNote(habit.name, dateISO, newCount >= target).catch(
				(err) =>
					console.warn("[HabitTracker] Daily Note sync failed:", err),
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

	async archiveHabit(id: string): Promise<void> {
		const data = await this.load();
		if (!data.habits[id]) return;
		data.habits[id].archived = true;
		await this.persist();
	}

	async deleteHabit(id: string): Promise<void> {
		const data = await this.load();
		if (!data.habits[id]) return;
		delete data.habits[id];
		data.habitOrder = data.habitOrder.filter((hid) => hid !== id);
		await this.persist();
		await this.writeConfigBackup();
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

		// Fire-and-forget the Daily Note sync — never block the UI on file I/O
		if (this.settings.syncToDailyNotes) {
			this.syncToDailyNote(habit.name, dateISO, isNowComplete).catch(
				(err) =>
					console.warn("[HabitTracker] Daily Note sync failed:", err),
			);
		}

		return isNowComplete;
	}

	isCompleted(habit: Habit, dateISO: string): boolean {
		return habit.completions.includes(dateISO);
	}

	// ── Daily Note sync ──────────────────────────────────────────────────────

	/**
	 * Appends or updates a `habit_<slug>: true/false` key in the YAML
	 * frontmatter of the Daily Note for the given date.
	 *
	 * Creates the note with minimal frontmatter if it doesn't exist yet,
	 * so the recovery engine has something to scan later.
	 */
	async syncToDailyNote(
		habitName: string,
		dateISO: string,
		completed: boolean,
	): Promise<void> {
		if (!this.settings.syncToDailyNotes) return;

		const notePath = this.getDailyNotePath(dateISO);
		const key = this.habitNameToFrontmatterKey(habitName);
		const valueStr = completed ? "true" : "false";

		let file = this.app.vault.getAbstractFileByPath(
			notePath,
		) as TFile | null;

		if (!file) {
			if (!completed) return; // Don't create a note just to write false
			await this.app.vault.create(
				notePath,
				`---\ndate: ${dateISO}\n${key}: true\n---\n`,
			);
			return;
		}

		const content = await this.app.vault.read(file);

		if (content.startsWith("---")) {
			// Update existing frontmatter
			const endIdx = content.indexOf("---", 3);
			if (endIdx === -1) return;

			const frontmatter = content.slice(3, endIdx);
			const keyRegex = new RegExp(`^${key}:.*$`, "m");

			let newFrontmatter: string;
			if (keyRegex.test(frontmatter)) {
				newFrontmatter = frontmatter.replace(
					keyRegex,
					`${key}: ${valueStr}`,
				);
			} else {
				newFrontmatter =
					frontmatter.trimEnd() + `\n${key}: ${valueStr}\n`;
			}

			const newContent =
				"---" + newFrontmatter + "---" + content.slice(endIdx + 3);
			await this.app.vault.modify(file, newContent);
		} else {
			// Prepend frontmatter to a note that doesn't have any
			const newContent = `---\ndate: ${dateISO}\n${key}: ${valueStr}\n---\n\n${content}`;
			await this.app.vault.modify(file, newContent);
		}
	}

	private getDailyNotePath(dateISO: string): string {
		const fmt = this.settings.dailyNoteDateFormat;
		const filename = moment(dateISO, "YYYY-MM-DD").format(fmt);
		const folder = this.settings.dailyNotesFolder;
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

		// Build a reverse map: frontmatter key → habit id
		const keyToId: Record<string, string> = {};
		for (const [id, habit] of Object.entries(data.habits)) {
			if (!habit.archived) {
				keyToId[this.habitNameToFrontmatterKey(habit.name)] = id;
			}
		}

		const folder = this.settings.dailyNotesFolder;
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => (folder ? f.path.startsWith(folder + "/") : true));

		let completionsRestored = 0;
		const discoveredKeys = new Set<string>();

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache?.frontmatter) continue;

			// Try to extract the date from the filename
			const basename = file.basename;
			const dateISO = this.parseDateFromFilename(basename);
			if (!dateISO) continue;

			for (const [key, value] of Object.entries(cache.frontmatter)) {
				if (!key.startsWith("habit_")) continue;
				discoveredKeys.add(key);

				if (value !== true && value !== "true") continue;

				let habitId = keyToId[key];

				// Auto-create a skeleton habit if we've never seen this key before
				if (!habitId) {
					const guessedName = key
						.replace(/^habit_/, "")
						.replace(/_/g, " ")
						.replace(/\b\w/g, (c) => c.toUpperCase());

					const newHabit: Habit = {
						id: crypto.randomUUID(),
						name: guessedName,
						quote: "",
						color: "#6366f1",
						createdDate: dateISO,
						completions: [],
						sortOrder: data.habitOrder.length,
						archived: false,
					};

					data.habits[newHabit.id] = newHabit;
					data.habitOrder.push(newHabit.id);
					keyToId[key] = newHabit.id;
					habitId = newHabit.id;
				}

				const habit = data.habits[habitId];
				if (!habit.completions.includes(dateISO)) {
					habit.completions.push(dateISO);
					completionsRestored++;
				}
			}
		}

		// Sort all completion arrays after the bulk insert
		for (const habit of Object.values(data.habits)) {
			habit.completions = sortedUnique(habit.completions);
		}

		await this.persist();
		await this.writeConfigBackup();

		return {
			habitsFound: discoveredKeys.size,
			completionsRestored,
		};
	}

	private parseDateFromFilename(basename: string): string | null {
		const fmt = this.settings.dailyNoteDateFormat;
		const parsed = moment(basename, fmt, true);
		if (!parsed.isValid()) return null;
		return parsed.format("YYYY-MM-DD");
	}

	// ── Config Backup (HabitTracker_Config.md) ───────────────────────────────

	/**
	 * Writes a human-readable markdown file containing all habit metadata
	 * (colors, icons, quotes) so it's versionable in Git and readable without
	 * the plugin. Call this after any metadata change.
	 */
	async writeConfigBackup(): Promise<void> {
		if (!this.settings.enableConfigBackup) return;

		const data = await this.load();
		const habits = data.habitOrder
			.map((id) => data.habits[id])
			.filter(Boolean);

		const lines = [
			"# HabitTracker Config Backup",
			"",
			"> Auto-generated by the Habit Tracker plugin. Do not edit manually.",
			`> Last updated: ${new Date().toLocaleString()}`,
			"",
			"## Habits",
			"",
		];

		for (const h of habits) {
			lines.push(`### ${h.name}`);
			lines.push(`- **ID:** \`${h.id}\``);
			lines.push(`- **Color:** \`${h.color}\``);
			if (h.icon) lines.push(`- **Icon:** \`${h.icon}\``);
			if (h.quote) lines.push(`- **Quote:** ${h.quote}`);
			lines.push(`- **Created:** ${h.createdDate}`);
			lines.push(`- **Archived:** ${h.archived}`);
			lines.push("");
		}

		const path = normalizePath(this.settings.configBackupPath);
		const existing = this.app.vault.getAbstractFileByPath(path);
		const content = lines.join("\n");

		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(path, content);
		}
	}

	// ── Heatmap data helpers ─────────────────────────────────────────────────

	/**
	 * Returns the Set of completion dates for a given year.
	 * The Svelte heatmap component calls this to paint cells.
	 */
	getCompletionsForYear(habit: Habit, year: number): Set<string> {
		const prefix = `${year}-`;
		return new Set(habit.completions.filter((d) => d.startsWith(prefix)));
	}

	/** Returns every year that has at least one completion, plus the current year */
	getActiveYears(habit: Habit): number[] {
		const years = new Set<number>();
		years.add(moment().year());
		for (const date of habit.completions) {
			years.add(parseInt(date.slice(0, 4)));
		}
		return [...years].sort((a, b) => a - b);
	}
}
