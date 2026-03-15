<!-- ─────────────────────────────────────────────────────────────────────────
  HabitTrackerApp.svelte — Root component mounted by HabitTrackerView.ts.

  Owns:
    - Loading + error state for the initial data fetch
    - The ordered list of HabitAccordionCard components
    - Empty state when no habits exist yet
    - "Add habit" FAB that opens HabitCreateModal
    - Reorder logic (move up / move down)
    - Listening to the plugin's HABIT_EVENTS for external refreshes
      (e.g. commands triggered from the palette while the view is open)
  ─────────────────────────────────────────────────────────────────────────── -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type HabitTrackerPlugin from "../main";
  import type { Habit } from "../types";
  import { HABIT_EVENTS } from "../types";
  import HabitAccordionCard from "./HabitAccordionCard.svelte";
  import HabitCreateModal from "../HabitCreateModal";

  // ── Props ──────────────────────────────────────────────────────────────
  /** The live plugin instance — gives access to dataManager and settings */
  export let plugin: HabitTrackerPlugin;

  /**
   * Incremented externally (via HabitTrackerView.refresh()) to force a
   * re-fetch from DataManager without fully remounting the component.
   */
  export let refreshKey: number = 0;

  // ── Local state ────────────────────────────────────────────────────────

  let habits: Habit[] = [];
  let loading = true;
  let error: string | null = null;

  // ── Reactive re-fetch on refreshKey change ─────────────────────────────

  $: if (refreshKey >= 0) {
    loadHabits();
  }

  // ── Data loading ───────────────────────────────────────────────────────

  async function loadHabits() {
    try {
      habits = await plugin.dataManager.getActiveHabits();
      error = null;
    } catch (err) {
      error = String(err);
      console.error("[HabitTrackerApp] Failed to load habits:", err);
    } finally {
      loading = false;
    }
  }

  // ── Reorder ────────────────────────────────────────────────────────────

  async function moveHabit(id: string, direction: "up" | "down") {
    const idx = habits.findIndex((h) => h.id === id);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === habits.length - 1) return;

    const newOrder = [...habits];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];

    habits = newOrder;
    await plugin.dataManager.reorderHabits(newOrder.map((h) => h.id));
  }

  // ── Archive ────────────────────────────────────────────────────────────

  function handleArchive(e: CustomEvent<{ id: string }>) {
    habits = habits.filter((h) => h.id !== e.detail.id);
  }

  // ── Add new habit ──────────────────────────────────────────────────────

  function openCreateModal() {
    new HabitCreateModal(plugin.app, plugin, async (newHabit) => {
      habits = [...habits, newHabit];
    }).open();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  onMount(() => {
    loadHabits();
  });
</script>

<!-- ── Markup ──────────────────────────────────────────────────────────────── -->

<div class="habit-tracker-app">

  <!-- Header bar -->
  <div class="app-header">
    <h4 class="app-title">Habits</h4>
    <button
      class="add-btn"
      on:click={openCreateModal}
      aria-label="Add new habit"
      title="Add new habit"
    >
      <span aria-hidden="true">+</span> New habit
    </button>
  </div>

  <!-- Loading state -->
  {#if loading}
    <div class="state-center">
      <div class="spinner" aria-label="Loading habits"></div>
    </div>

  <!-- Error state -->
  {:else if error}
    <div class="state-center state-error">
      <p class="state-text">Failed to load habits.</p>
      <p class="state-sub">{error}</p>
      <button class="retry-btn" on:click={loadHabits}>Retry</button>
    </div>

  <!-- Empty state -->
  {:else if habits.length === 0}
    <div class="state-center state-empty">
      <div class="empty-icon" aria-hidden="true">📅</div>
      <p class="state-text">No habits yet.</p>
      <p class="state-sub">
        Track your daily consistency with a GitHub-style heatmap.
      </p>
      <button class="primary-btn" on:click={openCreateModal}>
        Create your first habit
      </button>
    </div>

  <!-- Habit list -->
  {:else}
    <div class="habits-list" role="list">
      {#each habits as habit, i (habit.id)}
        <div role="listitem">
          <HabitAccordionCard
            {habit}
            dataManager={plugin.dataManager}
            weekStartsOn={plugin.settings.weekStartsOnMonday ? 1 : 0}
            isFirst={i === 0}
            isLast={i === habits.length - 1}
            on:archive={handleArchive}
            on:moveUp={(e) => moveHabit(e.detail.id, "up")}
            on:moveDown={(e) => moveHabit(e.detail.id, "down")}
          />
        </div>
      {/each}
    </div>
  {/if}

</div>

<!-- ── Styles ──────────────────────────────────────────────────────────────── -->

<style>
  /* ── Root ── */
  .habit-tracker-app {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Header ── */
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 8px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
  }

  .app-title {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .add-btn {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 5px;
    padding: 4px 10px;
    font-size: 0.78rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: opacity 120ms ease;
    font-weight: 500;
  }

  .add-btn:hover {
    opacity: 0.88;
  }

  /* ── Habits list (scrollable) ── */
  .habits-list {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    /* Custom scrollbar */
    scrollbar-width: thin;
    scrollbar-color: var(--background-modifier-border) transparent;
  }

  .habits-list::-webkit-scrollbar {
    width: 5px;
  }

  .habits-list::-webkit-scrollbar-thumb {
    background: var(--background-modifier-border);
    border-radius: 3px;
  }

  /* ── Centered states (loading / empty / error) ── */
  .state-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 32px 24px;
    text-align: center;
  }

  .empty-icon {
    font-size: 2.4rem;
    opacity: 0.4;
    line-height: 1;
  }

  .state-text {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-normal);
  }

  .state-sub {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-muted);
    max-width: 240px;
    line-height: 1.5;
  }

  .state-error {
    color: var(--text-error);
  }

  /* ── Buttons in state views ── */
  .primary-btn,
  .retry-btn {
    margin-top: 6px;
    padding: 6px 16px;
    border-radius: 5px;
    border: none;
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 500;
    transition: opacity 120ms ease;
  }

  .primary-btn {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .retry-btn {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }

  .primary-btn:hover,
  .retry-btn:hover {
    opacity: 0.85;
  }

  /* ── Spinner ── */
  .spinner {
    width: 22px;
    height: 22px;
    border: 2px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: spin 700ms linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
