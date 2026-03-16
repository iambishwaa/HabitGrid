// ─────────────────────────────────────────────────────────────────────────────
// HabitTrackerView.ts — Obsidian ItemView that mounts the Svelte UI tree.
//
// This is intentionally thin. All rendering lives in Svelte; this file only
// handles the Obsidian API surface: registering the view type, managing the
// Svelte lifecycle, and passing the DataManager down as context.
// ─────────────────────────────────────────────────────────────────────────────

import { ItemView, WorkspaceLeaf } from "obsidian";
import type HabitTrackerPlugin from "./main";
import { VIEW_TYPE_HABIT_TRACKER } from "./types";
import HabitTrackerApp from "./ui/HabitTrackerApp.svelte";

export class HabitTrackerView extends ItemView {
	private plugin: HabitTrackerPlugin;

	/**
	 * The mounted Svelte component instance.
	 * Typed as `any` because Svelte's generated types vary by version;
	 * swap for the concrete import once the component exists.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private svelteApp: any = null;

	constructor(leaf: WorkspaceLeaf, plugin: HabitTrackerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	// ── ItemView contract ────────────────────────────────────────────────────

	getViewType(): string {
		return VIEW_TYPE_HABIT_TRACKER;
	}

	getDisplayText(): string {
		return "HabitGrid";
	}

	getIcon(): string {
		// Lucide icon name — shows in the tab strip
		return "calendar-check-2";
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("habit-tracker-root");

		// Strip Obsidian's default .view-content padding (15px / 30px)
		// so our layout controls all spacing with no external interference.
		container.style.padding = "0";
		container.style.overflow = "hidden";

		this.svelteApp = new HabitTrackerApp({
			target: container,
			props: { plugin: this.plugin },
		});
	}

	async onClose(): Promise<void> {
		// Svelte teardown — prevents memory leaks and dangling event listeners
		if (this.svelteApp) {
			this.svelteApp.$destroy();
			this.svelteApp = null;
		}
	}

	// ── Public refresh API ───────────────────────────────────────────────────

	/**
	 * Called by main.ts after any external data change (e.g. a vault event)
	 * to tell the Svelte component to re-fetch from DataManager.
	 */
	refresh(): void {
		if (this.svelteApp) {
			// Svelte components expose `$set` for external prop updates
			this.svelteApp.$set({ refreshKey: Date.now() });
		}
	}
}
