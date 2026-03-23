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
	type Habit,
	type HabitTrackerSettings,
} from "./types";
import { DataManager } from "./DataManager";
import { generatePassphrase } from "./passphrase";
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
	dataManager!: DataManager;

	// ── Cross-instance event bus ──────────────────────────────────────────
	// Any HabitTrackerApp that writes data calls onDataChanged().
	// All other open instances subscribe and reload their habits array.

	private _listeners: Array<
		(sourceId: string, updatedHabit?: Habit) => void
	> = [];

	onDataChanged(sourceId = "", updatedHabit?: Habit): void {
		this._listeners.forEach((fn) => fn(sourceId, updatedHabit));
	}

	onDataChangedSubscribe(
		fn: (sourceId: string, updatedHabit?: Habit) => void,
	): () => void {
		this._listeners.push(fn);
		return () => {
			this._listeners = this._listeners.filter((f) => f !== fn);
		};
	}

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

		// Ensure the HabitGrid folder exists in the vault
		this.app.workspace.onLayoutReady(async () => {
			await this.dataManager.ensureHabitGridFolder();
		});

		// 4. Register the custom leaf view
		this.registerView(
			VIEW_TYPE_HABIT_TRACKER,
			(leaf) => new HabitTrackerView(leaf, this),
		);

		// 5. Add the ribbon icon that opens / focuses the view
		this.addRibbonIcon("habit-tracker", "HabitGrid", async () => {
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
		this.addCommand({
			id: "open-habit-tracker",
			name: "HabitGrid — Open (large view)",
			icon: "habit-tracker",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "open-habit-tracker-new",
			name: "HabitGrid — Open new instance",
			icon: "habit-tracker",
			callback: () => this.openNewInstance(),
		});

		this.addCommand({
			id: "open-habit-tracker-sidebar",
			name: "HabitGrid — Open in sidebar",
			icon: "habit-tracker",
			callback: async () => {
				const leaf = this.app.workspace.getRightLeaf(false);
				if (!leaf) return;
				await leaf.setViewState({
					type: VIEW_TYPE_HABIT_TRACKER,
					active: true,
				});
				this.app.workspace.revealLeaf(leaf);
			},
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
		// Always open a fresh tab — same behaviour as openNewInstance
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_HABIT_TRACKER,
			active: true,
		});
		workspace.revealLeaf(leaf);
	}

	async openNewInstance(): Promise<void> {
		const { workspace } = this.app;
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
		for (const leaf of leaves) {
			if (leaf.view instanceof HabitTrackerView) {
				leaf.view.refresh();
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

			// Only care about files in the HabitGrid folder
			const habitGridFolder = this.dataManager.getHabitGridFolderPath();
			if (!file.path.startsWith(habitGridFolder + "/")) return;

			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				console.log(
					"[HabitGrid] HabitGrid folder changed, cache flagged stale.",
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
	broadcastDataChanged(sourceId = ""): void {
		this.onDataChanged(sourceId);
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

		// ── HabitGrid folder ─────────────────────────────────────────────────

		containerEl.createEl("h3", { text: "HabitGrid Folder" });

		let folderMoveTimer: ReturnType<typeof setTimeout>;

		new Setting(containerEl)
			.setName("Folder location")
			.setDesc(
				"Where to create the HabitGrid folder inside your vault. " +
					"Leave blank to place it at the vault root. " +
					"Example: 'Notes' creates 'Notes/HabitGrid'. " +
					"All date files always stay inside the HabitGrid folder.",
			)
			.addText((text) => {
				text.setPlaceholder("Leave blank for vault root").setValue(
					this.plugin.settings.habitGridParentFolder,
				);

				const applyFolderChange = async () => {
					const oldParent =
						this.plugin.settings.habitGridParentFolder;
					const newParent = text.getValue().trim();
					if (oldParent === newParent) return;
					this.plugin.settings.habitGridParentFolder = newParent;
					await this.plugin.saveSettings();
					this.plugin.dataManager.updateSettings(
						this.plugin.settings,
					);
					await this.plugin.dataManager.moveHabitGridFolder(
						oldParent,
						newParent,
					);
					await this.plugin.dataManager.ensureHabitGridFolder();
				};

				text.inputEl.addEventListener("blur", applyFolderChange);
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						text.inputEl.blur();
					}
				});
			});

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

		new Setting(containerEl)
			.setName("Auto-collapse habits")
			.setDesc(
				"When you expand a habit, automatically collapse all others. Turn off to keep multiple habits open at once.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCollapse)
					.onChange(async (value) => {
						this.plugin.settings.autoCollapse = value;
						await this.plugin.saveSettings();
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

		// ── Danger Zone ──────────────────────────────────────────────────────

		containerEl.createEl("h3", {
			text: "Danger Zone",
			cls: "danger-heading",
		});

		// Show reset log if any resets have occurred
		this.plugin.dataManager.getResetLog().then((log) => {
			if (log.length === 0) return;
			const logSection = containerEl.createDiv({
				cls: "reset-log-section",
			});
			logSection.createEl("p", {
				text: "Reset history:",
				cls: "reset-log-label",
			});
			const ul = logSection.createEl("ul", { cls: "reset-log-list" });
			for (const entry of log) {
				ul.createEl("li", { text: entry, cls: "reset-log-entry" });
			}
		});

		// Generate fresh passphrase every time settings opens
		const passphrase = generatePassphrase();

		const dangerDesc = containerEl.createDiv({ cls: "danger-zone" });
		dangerDesc.createEl("p", {
			text: "This permanently deletes all habits and history. Your Daily Notes are not touched.",
			cls: "danger-text",
		});

		// Passphrase display
		const phraseBox = dangerDesc.createDiv({ cls: "danger-phrase-box" });
		phraseBox.createEl("span", {
			text: "Type this phrase to confirm: ",
			cls: "danger-phrase-label",
		});
		phraseBox.createEl("code", { text: passphrase, cls: "danger-phrase" });

		// Input + button row
		const dangerRow = dangerDesc.createDiv({ cls: "danger-row" });
		const input = dangerRow.createEl("input", {
			type: "text",
			cls: "danger-input",
			attr: { placeholder: "type phrase here…" },
		});

		const resetBtn = dangerRow.createEl("button", {
			text: "Delete everything",
			cls: "danger-btn",
			attr: { disabled: "true" },
		});

		input.addEventListener("input", () => {
			const matches = input.value.trim() === passphrase;
			resetBtn.toggleAttribute("disabled", !matches);
		});

		resetBtn.addEventListener("click", async () => {
			resetBtn.textContent = "Deleting…";
			resetBtn.setAttribute("disabled", "true");
			try {
				await this.plugin.dataManager.resetAll();
				new Notice("✓ HabitGrid data cleared. Starting fresh.");
				this.plugin.broadcastDataChanged("__reset__");
				input.value = "";
				resetBtn.textContent = "Delete everything";
			} catch (err) {
				new Notice(`✗ Reset failed: ${err}`);
				resetBtn.textContent = "Delete everything";
				resetBtn.removeAttribute("disabled");
			}
		});

		// Inline styles for danger zone (minimal, uses Obsidian vars)
		const style = containerEl.createEl("style");
		style.textContent = `
      .danger-heading { color: #e53e3e; }
      .danger-zone { border: 1px solid rgba(229,62,62,.3); border-radius: 8px; padding: 14px 16px; background: rgba(229,62,62,.04); }
      .danger-text { margin: 0 0 10px; font-size: .85rem; color: var(--text-muted); }
      .danger-phrase-box { margin-bottom: 10px; font-size: .83rem; }
      .danger-phrase { background: var(--background-secondary); padding: 2px 7px; border-radius: 4px; font-size: .85rem; letter-spacing: .04em; color: #e53e3e; }
      .danger-row { display: flex; gap: 8px; align-items: center; }
      .danger-input { flex: 1; font-size: .83rem; background: var(--background-modifier-form-field); border: 1px solid var(--background-modifier-border); border-radius: 5px; padding: 5px 10px; color: var(--text-normal); outline: none; }
      .danger-input:focus { border-color: #e53e3e; }
      .danger-btn { background: #e53e3e; color: #fff; border: none; border-radius: 5px; padding: 5px 14px; font-size: .83rem; cursor: pointer; white-space: nowrap; transition: opacity 120ms; }
      .danger-btn:disabled { opacity: .4; cursor: default; }
      .danger-btn:not(:disabled):hover { opacity: .88; }
      .reset-log-section { margin-bottom: 12px; padding: 10px 12px; background: var(--background-secondary); border-radius: 6px; border: 1px solid var(--background-modifier-border); }
      .reset-log-label { margin: 0 0 6px; font-size: .78rem; font-weight: 600; color: var(--text-muted); }
      .reset-log-list { margin: 0; padding-left: 16px; }
      .reset-log-entry { font-size: .76rem; color: var(--text-muted); font-family: var(--font-monospace); margin-bottom: 2px; }
    `;
	}
}
