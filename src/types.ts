// types.ts

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
	kind: "boolean" | "counter";
	target?: number;
	unit?: string;
	counts?: Record<string, number>;
}

export interface HabitData {
	version: number;
	habits: Record<string, Habit>;
	habitOrder: string[];
	uiState: UIState;
	lastModified: string;
	/** ISO date of last full reset — rebuild ignores Daily Notes before this */
	resetAt?: string;
	/**
	 * Frontmatter keys of intentionally deleted habits (e.g. "habit_morning_reading").
	 * rebuildFromDailyNotes skips these so deleted habits never resurrect.
	 */
	deletedHabitKeys: string[];
	/** Log of reset events — never written to vault */
	resetLog: string[];
}

export interface UIState {
	openHabitIds: string[];
	selectedYear: number;
	archivedSectionOpen: boolean;
}

export interface StreakStats {
	currentStreak: number;
	bestStreak: number;
	totalCompletions: number;
	lastCompletedDate: string | null;
}

export interface HabitTrackerSettings {
	weekStartsOnMonday: boolean;
	autoCollapse: boolean;
	/** Parent folder for HabitGrid folder. Empty = vault root. e.g. "Notes" → "Notes/HabitGrid" */
	habitGridParentFolder: string;
}

export const DEFAULT_SETTINGS: HabitTrackerSettings = {
	weekStartsOnMonday: true,
	autoCollapse: true,
	habitGridParentFolder: "",
};

export const HABIT_EVENTS = {
	DATA_CHANGED: "habit-data-changed",
	HABIT_TOGGLED: "habit-toggled",
	HABIT_CREATED: "habit-created",
	HABIT_DELETED: "habit-deleted",
	REBUILD_COMPLETE: "rebuild-complete",
} as const;

export const VIEW_TYPE_HABIT_TRACKER = "habitgrid-view";
