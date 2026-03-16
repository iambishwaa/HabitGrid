<!-- HabitAccordionCard.svelte -->

<script lang="ts">
  import { slide, fade } from "svelte/transition";
  import { cubicOut, quintOut, elasticOut } from "svelte/easing";
  import { createEventDispatcher } from "svelte";
  import { setIcon } from "obsidian";
  import type { Habit } from "../types";
  import type { DataManager } from "../DataManager";
  import { computeStreakStats } from "../DataManager";
  import HeatmapGrid from "./HeatmapGrid.svelte";
  import StatsFooter from "./StatsFooter.svelte";
  import HabitEditModal from "../HabitEditModal";
  import type HabitTrackerPlugin from "../main";

  export let habit: Habit;
  export let dataManager: DataManager;
  export let plugin: HabitTrackerPlugin;
  export let weekStartsOn: 0 | 1 = 1;
  export let selectedYear: number;
  export let isOpen: boolean = false;
  export let compact: boolean = false;

  const dispatch = createEventDispatcher<{
    archive:         { id: string };
    delete:          { id: string };
    habitUpdated:    Habit;
    toggleOpen:      { id: string; open: boolean };
    handleMousedown: void;
    handleMouseup:   void;
  }>();

  let showDeleteConfirm = false;
  let togglingToday = false;
  let isHovered = false;
  let showStats = false;

  $: stats = computeStreakStats(habit.completions);
  $: todayISO = new Date().toISOString().slice(0, 10);
  $: completedToday = habit.completions.includes(todayISO);
  $: showActions = isHovered;

  // ── Icon badge element binding ─────────────────────────────────────────
  // We bind to the icon element and use Obsidian's setIcon() to render
  // the correct Lucide SVG whenever habit.icon changes.

  let iconEl: HTMLElement;
  $: if (iconEl) renderIcon(iconEl, habit.icon, habit.name);

  function renderIcon(el: HTMLElement, icon: string | undefined, name: string) {
    el.empty();
    if (!icon) return;
    const isEmoji = /\p{Emoji}/u.test(icon);
    if (isEmoji) {
      el.textContent = icon;
    } else {
      try { setIcon(el, icon); }
      catch (_e) { el.textContent = icon.slice(0, 1); }
    }
  }

  // ── Today checkbox ─────────────────────────────────────────────────────

  async function toggleToday(e: MouseEvent) {
    e.stopPropagation();
    if (togglingToday) return;
    togglingToday = true;
    const wasComplete = completedToday;
    habit = {
      ...habit,
      completions: wasComplete
        ? habit.completions.filter(d => d !== todayISO)
        : [...habit.completions, todayISO]
    };
    try {
      await dataManager.toggleCompletion(habit.id, todayISO);
      const fresh = await dataManager.getHabit(habit.id);
      if (fresh) { habit = fresh; dispatch("habitUpdated", fresh); }
    } catch (_e) {
      habit = {
        ...habit,
        completions: wasComplete
          ? [...habit.completions, todayISO]
          : habit.completions.filter(d => d !== todayISO)
      };
    } finally {
      togglingToday = false;
    }
  }

  // ── Fold / Unfold ──────────────────────────────────────────────────────

  function toggleOpen() {
    dispatch("toggleOpen", { id: habit.id, open: !isOpen });
  }

  // ── Edit modal ─────────────────────────────────────────────────────────

  function openEditModal(e: MouseEvent) {
    e.stopPropagation();
    new HabitEditModal(plugin.app, plugin, habit, (updated) => {
      habit = updated;
      dispatch("habitUpdated", updated);
    }).open();
  }

  // ── Heatmap toggle ─────────────────────────────────────────────────────

  function handleToggle(e: CustomEvent<{ dateISO: string; completed: boolean }>) {
    const { dateISO, completed } = e.detail;
    const newCompletions = completed
      ? [...habit.completions, dateISO].sort()
      : habit.completions.filter(d => d !== dateISO);
    habit = { ...habit, completions: newCompletions };
    dispatch("habitUpdated", habit);
  }

  // ── Archive / Delete ───────────────────────────────────────────────────

  async function handleArchive(e: MouseEvent) {
    e.stopPropagation();
    await dataManager.archiveHabit(habit.id);
    dispatch("archive", { id: habit.id });
  }

  function requestDelete(e: MouseEvent) {
    e.stopPropagation();
    showDeleteConfirm = true;
  }

  async function confirmDelete() {
    showDeleteConfirm = false;
    await dataManager.deleteHabit(habit.id);
    dispatch("delete", { id: habit.id });
  }
</script>

<!-- ── Markup ──────────────────────────────────────────────────────────────── -->

<div
  class="card"
  class:is-open={isOpen}
  class:compact
  style="--hc:{habit.color};"
  on:mouseenter={() => (isHovered = true)}
  on:mouseleave={() => (isHovered = false)}
>

  <!-- Delete confirm -->
  {#if showDeleteConfirm}
    <div class="del-overlay" transition:fade={{ duration: 150 }}>
      <div class="del-content">
        <p class="del-msg">Delete <strong>{habit.name}</strong>?</p>
        <p class="del-sub">This removes all history permanently.</p>
      </div>
      <div class="del-btns">
        <button class="del-btn del-cancel" on:click={() => (showDeleteConfirm = false)}>Cancel</button>
        <button class="del-btn del-confirm" on:click={confirmDelete}>Delete</button>
      </div>
    </div>

  {:else}
    <!-- ── Header ── -->
    <div
      class="header"
      role="button"
      tabindex="0"
      aria-expanded={isOpen}
      on:click={toggleOpen}
      on:keydown={(e) => (e.key === "Enter" || e.key === " ") && toggleOpen()}
    >

      <!-- Drag grip -->
      <div
        class="grip"
        aria-hidden="true"
        on:mousedown|stopPropagation={() => dispatch("handleMousedown")}
        on:mouseup|stopPropagation={() => dispatch("handleMouseup")}
        on:click|stopPropagation
        title="Drag to reorder"
      >
        <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
          <circle cx="2" cy="2"  r="1.2"/><circle cx="6" cy="2"  r="1.2"/>
          <circle cx="2" cy="6"  r="1.2"/><circle cx="6" cy="6"  r="1.2"/>
          <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
        </svg>
      </div>

      <!-- Big today checkbox -->
      <button
        class="chk"
        class:chk-done={completedToday}
        class:chk-busy={togglingToday}
        on:click={toggleToday}
        aria-label="{completedToday ? 'Unmark' : 'Mark'} {habit.name} done today"
        title="{completedToday ? 'Done today — click to unmark' : 'Mark done today'}"
      >
        {#if completedToday}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect width="20" height="20" rx="5" fill="{habit.color}"/>
            <path d="M4.5 10L8.5 14L15.5 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {:else}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="1" y="1" width="18" height="18" rx="4"
              fill="{habit.color}" fill-opacity="0.12"
              stroke="{habit.color}" stroke-width="1.8"/>
          </svg>
        {/if}
      </button>

      <!-- Icon inline + name + quote -->
      <div class="identity">
        <div class="name-block">
          <span class="name-text">
            {#if habit.icon}
              <span class="inline-icon" bind:this={iconEl}></span>
            {/if}
            {habit.name}
          </span>
          {#if habit.quote && !compact}
            <span class="quote-text">{habit.quote}</span>
          {/if}
        </div>
      </div>

      <!-- Hover-reveal actions -->
      <div class="actions" class:actions-visible={showActions} on:click|stopPropagation>
        <button class="act-btn" on:click={openEditModal} title="Edit habit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/>
          </svg>
        </button>
        <button class="act-btn" on:click={handleArchive} title="Archive">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
            <line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
        </button>
        <button class="act-btn act-btn-danger" on:click={requestDelete} title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>

      <!-- Chevron -->
      <div class="chevron" class:open={isOpen} aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="2.5 4.5 6 7.5 9.5 4.5"/>
        </svg>
      </div>

    </div>

    <!-- ── Expanded body ── -->
    {#if isOpen}
      <div class="body" transition:slide={{ duration: 200, easing: quintOut }}>

        <!-- Heatmap + info icon -->
        <div class="heatmap-row">
          <div class="heatmap-wrap">
            <HeatmapGrid
              {habit} year={selectedYear} {dataManager}
              {weekStartsOn} {compact}
              on:toggle={handleToggle}
            />
          </div>

          {#if !compact}
            <button
              class="info-btn"
              class:info-btn-active={showStats}
              on:click|stopPropagation={() => (showStats = !showStats)}
              title="{showStats ? 'Hide stats' : 'Show stats'}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="8" stroke-width="3"/>
                <line x1="12" y1="12" x2="12" y2="16"/>
              </svg>
            </button>
          {/if}
        </div>

        {#if !compact && showStats}
          <div transition:slide={{ duration: 160, easing: cubicOut }}>
            <StatsFooter {stats} createdDate={habit.createdDate} habitColor={habit.color} />
          </div>
        {/if}

      </div>
    {/if}

  {/if}

</div>

<!-- ── Styles ──────────────────────────────────────────────────────────────── -->

<style>
  /* ── Card ── */
  .card {
    position: relative;
    border-radius: 7px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    overflow: hidden;
    transition: border-color 180ms ease, box-shadow 180ms ease;
  }

  .card:hover {
    border-color: color-mix(in srgb, var(--hc) 40%, var(--background-modifier-border));
  }

  .card.is-open {
    border-color: color-mix(in srgb, var(--hc) 55%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--hc) 12%, transparent);
  }

  /* ── Delete overlay ── */
  .del-overlay {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    flex-wrap: wrap;
    background: rgba(229,62,62,.07);
    border-left: 3px solid #e53e3e;
  }

  .del-content { flex: 1; }
  .del-msg { margin: 0; font-size: .83rem; color: var(--text-normal); }
  .del-msg strong { color: #e53e3e; }
  .del-sub { margin: 2px 0 0; font-size: .74rem; color: var(--text-muted); }
  .del-btns { display: flex; gap: 6px; }
  .del-btn { border: none; border-radius: 6px; padding: 5px 14px; font-size: .78rem; font-weight: 500; cursor: pointer; transition: opacity 120ms; }
  .del-cancel  { background: var(--background-modifier-border); color: var(--text-normal); }
  .del-confirm { background: #e53e3e; color: #fff; }
  .del-btn:hover { opacity: .85; }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px 5px 6px;
    cursor: pointer;
    user-select: none;
    border-left: 3px solid transparent;
    transition: border-color 200ms ease, background 120ms ease;
  }

  .card.is-open .header {
    border-left-color: var(--hc);
    background: color-mix(in srgb, var(--hc) 5%, transparent);
    padding-left: 3px;
  }

  .header:hover { background: color-mix(in srgb, var(--hc) 8%, transparent); }
  .card.is-open .header:hover { background: color-mix(in srgb, var(--hc) 11%, transparent); }
  .header:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }

  /* ── Grip ── */
  .grip {
    cursor: grab;
    color: var(--text-faint);
    padding: 2px 2px;
    border-radius: 3px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 150ms ease;
  }

  .header:hover .grip { opacity: 1; }
  .grip:active { cursor: grabbing; }

  /* ── Big today checkbox ── */
  .chk {
    all: unset;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    transition: transform 140ms ease, opacity 120ms ease;
  }

  .chk:hover:not(.chk-busy) { transform: scale(1.1); }
  .chk:active { transform: scale(.9); }
  .chk.chk-busy { opacity: .5; pointer-events: none; }

  /* Spring pop when checked */
  .chk.chk-done svg {
    animation: check-spring 350ms cubic-bezier(.34,1.8,.64,1);
  }

  @keyframes check-spring {
    0%   { transform: scale(.4) rotate(-10deg); opacity: .5; }
    60%  { transform: scale(1.15) rotate(3deg); }
    80%  { transform: scale(.95); }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }

  /* ── Identity: name + quote ── */
  .identity {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .name-block {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .name-text {
    font-size: .87rem;
    font-weight: 500;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  /* Inline icon — emoji or SVG sitting before the name */
  .inline-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1;
  }

  .inline-icon :global(svg) {
    width: 13px;
    height: 13px;
    stroke: var(--text-muted);
    fill: none;
    flex-shrink: 0;
  }

  .quote-text {
    font-size: .72rem;
    color: var(--text-muted);
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
    margin-top: 1px;
  }

  /* ── Hover-reveal actions ── */
  .actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    opacity: 0;
    transform: translateX(4px);
    transition: opacity 150ms ease, transform 150ms ease;
    pointer-events: none;
  }

  .actions.actions-visible {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }

  .act-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 4px 5px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    transition: color 120ms ease, background 120ms ease;
  }

  .act-btn:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
  .act-btn-danger:hover { color: #e53e3e; background: rgba(229,62,62,.1); }

  /* ── Chevron ── */
  .chevron {
    color: var(--text-faint);
    display: flex;
    align-items: center;
    flex-shrink: 0;
    transition: transform 200ms ease, color 150ms ease;
  }

  .chevron.open { transform: rotate(180deg); color: var(--text-muted); }
  .header:hover .chevron { color: var(--text-muted); }

  /* ── Body ── */
  .body {
    padding: 0 0 6px;
    border-top: 1px solid var(--background-modifier-border);
  }

  /* ── Heatmap row ── */
  .heatmap-row { display: flex; align-items: flex-start; gap: 4px; padding: 4px 4px 0; }
  .heatmap-wrap { flex: 1; min-width: 0; margin-top: 2px; }

  /* ── Info button ── */
  .info-btn {
    all: unset;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    color: var(--text-faint);
    margin-top: 4px;
    transition: color 150ms ease, background 150ms ease;
  }

  .info-btn:hover { color: var(--text-muted); background: var(--background-modifier-hover); }
  .info-btn-active { color: var(--interactive-accent) !important; background: color-mix(in srgb, var(--interactive-accent) 10%, transparent); }

  /* ── Compact ── */
  .compact .header { padding: 4px 6px 4px 5px; }
  .compact .body   { padding: 2px 4px 6px; }
  .compact .name-text { font-size: .8rem; }
  .compact .chk { width: 18px; height: 18px; }
  .compact .grip { display: none; }
  .compact .actions { display: none; }
</style>
