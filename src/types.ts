// ─────────────────────────────────────────────────────────────────────────────
// types.ts — Shared interfaces and enums for the Habit Tracker plugin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single habit entry stored in data.json.
 * Completion dates are stored as ISO date strings ("YYYY-MM-DD") in a flat
 * array — cheap to iterate, easy to serialize, and year-agnostic for streaks.
 */
export interface Habit {
	id: string;
	name: string;
	quote: string;
	color: string;
	icon?: string;
	createdDate: string;
	completions: string[];
	sortOrder: number;
	archived: boolean;

	/** "boolean" = simple done/not-done. "counter" = multiple increments per day. */
	kind: "boolean" | "counter";

	/** Counter only: how many increments = complete. e.g. 5 for "drink 5L" */
	target?: number;

	/** Counter only: display unit. e.g. "L", "pages", "reps" */
	unit?: string;

	/**
	 * Counter only: daily counts. Record<ISO date, count>
	 * e.g. { "2026-03-16": 3 } means 3 increments on that day.
	 * Boolean habits never populate this field.
	 */
	counts?: Record<string, number>;
}

/**
 * Root shape of data.json — the plugin's primary data store.
 */
export interface HabitData {
	/** Schema version for future migrations */
	version: number;

	/** Map of habit id → Habit for O(1) lookup */
	habits: Record<string, Habit>;

	/** Ordered list of habit IDs, controls accordion sort order */
	habitOrder: string[];

	/** Persisted UI state — which cards are expanded */
	uiState: UIState;

	/** ISO timestamp of the last write — useful for debugging sync issues */
	lastModified: string;
}

/**
 * Lightweight UI state persisted alongside habit data.
 * Survives panel close/reopen and Obsidian restarts.
 */
export interface UIState {
	/** Set of habit IDs that are currently expanded */
	openHabitIds: string[];
	/** Last selected year in the global year nav */
	selectedYear: number;
	/** Whether the archived section is expanded */
	archivedSectionOpen: boolean;
}

/**
 * Computed streak statistics derived from a habit's completions array.
 * Recalculated on every render; never stored in data.json.
 */
export interface StreakStats {
	currentStreak: number;
	bestStreak: number;
	totalCompletions: number;
	/** ISO date string of the most recent completion, or null */
	lastCompletedDate: string | null;
}

/**
 * Plugin-level settings stored in Obsidian's standard settings file.
 * Kept intentionally lean — habit data lives in data.json, not here.
 */
export interface HabitTrackerSettings {
	/**
	 * Folder path for Daily Notes, relative to vault root.
	 * Defaults to the Obsidian core Daily Notes plugin setting if available.
	 * Example: "Journal/Daily"
	 */
	dailyNotesFolder: string;

	/**
	 * Date format used for Daily Note filenames.
	 * Must match your Daily Notes plugin setting exactly.
	 * Example: "YYYY-MM-DD"
	 */
	dailyNoteDateFormat: string;

	/**
	 * Whether to write habit completions to Daily Note YAML frontmatter.
	 * Disable if you don't use Daily Notes at all.
	 */
	syncToDailyNotes: boolean;

	/**
	 * Whether to generate and maintain the HabitTracker_Config.md backup file.
	 */
	enableConfigBackup: boolean;

	/**
	 * Vault-relative path for the config backup markdown file.
	 * Example: "HabitTracker_Config.md"
	 */
	configBackupPath: string;

	/**
	 * First day of the week in the heatmap column headers.
	 * 0 = Sunday, 1 = Monday
	 */
	weekStartsOnMonday: boolean;
}

export const DEFAULT_SETTINGS: HabitTrackerSettings = {
	dailyNotesFolder: "",
	dailyNoteDateFormat: "YYYY-MM-DD",
	syncToDailyNotes: true,
	enableConfigBackup: true,
	configBackupPath: "HabitTracker_Config.md",
	weekStartsOnMonday: true,
};

/**
 * Events emitted on the plugin's internal EventEmitter so Svelte components
 * can react to data changes without polling.
 */
export const HABIT_EVENTS = {
	DATA_CHANGED: "habit-data-changed",
	HABIT_TOGGLED: "habit-toggled",
	HABIT_CREATED: "habit-created",
	HABIT_DELETED: "habit-deleted",
	REBUILD_COMPLETE: "rebuild-complete",
} as const;

/** The unique identifier Obsidian uses to find and re-open our custom view */
export const VIEW_TYPE_HABIT_TRACKER = "habit-tracker-view";
