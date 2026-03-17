<!-- HabitAccordionCard.svelte -->

<script lang="ts">
  import { slide, fade } from "svelte/transition";
  import { cubicOut, quintOut } from "svelte/easing";
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
  let showStats = false;
  let counterBusy = false;

  $: stats = computeStreakStats(habit.completions);
  $: todayISO = new Date().toISOString().slice(0, 10);
  $: completedToday = doneSet.has(todayISO);
  $: isCounter = habit.kind === "counter";
  $: todayCount = isCounter ? (countMap[todayISO] ?? 0) : 0;
  $: target = habit.target ?? 1;
  $: counterDone = isCounter && todayCount >= target;

  // ── Card owns the grid state ──────────────────────────────────────────
  // doneSet / countMap are passed as props to HeatmapGrid.
  // syncedKey tracks what we last set doneSet from — when habit.completions
  // arrives from outside (e.g. MiniView toggle) and differs from syncedKey,
  // we rebuild. When WE change things, we update syncedKey immediately so
  // the reactive block doesn't fight our local update.

  let doneSet   = buildDoneSet(habit.completions, selectedYear);
  let countMap  = habit.counts ? { ...habit.counts } : {} as Record<string,number>;
  let syncedKey = habit.completions.slice().sort().join(",");

  function buildDoneSet(completions: string[], yr: number): Set<string> {
    return new Set(completions.filter(d => d.startsWith(`${yr}-`)));
  }

  // Resync when habit.completions or counts change from outside
  $: {
    const incomingKey = habit.completions.slice().sort().join(",");
    if (incomingKey !== syncedKey) {
      doneSet   = buildDoneSet(habit.completions, selectedYear);
      countMap  = habit.counts ? { ...habit.counts } : {};
      syncedKey = incomingKey;
    }
  }

  function handleLocalTick(e: CustomEvent<{ dateISO: string; newDoneSet: Set<string>; newCountMap: Record<string,number> }>) {
    doneSet  = e.detail.newDoneSet;
    countMap = e.detail.newCountMap;
    // Update syncedKey so $: resync doesn't fight this local change
    syncedKey = [...doneSet].sort().join(",");
  }

  function handleToggle(e: CustomEvent<{ dateISO: string; completed: boolean }>) {
    const { dateISO, completed } = e.detail;
    const newCompletions = completed
      ? [...habit.completions, dateISO].sort()
      : habit.completions.filter(d => d !== dateISO);
    habit     = { ...habit, completions: newCompletions };
    syncedKey = newCompletions.slice().sort().join(",");
    dispatch("habitUpdated", habit);
  }

  // ── Segmented ring builder ────────────────────────────────────────────
  // Generates SVG arc paths for N segments arranged in a circle.

  function segmentPath(index: number, total: number, r: number, cx: number, cy: number, thickness: number): string {
    const gap = total > 1 ? 0.08 : 0; // gap in radians between segments
    const slice = (2 * Math.PI) / total;
    const start = -Math.PI / 2 + index * slice + gap / 2;
    const end   = -Math.PI / 2 + (index + 1) * slice - gap / 2;
    const r1 = r, r2 = r - thickness;
    const x1 = cx + r1 * Math.cos(start), y1 = cy + r1 * Math.sin(start);
    const x2 = cx + r1 * Math.cos(end),   y2 = cy + r1 * Math.sin(end);
    const x3 = cx + r2 * Math.cos(end),   y3 = cy + r2 * Math.sin(end);
    const x4 = cx + r2 * Math.cos(start), y4 = cy + r2 * Math.sin(start);
    const large = slice - gap > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r1} ${r1} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r2} ${r2} 0 ${large} 0 ${x4} ${y4} Z`;
  }

  // ── Icon badge ────────────────────────────────────────────────────────

  let iconEl: HTMLElement;
  $: if (iconEl) renderIcon(iconEl, habit.icon, habit.name);

  function renderIcon(el: HTMLElement, icon?: string, name?: string) {
    el.empty();
    if (icon) {
      const isEmoji = /\p{Emoji}/u.test(icon);
      if (isEmoji) { el.textContent = icon; }
      else { try { setIcon(el, icon); } catch { el.textContent = (name || "H").slice(0,1).toUpperCase(); } }
    } else {
      el.textContent = (name || "H").slice(0,1).toUpperCase();
    }
  }

  // ── rgba helper ───────────────────────────────────────────────────────

  function rgba(hex: string, a: number): string {
    const c = hex.replace("#","");
    const f = c.length===3 ? c.split("").map(x=>x+x).join("") : c;
    const r=parseInt(f.slice(0,2),16), g=parseInt(f.slice(2,4),16), b=parseInt(f.slice(4,6),16);
    if(isNaN(r)||isNaN(g)||isNaN(b)) return `rgba(99,99,99,${a})`;
    return `rgba(${r},${g},${b},${a})`;
  }

  // ── Today toggle ──────────────────────────────────────────────────────

  async function toggleToday(e: MouseEvent) {
    e.stopPropagation();
    if (togglingToday) return;
    togglingToday = true;
    const wasComplete = doneSet.has(todayISO);

    // Update doneSet immediately
    const newDoneSet = new Set(doneSet);
    if (wasComplete) newDoneSet.delete(todayISO);
    else             newDoneSet.add(todayISO);
    doneSet = newDoneSet;

    // Update habit.completions and syncedKey together
    const newCompletions = wasComplete
      ? habit.completions.filter(d => d !== todayISO)
      : [...habit.completions, todayISO];
    habit    = { ...habit, completions: newCompletions };
    syncedKey = newCompletions.slice().sort().join(",");
    dispatch("habitUpdated", habit);

    try {
      await dataManager.toggleCompletion(habit.id, todayISO);
    } catch (_e) {
      const rolled = wasComplete
        ? [...habit.completions, todayISO]
        : habit.completions.filter(d => d !== todayISO);
      doneSet   = buildDoneSet(rolled, selectedYear);
      habit     = { ...habit, completions: rolled };
      syncedKey = rolled.slice().sort().join(",");
      dispatch("habitUpdated", habit);
    } finally { togglingToday = false; }
  }

  // ── Fold / Unfold ─────────────────────────────────────────────────────

  function toggleOpen() {
    dispatch("toggleOpen", { id: habit.id, open: !isOpen });
  }

  // ── Counter tap ───────────────────────────────────────────────────────
  // Single tap increments. At target, next tap resets to 0.
  // No negative entries, no over-target entries.

  async function tapCounter(e: MouseEvent) {
    e.stopPropagation();
    if (counterBusy) return;
    counterBusy = true;

    const current  = countMap[todayISO] ?? 0;
    const isReset  = current >= target;
    const newCount = isReset ? 0 : current + 1;

    // Update countMap and doneSet immediately
    const newCountMap = { ...countMap };
    if (newCount === 0) delete newCountMap[todayISO];
    else newCountMap[todayISO] = newCount;
    countMap = newCountMap;

    const newDoneSet = new Set(doneSet);
    if (newCount >= target) newDoneSet.add(todayISO);
    else newDoneSet.delete(todayISO);
    doneSet = newDoneSet;

    const newCompletions = newCount >= target
      ? [...new Set([...habit.completions, todayISO])].sort()
      : habit.completions.filter(d => d !== todayISO);
    habit     = { ...habit, counts: countMap, completions: newCompletions };
    syncedKey = newCompletions.slice().sort().join(",");
    dispatch("habitUpdated", habit);

    try {
      if (isReset) {
        let c = current;
        while (c > 0) { await dataManager.decrementCount(habit.id, todayISO); c--; }
      } else {
        await dataManager.incrementCount(habit.id, todayISO);
      }
    } catch (_e) {
      // Roll back
      const rolled = { ...countMap, [todayISO]: current };
      countMap = rolled;
      habit = { ...habit, counts: countMap };
      dispatch("habitUpdated", habit);
    } finally {
      counterBusy = false;
    }
  }

  // ── Heatmap toggle ────────────────────────────────────────────────────

  // ── Edit / Archive / Delete ───────────────────────────────────────────

  function openEditModal(e: MouseEvent) {
    e.stopPropagation();
    new HabitEditModal(plugin.app, plugin, habit, (updated) => {
      habit = updated;
      dispatch("habitUpdated", updated);
    }).open();
  }

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
  style="--hc:{habit.color}; --hc15:{rgba(habit.color,.15)}; --hc25:{rgba(habit.color,.25)};"
>

  <!-- Delete confirm -->
  {#if showDeleteConfirm}
    <div class="del-overlay" transition:fade={{ duration:140 }}>
      <div>
        <p class="del-msg">Delete <strong>{habit.name}</strong>?</p>
        <p class="del-sub">Removes all history permanently.</p>
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
      on:keydown={(e) => (e.key==="Enter"||e.key===" ") && toggleOpen()}
    >

      <!-- Drag grip -->
      {#if !compact}
        <div
          class="grip"
          aria-hidden="true"
          on:mousedown|stopPropagation={() => dispatch("handleMousedown")}
          on:mouseup|stopPropagation={() => dispatch("handleMouseup")}
          on:click|stopPropagation
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
            <circle cx="2" cy="2"  r="1.2"/><circle cx="6" cy="2"  r="1.2"/>
            <circle cx="2" cy="6"  r="1.2"/><circle cx="6" cy="6"  r="1.2"/>
            <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
          </svg>
        </div>
      {/if}

      <!-- Icon badge -->
      <div class="icon-badge" bind:this={iconEl}
        style="background:{rgba(habit.color,.2)}; color:{habit.color};">
      </div>

      <!-- Name + quote -->
      <div class="identity">
        <span class="name-text">{habit.name}</span>
        {#if habit.quote && !compact}
          <span class="quote-text">{habit.quote}</span>
        {/if}
      </div>

      <!-- Right controls — stop propagation so they don't fold/unfold -->
      <div class="hright" on:click|stopPropagation>

        <!-- Streak pill -->
        {#if stats.currentStreak > 0 && !compact}
          <div class="streak-pill">
            <span class="streak-flame">🔥</span>
            <span class="streak-num">{stats.currentStreak}</span>
            <span class="streak-label">day streak</span>
          </div>
        {/if}

        <!-- Counter segmented ring -->
        {#if isCounter}
          <button
            class="counter-ring-btn"
            class:counter-ring-done={counterDone}
            class:counter-ring-busy={counterBusy}
            on:click={tapCounter}
            title="{counterDone ? 'Done! Tap to reset' : 'Tap to log · '+todayCount+'/'+target+(habit.unit?' '+habit.unit:'')}"
            aria-label="{habit.name}: {todayCount} of {target} done today"
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              {#if counterDone}
                <!-- Fully done: solid fill + checkmark -->
                <rect width="32" height="32" rx="8" fill="{habit.color}"/>
                <path d="M7 16L13 22L25 10" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              {:else}
                <!-- Base: light background -->
                <rect width="32" height="32" rx="8" fill="{rgba(habit.color, 0.1)}"/>
                <!-- Segments: each is an arc path -->
                {#each Array(target) as _, i}
                  <path
                    d={segmentPath(i, target, 14, 16, 16, 5)}
                    fill="{i < todayCount ? habit.color : rgba(habit.color, 0.2)}"
                    transition:fade="{{ duration: 150 }}"
                  />
                {/each}
              {/if}
            </svg>
          </button>

        <!-- Boolean checkbox -->
        {:else}
          <button
            class="chk-btn"
            class:chk-done={completedToday}
            class:chk-busy={togglingToday}
            on:click={toggleToday}
            title="{completedToday ? 'Done today — click to unmark' : 'Mark done today'}"
          >
            {#if completedToday}
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="8" fill="{habit.color}"/>
                <path d="M7 16L13 22L25 10" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {:else}
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="1.2" y="1.2" width="29.6" height="29.6" rx="7"
                  fill="{habit.color}" fill-opacity="0.12"
                  stroke="{habit.color}" stroke-width="1.8"/>
              </svg>
            {/if}
          </button>
        {/if}

        <!-- Chevron -->
        <button class="chevron-btn" on:click={toggleOpen} aria-label="{isOpen ? 'Collapse' : 'Expand'}">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            style="transition:transform 200ms ease; transform:rotate({isOpen ? 180 : 0}deg);">
            <polyline points="2.5 4.5 6.5 8.5 10.5 4.5"/>
          </svg>
        </button>

      </div>
    </div>

    <!-- ── Expanded body ── -->
    {#if isOpen}
      <div class="body" transition:slide={{ duration:200, easing:quintOut }}>

        <!-- Heatmap + toolbar row -->
        <div class="heatmap-row">
          <div class="heatmap-wrap">
            <HeatmapGrid
              {habit} year={selectedYear} {dataManager}
              {weekStartsOn} {compact}
              {doneSet} {countMap}
              on:localTick={handleLocalTick}
              on:toggle={handleToggle}
            />
          </div>

          <!-- Vertical toolbar: info + edit + archive + delete -->
          {#if !compact}
            <div class="toolbar">
              <!-- Stats toggle -->
              <button
                class="tb-btn"
                class:tb-btn-active={showStats}
                on:click|stopPropagation={() => (showStats = !showStats)}
                title="{showStats ? 'Hide stats' : 'Show stats'}"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="8" stroke-width="3"/>
                  <line x1="12" y1="12" x2="12" y2="16"/>
                </svg>
              </button>

              <div class="tb-divider"></div>

              <!-- Edit -->
              <button class="tb-btn" on:click={openEditModal} title="Edit habit">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/>
                </svg>
              </button>

              <!-- Archive -->
              <button class="tb-btn" on:click={handleArchive} title="Archive">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <polyline points="21 8 21 21 3 21 3 8"/>
                  <rect x="1" y="3" width="22" height="5"/>
                  <line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              </button>

              <!-- Delete -->
              <button class="tb-btn tb-btn-danger" on:click={requestDelete} title="Delete">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4h6v2"/>
                </svg>
              </button>
            </div>
          {/if}
        </div>

        <!-- Stats — toggled by info button -->
        {#if !compact && showStats}
          <div transition:slide={{ duration:160, easing:cubicOut }}>
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
    border-radius: 10px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    overflow: hidden;
    transition: border-color 180ms ease, box-shadow 180ms ease;
  }

  .card:hover {
    border-color: color-mix(in srgb, var(--hc) 35%, var(--background-modifier-border));
  }

  .card.is-open {
    border-color: color-mix(in srgb, var(--hc) 50%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--hc) 10%, transparent);
  }

  /* ── Delete overlay ── */
  .del-overlay {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 10px 14px; flex-wrap: wrap;
    background: rgba(229,62,62,.07); border-left: 3px solid #e53e3e;
  }

  .del-msg  { margin: 0; font-size: .83rem; color: var(--text-normal); }
  .del-msg strong { color: #e53e3e; }
  .del-sub  { margin: 2px 0 0; font-size: .74rem; color: var(--text-muted); }
  .del-btns { display: flex; gap: 6px; }
  .del-btn  { border: none; border-radius: 6px; padding: 5px 14px; font-size: .78rem; font-weight: 500; cursor: pointer; transition: opacity 120ms; }
  .del-cancel  { background: var(--background-modifier-border); color: var(--text-normal); }
  .del-confirm { background: #e53e3e; color: #fff; }
  .del-btn:hover { opacity: .85; }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 8px;
    cursor: pointer;
    user-select: none;
    border-left: 3px solid transparent;
    transition: border-color 200ms ease, background 120ms ease;
  }

  .card.is-open .header {
    border-left-color: var(--hc);
    padding-left: 5px;
  }

  .header:hover { background: color-mix(in srgb, var(--hc) 6%, transparent); }
  .card.is-open .header:hover { background: color-mix(in srgb, var(--hc) 9%, transparent); }
  .header:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }

  /* ── Grip ── */
  .grip {
    cursor: grab; color: var(--text-faint); padding: 2px 2px;
    border-radius: 3px; flex-shrink: 0; display: flex; align-items: center;
    opacity: 0; transition: opacity 150ms ease;
  }
  .header:hover .grip { opacity: 1; }
  .grip:active { cursor: grabbing; }

  /* ── Icon badge ── */
  .icon-badge {
    flex-shrink: 0;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 600;
    overflow: hidden;
  }

  .icon-badge :global(svg) {
    width: 20px; height: 20px;
    stroke: currentColor; fill: none;
  }

  /* ── Identity ── */
  .identity {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .name-text {
    font-size: .88rem;
    font-weight: 600;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }

  .quote-text {
    font-size: .72rem;
    color: var(--text-muted);
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
    margin-top: 1px;
  }

  /* ── Right controls ── */
  .hright {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* ── Streak pill ── */
  .streak-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 9px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--hc) 12%, var(--background-secondary));
    border: 1px solid color-mix(in srgb, var(--hc) 25%, transparent);
    white-space: nowrap;
  }

  .streak-flame { font-size: 12px; line-height: 1; }
  .streak-num   { font-size: .78rem; font-weight: 700; color: var(--hc); }
  .streak-label { font-size: .72rem; color: var(--text-muted); }

  /* ── Today checkbox ── */
  .chk-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    flex-shrink: 0;
    transition: transform 130ms ease, opacity 120ms ease;
  }

  .chk-btn:hover:not(.chk-busy) { transform: scale(1.08); }
  .chk-btn:active { transform: scale(.9); }
  .chk-btn.chk-busy { opacity: .5; pointer-events: none; }

  .chk-btn.chk-done svg {
    animation: chk-spring 280ms cubic-bezier(.34,1.56,.64,1);
  }

  @keyframes chk-spring {
    0%  { transform: scale(.55) rotate(-8deg); opacity: .6; }
    60% { transform: scale(1.12) rotate(2deg); }
    100%{ transform: scale(1) rotate(0deg); opacity: 1; }
  }

  /* ── Counter ring button ── */
  .counter-ring-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    flex-shrink: 0;
    transition: transform 130ms ease, opacity 120ms ease;
  }

  .counter-ring-btn:hover:not(.counter-ring-busy) { transform: scale(1.08); }
  .counter-ring-btn:active { transform: scale(.92); }
  .counter-ring-btn.counter-ring-busy { opacity: .5; pointer-events: none; }

  .counter-ring-btn.counter-ring-done svg {
    animation: chk-spring 280ms cubic-bezier(.34,1.56,.64,1);
  }

  /* ── Chevron button ── */
  .chevron-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    color: var(--text-muted);
    flex-shrink: 0;
    transition: background 120ms ease, color 120ms ease;
  }

  .chevron-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  /* ── Body ── */
  .body {
    padding: 0 0 8px;
    border-top: 1px solid var(--background-modifier-border);
  }

  /* ── Heatmap row ── */
  .heatmap-row {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 6px 6px 0;
  }

  .heatmap-wrap { flex: 1; min-width: 0; }

  /* ── Vertical toolbar ── */
  .toolbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    padding-top: 2px;
  }

  .tb-btn {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 5px;
    color: var(--text-faint);
    transition: color 120ms ease, background 120ms ease;
  }

  .tb-btn:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
  .tb-btn-active { color: var(--interactive-accent) !important; background: color-mix(in srgb, var(--interactive-accent) 12%, transparent) !important; }
  .tb-btn-danger:hover { color: #e53e3e; background: rgba(229,62,62,.1); }

  .tb-divider {
    width: 16px;
    height: 1px;
    background: var(--background-modifier-border);
    margin: 2px 0;
  }

  /* ── Compact ── */
  .compact .header { padding: 6px 8px; }
  .compact .icon-badge { width: 28px; height: 28px; border-radius: 8px; font-size: 13px; }
  .compact .name-text { font-size: .8rem; }
  .compact .grip { display: none; }
</style>
