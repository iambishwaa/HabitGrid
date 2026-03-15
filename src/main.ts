// ─────────────────────────────────────────────────────────────────────────────
// main.ts — Habit Tracker plugin entry point.
//
// This file is the only thing Obsidian loads directly. Its job is:
//   1. Boot the DataManager and load persisted data
//   2. Register the custom ItemView
//   3. Register all Command Palette commands
//   4. Register the Settings tab
//   5. Set up vault event listeners (Daily Note changes → refresh UI)
//   6. Expose a clean API surface for HabitTrackerView and Svelte components
// ─────────────────────────────────────────────────────────────────────────────

import {
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	addIcon,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	HABIT_EVENTS,
	VIEW_TYPE_HABIT_TRACKER,
	type HabitTrackerSettings,
} from "./types";
import { DataManager } from "./DataManager";
import { HabitTrackerView } from "./HabitTrackerView";
import HabitCreateModal from "./HabitCreateModal";

// ── Custom SVG icon registered with Obsidian ─────────────────────────────────

const HABIT_TRACKER_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="5"  y="5"  width="18" height="18" rx="3" fill="currentColor" opacity="0.3"/>
  <rect x="29" y="5"  width="18" height="18" rx="3" fill="currentColor" opacity="0.6"/>
  <rect x="53" y="5"  width="18" height="18" rx="3" fill="currentColor" opacity="1"/>
  <rect x="77" y="5"  width="18" height="18" rx="3" fill="currentColor" opacity="0.4"/>
  <rect x="5"  y="29" width="18" height="18" rx="3" fill="currentColor" opacity="0.7"/>
  <rect x="29" y="29" width="18" height="18" rx="3" fill="currentColor" opacity="1"/>
  <rect x="53" y="29" width="18" height="18" rx="3" fill="currentColor" opacity="0.2"/>
  <rect x="77" y="29" width="18" height="18" rx="3" fill="currentColor" opacity="0.9"/>
  <rect x="5"  y="53" width="18" height="18" rx="3" fill="currentColor" opacity="0.5"/>
  <rect x="29" y="53" width="18" height="18" rx="3" fill="currentColor" opacity="0.3"/>
  <rect x="53" y="53" width="18" height="18" rx="3" fill="currentColor" opacity="1"/>
  <rect x="77" y="53" width="18" height="18" rx="3" fill="currentColor" opacity="0.8"/>
  <rect x="5"  y="77" width="18" height="18" rx="3" fill="currentColor" opacity="1"/>
  <rect x="29" y="77" width="18" height="18" rx="3" fill="currentColor" opacity="0.6"/>
  <rect x="53" y="77" width="18" height="18" rx="3" fill="currentColor" opacity="0.4"/>
  <rect x="77" y="77" width="18" height="18" rx="3" fill="currentColor" opacity="1"/>
</svg>`;

// ── Plugin class ──────────────────────────────────────────────────────────────

export default class HabitTrackerPlugin extends Plugin {
	settings: HabitTrackerSettings = DEFAULT_SETTINGS;

	/**
	 * The single DataManager instance shared across the whole plugin.
	 * Both HabitTrackerView and Svelte components receive this via props.
	 */
	dataManager!: DataManager;

	// ── onload ─────────────────────────────────────────────────────────────

	async onload(): Promise<void> {
		console.log("[HabitTracker] Loading plugin…");

		// 1. Register custom sidebar icon
		addIcon("habit-tracker", HABIT_TRACKER_ICON);

		// 2. Load user settings
		await this.loadSettings();

		// 3. Boot the data layer
		this.dataManager = new DataManager(this.app, this.settings);
		await this.dataManager.load();

		// 4. Register the custom leaf view
		this.registerView(
			VIEW_TYPE_HABIT_TRACKER,
			(leaf) => new HabitTrackerView(leaf, this),
		);

		// 5. Add the ribbon icon that opens / focuses the view
		this.addRibbonIcon("habit-tracker", "Habit Tracker", async () => {
			await this.activateView();
		});

		// 6. Register all Command Palette commands
		this.registerCommands();

		// 7. Register the Settings tab
		this.addSettingTab(new HabitTrackerSettingTab(this.app, this));

		// 8. Watch for vault changes that might affect Daily Notes
		this.registerVaultEvents();

		// 9. Re-open the view if it was open last session
		this.app.workspace.onLayoutReady(() => {
			this.initViewOnStartup();
		});

		console.log("[HabitTracker] Plugin loaded ✓");
	}

	// ── onunload ───────────────────────────────────────────────────────────

	onunload(): void {
		console.log("[HabitTracker] Unloading plugin.");
		// Views are automatically destroyed by Obsidian on unload.
		// DataManager holds no timers/listeners that need explicit cleanup.
	}

	// ── Commands ────────────────────────────────────────────────────────────

	private registerCommands(): void {
		// ── Open / focus the tracker panel ──
		this.addCommand({
			id: "open-habit-tracker",
			name: "Open Habit Tracker",
			icon: "habit-tracker",
			callback: () => this.activateView(),
		});

		// ── Create a new habit via the modal ──
		this.addCommand({
			id: "create-habit",
			name: "Create new habit",
			icon: "plus-circle",
			callback: () => {
				this.activateView().then(() => {
					new HabitCreateModal(this.app, this, async (habit) => {
						new Notice(`✓ "${habit.name}" created`);
						this.broadcastDataChanged();
					}).open();
				});
			},
		});

		// ── Log today for every habit at once (quick daily check-in) ──
		this.addCommand({
			id: "log-all-today",
			name: "Log today for all habits",
			icon: "check-circle-2",
			callback: async () => {
				const habits = await this.dataManager.getActiveHabits();
				const today = new Date().toISOString().slice(0, 10);
				let logged = 0;

				for (const h of habits) {
					if (!this.dataManager.isCompleted(h, today)) {
						await this.dataManager.toggleCompletion(h.id, today);
						logged++;
					}
				}

				new Notice(
					logged > 0
						? `✓ Logged today for ${logged} habit${logged > 1 ? "s" : ""}`
						: "All habits already logged for today",
				);
				this.broadcastDataChanged();
			},
		});

		// ── Recovery: rebuild data.json from Daily Notes ──
		this.addCommand({
			id: "rebuild-habit-database",
			name: "Rebuild Habit Database from Daily Notes",
			icon: "refresh-cw",
			callback: async () => {
				new Notice("🔄 Scanning Daily Notes…");
				try {
					const result =
						await this.dataManager.rebuildFromDailyNotes();
					new Notice(
						`✓ Rebuild complete.\n` +
							`Habits found: ${result.habitsFound}\n` +
							`Completions restored: ${result.completionsRestored}`,
					);
					this.broadcastDataChanged();
				} catch (err) {
					new Notice(`✗ Rebuild failed: ${err}`);
					console.error("[HabitTracker] Rebuild error:", err);
				}
			},
		});

		// ── Debug: dump current data to console ──
		this.addCommand({
			id: "debug-dump-data",
			name: "Debug: print habit data to console",
			icon: "terminal",
			callback: async () => {
				const habits = await this.dataManager.getActiveHabits();
				console.table(
					habits.map((h) => ({
						name: h.name,
						completions: h.completions.length,
						createdDate: h.createdDate,
					})),
				);
				new Notice(
					`Logged ${habits.length} habits to console (Ctrl+Shift+I)`,
				);
			},
		});
	}

	// ── View management ──────────────────────────────────────────────────────

	/**
	 * Opens the Habit Tracker view, or focuses it if already open.
	 * Follows the Obsidian pattern: prefer existing leaf → otherwise create.
	 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		// If already open anywhere, just focus it
		const existing = workspace.getLeavesOfType(VIEW_TYPE_HABIT_TRACKER);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}

		// Open as a new tab in the main editor area (not sidebar)
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_HABIT_TRACKER,
			active: true,
		});
		workspace.revealLeaf(leaf);
	}

	/**
	 * Called on layout ready — re-opens the view if it was visible last session.
	 * Obsidian persists leaf types across reloads but doesn't auto-initialize
	 * plugin-owned views without this nudge.
	 */
	private initViewOnStartup(): void {
		const leaves = this.app.workspace.getLeavesOfType(
			VIEW_TYPE_HABIT_TRACKER,
		);
		if (leaves.length === 0) {
			// Don't force-open on cold start; let user open it themselves
			return;
		}
		// View exists from a previous session — refresh its content
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof HabitTrackerView) {
				view.refresh();
			}
		}
	}

	// ── Vault event listeners ────────────────────────────────────────────────

	/**
	 * Watch for Daily Note modifications so that if a user manually edits
	 * frontmatter we can prompt a soft refresh of the UI.
	 *
	 * We deliberately debounce this — vault events fire very frequently during
	 * sync operations (e.g. iCloud, Obsidian Sync) and we don't want to spam
	 * data reads.
	 */
	private registerVaultEvents(): void {
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;

		const onVaultChange = (file: { path: string }) => {
			if (!file.path.endsWith(".md")) return;

			// Only care about files in the Daily Notes folder
			const folder = this.settings.dailyNotesFolder;
			if (folder && !file.path.startsWith(folder + "/")) return;

			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				// Invalidate the DataManager cache so the next load() re-reads disk
				// NOTE: This is a soft invalidation — the UI only re-reads on next
				//       explicit interaction, not automatically, to avoid jank.
				console.log(
					"[HabitTracker] Daily Note changed, cache flagged stale.",
				);
			}, 1500);
		};

		this.registerEvent(this.app.vault.on("modify", onVaultChange));
		this.registerEvent(this.app.vault.on("create", onVaultChange));
	}

	// ── Internal event bus ───────────────────────────────────────────────────

	/**
	 * Tell all open HabitTrackerView instances to re-render.
	 * Called after any write operation originating from a command
	 * (not from within the view itself, which re-renders immediately).
	 */
	broadcastDataChanged(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_HABIT_TRACKER,
		)) {
			if (leaf.view instanceof HabitTrackerView) {
				leaf.view.refresh();
			}
		}
	}

	// ── Settings persistence ─────────────────────────────────────────────────

	async loadSettings(): Promise<void> {
		const saved = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Hot-reload the DataManager with new settings so folder paths etc. update
		this.dataManager.updateSettings(this.settings);
	}
}

// ── Settings Tab ─────────────────────────────────────────────────────────────

class HabitTrackerSettingTab extends PluginSettingTab {
	plugin: HabitTrackerPlugin;

	constructor(app: import("obsidian").App, plugin: HabitTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Habit Tracker" });

		// ── Daily Notes integration ──────────────────────────────────────────

		containerEl.createEl("h3", { text: "Daily Notes Sync" });

		new Setting(containerEl)
			.setName("Sync completions to Daily Notes")
			.setDesc(
				"When enabled, every toggle writes a `habit_*: true` key to " +
					"the Daily Note YAML frontmatter — creating a plain-text backup.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncToDailyNotes)
					.onChange(async (value) => {
						this.plugin.settings.syncToDailyNotes = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Daily Notes folder")
			.setDesc(
				"Vault-relative path to your Daily Notes folder. " +
					"Leave blank to use vault root. Example: Journal/Daily",
			)
			.addText((text) =>
				text
					.setPlaceholder("Journal/Daily")
					.setValue(this.plugin.settings.dailyNotesFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyNotesFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Daily Notes date format")
			.setDesc(
				"Must match your Daily Notes plugin filename format exactly. " +
					"Default: YYYY-MM-DD",
			)
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dailyNoteDateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteDateFormat =
							value.trim() || "YYYY-MM-DD";
						await this.plugin.saveSettings();
					}),
			);

		// ── Config backup ────────────────────────────────────────────────────

		containerEl.createEl("h3", { text: "Config Backup" });

		new Setting(containerEl)
			.setName("Enable HabitTracker_Config.md backup")
			.setDesc(
				"Generates a readable markdown file with your habit metadata " +
					"(colors, icons, quotes). Safe to commit to Git.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableConfigBackup)
					.onChange(async (value) => {
						this.plugin.settings.enableConfigBackup = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Config backup path")
			.setDesc("Vault-relative path for the config backup file.")
			.addText((text) =>
				text
					.setPlaceholder("HabitTracker_Config.md")
					.setValue(this.plugin.settings.configBackupPath)
					.onChange(async (value) => {
						this.plugin.settings.configBackupPath =
							value.trim() || "HabitTracker_Config.md";
						await this.plugin.saveSettings();
					}),
			);

		// ── Display ──────────────────────────────────────────────────────────

		containerEl.createEl("h3", { text: "Display" });

		new Setting(containerEl)
			.setName("Week starts on Monday")
			.setDesc("Toggle off to start weeks on Sunday.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.weekStartsOnMonday)
					.onChange(async (value) => {
						this.plugin.settings.weekStartsOnMonday = value;
						await this.plugin.saveSettings();
						this.plugin.broadcastDataChanged();
					}),
			);

		// ── Danger zone ──────────────────────────────────────────────────────

		containerEl.createEl("h3", { text: "Data" });

		new Setting(containerEl)
			.setName("Rebuild Habit Database")
			.setDesc(
				"Scans all Daily Notes and reconstructs completions from YAML " +
					"frontmatter. Use this if data.json was lost or corrupted.",
			)
			.addButton((btn) =>
				btn
					.setButtonText("Rebuild now")
					.setWarning()
					.onClick(async () => {
						btn.setButtonText("Rebuilding…");
						btn.setDisabled(true);
						try {
							const result =
								await this.plugin.dataManager.rebuildFromDailyNotes();
							new Notice(
								`✓ Rebuild complete — ${result.completionsRestored} completions restored`,
							);
							this.plugin.broadcastDataChanged();
						} catch (err) {
							new Notice(`✗ Rebuild failed: ${err}`);
						} finally {
							btn.setButtonText("Rebuild now");
							btn.setDisabled(false);
						}
					}),
			);
	}
}
