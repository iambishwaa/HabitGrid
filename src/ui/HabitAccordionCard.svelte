<!-- HabitAccordionCard.svelte -->

<script lang="ts">
  import { slide, fade } from "svelte/transition";
  import { cubicOut, quintOut } from "svelte/easing";
  import { createEventDispatcher } from "svelte";
  import type { Habit } from "../types";
  import type { DataManager } from "../DataManager";
  import { computeStreakStats } from "../DataManager";
  import HeatmapGrid from "./HeatmapGrid.svelte";
  import StatsFooter from "./StatsFooter.svelte";

  export let habit: Habit;
  export let dataManager: DataManager;
  export let weekStartsOn: 0 | 1 = 1;
  export let selectedYear: number;
  export let isOpen: boolean = false;
  export let compact: boolean = false;

  const dispatch = createEventDispatcher<{
    archive:        { id: string };
    delete:         { id: string };
    habitUpdated:   Habit;
    toggleOpen:     { id: string; open: boolean };
    handleMousedown: void;
    handleMouseup:   void;
  }>();

  let showMenu = false;
  let showDeleteConfirm = false;
  let togglingToday = false;
  let isEditingQuote = false;
  let quoteInputValue = habit.quote;
  let quoteInputEl: HTMLInputElement;
  let isEditingName = false;
  let nameInputValue = habit.name;
  let nameInputEl: HTMLInputElement;

  $: stats = computeStreakStats(habit.completions);
  $: todayISO = new Date().toISOString().slice(0, 10);
  $: completedToday = habit.completions.includes(todayISO);

  // ── Today checkbox ─────────────────────────────────────────────────────

  async function toggleToday(e: MouseEvent) {
    e.stopPropagation();
    if (togglingToday) return;
    togglingToday = true;
    const wasComplete = completedToday;
    // Optimistic
    habit = { ...habit, completions: wasComplete
      ? habit.completions.filter(d => d !== todayISO)
      : [...habit.completions, todayISO]
    };
    try {
      await dataManager.toggleCompletion(habit.id, todayISO);
      const fresh = await dataManager.getHabit(habit.id);
      if (fresh) { habit = fresh; dispatch("habitUpdated", fresh); }
    } catch (_e) {
      habit = { ...habit, completions: wasComplete
        ? [...habit.completions, todayISO]
        : habit.completions.filter(d => d !== todayISO)
      };
    } finally {
      togglingToday = false;
    }
  }

  // ── Fold / Unfold ──────────────────────────────────────────────────────

  function toggleOpen() {
    if (isEditingName || isEditingQuote) return;
    showMenu = false;
    dispatch("toggleOpen", { id: habit.id, open: !isOpen });
  }

  // ── Name editing ───────────────────────────────────────────────────────

  function startEditingName() {
    showMenu = false;
    nameInputValue = habit.name;
    isEditingName = true;
    setTimeout(() => nameInputEl?.focus(), 30);
  }

  async function commitName() {
    isEditingName = false;
    const t = nameInputValue.trim();
    if (!t || t === habit.name) { nameInputValue = habit.name; return; }
    await dataManager.updateHabit(habit.id, { name: t });
    habit = { ...habit, name: t };
    dispatch("habitUpdated", habit);
  }

  function nameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter")  { e.preventDefault(); commitName(); }
    if (e.key === "Escape") { isEditingName = false; nameInputValue = habit.name; }
  }

  // ── Quote editing ──────────────────────────────────────────────────────

  function startEditingQuote() {
    quoteInputValue = habit.quote;
    isEditingQuote = true;
    setTimeout(() => quoteInputEl?.focus(), 30);
  }

  async function commitQuote() {
    isEditingQuote = false;
    const t = quoteInputValue.trim();
    if (t === habit.quote) return;
    await dataManager.updateHabit(habit.id, { quote: t });
    habit = { ...habit, quote: t };
  }

  function quoteKeydown(e: KeyboardEvent) {
    if (e.key === "Enter")  { e.preventDefault(); commitQuote(); }
    if (e.key === "Escape") { isEditingQuote = false; quoteInputValue = habit.quote; }
  }

  // ── Heatmap toggle ─────────────────────────────────────────────────────
  // HeatmapGrid tells us exactly what changed — use it directly.
  // No async getHabit() needed; the card updates in the same tick.

  function handleToggle(e: CustomEvent<{ dateISO: string; completed: boolean }>) {
    const { dateISO, completed } = e.detail;
    const newCompletions = completed
      ? [...habit.completions, dateISO].sort()
      : habit.completions.filter(d => d !== dateISO);
    habit = { ...habit, completions: newCompletions };
    dispatch("habitUpdated", habit);
  }

  // ── Archive / Delete ───────────────────────────────────────────────────

  async function handleArchive() {
    showMenu = false;
    await dataManager.archiveHabit(habit.id);
    dispatch("archive", { id: habit.id });
  }

  function requestDelete() { showMenu = false; showDeleteConfirm = true; }

  async function confirmDelete() {
    showDeleteConfirm = false;
    await dataManager.deleteHabit(habit.id);
    dispatch("delete", { id: habit.id });
  }

  // Close menu on outside click
  function onWindowClick() { if (showMenu) showMenu = false; }
</script>

<svelte:window on:click={onWindowClick} />

<!-- ── Markup ──────────────────────────────────────────────────────────────── -->

<div
  class="card"
  class:is-open={isOpen}
  class:compact
  style="--hc:{habit.color};"
>

  <!-- Delete confirm -->
  {#if showDeleteConfirm}
    <div class="del-confirm" transition:fade={{ duration:140 }}>
      <span class="del-text">Delete <strong>{habit.name}</strong> and all history?</span>
      <div class="del-btns">
        <button class="cbtn cbtn-cancel" on:click={() => (showDeleteConfirm = false)}>Cancel</button>
        <button class="cbtn cbtn-del" on:click={confirmDelete}>Delete forever</button>
      </div>
    </div>

  {:else}
    <!-- Header — the entire row is the click target for fold/unfold -->
    <div
      class="header"
      role="button"
      tabindex="0"
      aria-expanded={isOpen}
      on:click={toggleOpen}
      on:keydown={(e) => (e.key==="Enter"||e.key===" ") && toggleOpen()}
    >
      <!-- Drag handle: dispatches to parent so parent sets draggable -->
      <div
        class="drag-handle"
        aria-hidden="true"
        on:mousedown|stopPropagation={() => dispatch("handleMousedown")}
        on:mouseup|stopPropagation={() => dispatch("handleMouseup")}
        on:click|stopPropagation
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" opacity="0.4">
          <circle cx="3" cy="2.5" r="1.5"/><circle cx="7" cy="2.5" r="1.5"/>
          <circle cx="3" cy="7"   r="1.5"/><circle cx="7" cy="7"   r="1.5"/>
          <circle cx="3" cy="11.5" r="1.5"/><circle cx="7" cy="11.5" r="1.5"/>
        </svg>
      </div>

      <!-- Today checkbox — stopPropagation so it doesn't fold/unfold -->
      <button
        class="chk"
        class:chk-done={completedToday}
        class:chk-busy={togglingToday}
        on:click={toggleToday}
        aria-label="{completedToday?'Unmark':'Mark'} {habit.name} done today"
        title="{completedToday?'Done today — click to unmark':'Mark as done today'}"
      >
        {#if completedToday}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect width="16" height="16" rx="3" fill="{habit.color}"/>
            <path d="M3.5 8L6.5 11L12.5 5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="2.5"
              fill="{habit.color}" fill-opacity="0.15"
              stroke="{habit.color}" stroke-width="1.5"/>
          </svg>
        {/if}
      </button>

      <!-- Name — part of the fold/unfold zone, no stopPropagation -->
      <div class="hname">
        {#if isEditingName}
          <input
            bind:this={nameInputEl}
            bind:value={nameInputValue}
            class="name-input"
            on:blur={commitName}
            on:keydown={nameKeydown}
            on:click|stopPropagation
            aria-label="Edit habit name"
          />
        {:else}
          <span class="name-text">{habit.name}</span>
        {/if}
      </div>

      <!-- Right: menu + chevron — stopPropagation so they don't fold/unfold -->
      <div class="hright" on:click|stopPropagation>
        <div class="menu-wrap">
          <button
            class="menu-btn"
            on:click={() => (showMenu = !showMenu)}
            aria-haspopup="true"
            aria-expanded={showMenu}
            title="Options"
          >
            <svg width="14" height="3" viewBox="0 0 14 3" fill="currentColor">
              <circle cx="1.5" cy="1.5" r="1.5"/>
              <circle cx="7"   cy="1.5" r="1.5"/>
              <circle cx="12.5" cy="1.5" r="1.5"/>
            </svg>
          </button>

          {#if showMenu}
            <div class="dropdown" role="menu" transition:slide={{ duration:120, easing:cubicOut }}>
              <button class="ditem" role="menuitem" on:click={startEditingName}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                Rename
              </button>
              <div class="ddiv"></div>
              <button class="ditem" role="menuitem" on:click={handleArchive}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                Archive
              </button>
              <div class="ddiv"></div>
              <button class="ditem ditem-danger" role="menuitem" on:click={requestDelete}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                Delete
              </button>
            </div>
          {/if}
        </div>

        <span class="chevron" class:open={isOpen} aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <polyline points="2.5 4 5.5 7 8.5 4"/>
          </svg>
        </span>
      </div>
    </div>
  {/if}

  <!-- Expanded body -->
  {#if isOpen && !showDeleteConfirm}
    <div class="body" transition:slide={{ duration:200, easing:quintOut }}>

      {#if !compact}
        <div class="quote-row">
          {#if isEditingQuote}
            <input bind:this={quoteInputEl} bind:value={quoteInputValue}
              class="quote-input" placeholder="add a motivational note…"
              on:blur={commitQuote} on:keydown={quoteKeydown}/>
          {:else}
            <button class="quote-text" on:click={startEditingQuote} title="Click to edit">
              {habit.quote || "click to add a motivational note…"}
            </button>
          {/if}
        </div>
      {/if}

      <div class="heatmap-wrap">
        <HeatmapGrid
          {habit} year={selectedYear} {dataManager} {weekStartsOn} {compact}
          on:toggle={handleToggle}
        />
      </div>

      {#if !compact}
        <StatsFooter {stats} createdDate={habit.createdDate} habitColor={habit.color} />
      {/if}

    </div>
  {/if}

</div>

<style>
  /* Card */
  .card { border-radius:8px; border:1px solid var(--background-modifier-border); background:var(--background-primary); overflow:visible; transition:border-color 180ms,box-shadow 180ms; }
  .card:hover { border-color:color-mix(in srgb,var(--hc) 35%,transparent); }
  .card.is-open { border-color:color-mix(in srgb,var(--hc) 50%,transparent); box-shadow:0 2px 10px color-mix(in srgb,var(--hc) 10%,transparent); overflow:hidden; }

  /* Delete confirm */
  .del-confirm { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:10px 14px; background:rgba(229,62,62,.08); border-radius:8px; }
  .del-text { font-size:.82rem; color:var(--text-normal); }
  .del-text strong { color:#e53e3e; }
  .del-btns { display:flex; gap:8px; }
  .cbtn { border:none; border-radius:5px; padding:4px 12px; font-size:.78rem; font-weight:500; cursor:pointer; transition:opacity 120ms; }
  .cbtn-cancel { background:var(--background-modifier-border); color:var(--text-normal); }
  .cbtn-del { background:#e53e3e; color:#fff; }
  .cbtn:hover { opacity:.85; }

  /* Header */
  .header {
    display:flex; align-items:center; gap:6px;
    padding:8px 10px 8px 8px;
    cursor:pointer; user-select:none;
    border-left:3px solid transparent;
    border-radius:8px;
    transition:border-color 180ms, background 120ms;
  }
  .card.is-open .header { border-left-color:var(--hc); border-radius:8px 8px 0 0; padding-left:5px; }
  .header:hover { background:var(--background-modifier-hover); }
  .header:focus-visible { outline:2px solid var(--interactive-accent); outline-offset:-2px; }

  /* Drag handle */
  .drag-handle { cursor:grab; padding:2px 3px; color:var(--text-faint); flex-shrink:0; display:flex; align-items:center; border-radius:3px; transition:color 120ms; }
  .drag-handle:hover { color:var(--text-muted); }
  .drag-handle:active { cursor:grabbing; }

  /* Today checkbox */
  .chk { all:unset; cursor:pointer; flex-shrink:0; display:flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:3px; transition:transform 120ms,opacity 120ms; }
  .chk:hover { transform:scale(1.12); }
  .chk:active { transform:scale(.95); }
  .chk.chk-busy { opacity:.5; pointer-events:none; }
  .chk.chk-done svg { animation:pop 200ms cubic-bezier(.34,1.56,.64,1); }
  @keyframes pop { 0%{transform:scale(.7)} 60%{transform:scale(1.15)} 100%{transform:scale(1)} }

  /* Name */
  .hname { flex:1; min-width:0; overflow:hidden; }
  .name-text { font-size:.88rem; font-weight:500; color:var(--text-normal); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; }
  .name-input { font-size:.88rem; font-weight:500; background:var(--background-modifier-form-field); border:1px solid var(--interactive-accent); border-radius:4px; padding:1px 6px; color:var(--text-normal); width:100%; outline:none; box-sizing:border-box; }

  /* Right */
  .hright { display:flex; align-items:center; gap:3px; flex-shrink:0; }

  /* Menu button */
  .menu-wrap { position:relative; }
  .menu-btn { background:none; border:1px solid transparent; cursor:pointer; color:var(--text-muted); padding:4px 7px; border-radius:5px; display:flex; align-items:center; justify-content:center; transition:color 120ms,background 120ms,border-color 120ms; }
  .menu-btn:hover { color:var(--text-normal); background:var(--background-modifier-hover); border-color:var(--background-modifier-border); }

  /* Dropdown */
  .dropdown { position:absolute; top:calc(100% + 4px); right:0; background:var(--background-primary); border:1px solid var(--background-modifier-border); border-radius:8px; box-shadow:0 4px 18px rgba(0,0,0,.15); min-width:140px; z-index:200; padding:4px; }
  .ditem { display:flex; align-items:center; gap:8px; width:100%; background:none; border:none; padding:7px 10px; font-size:.82rem; color:var(--text-normal); cursor:pointer; border-radius:5px; text-align:left; transition:background 100ms; }
  .ditem:hover { background:var(--background-modifier-hover); }
  .ditem-danger { color:#e53e3e; }
  .ditem-danger:hover { background:rgba(229,62,62,.1); }
  .ddiv { height:1px; background:var(--background-modifier-border); margin:3px 0; }

  /* Chevron */
  .chevron { color:var(--text-muted); display:flex; align-items:center; transition:transform 200ms; }
  .chevron.open { transform:rotate(180deg); }

  /* Body */
  .body { padding:0 14px 12px; border-top:1px solid var(--background-modifier-border); }

  /* Quote */
  .quote-row { padding:7px 0 4px; }
  .quote-text { all:unset; font-size:.76rem; color:var(--text-muted); font-style:italic; cursor:text; border-radius:3px; padding:1px 3px; margin-left:-3px; display:block; width:100%; transition:background 120ms,color 120ms; }
  .quote-text:hover { background:var(--background-modifier-hover); color:var(--text-normal); }
  .quote-input { width:100%; font-size:.76rem; font-style:italic; background:var(--background-modifier-form-field); border:1px solid var(--interactive-accent); border-radius:4px; padding:2px 8px; color:var(--text-normal); outline:none; box-sizing:border-box; }

  .heatmap-wrap { margin-top:6px; }

  /* Compact */
  .compact .header { padding:6px 8px 6px 6px; }
  .compact .body { padding:0 8px 8px; }
  .compact .name-text { font-size:.8rem; }
</style>
