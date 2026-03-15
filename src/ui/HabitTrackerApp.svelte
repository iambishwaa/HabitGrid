<!-- HabitTrackerApp.svelte -->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { quintOut } from "svelte/easing";
  import type HabitTrackerPlugin from "../main";
  import type { Habit } from "../types";
  import HabitAccordionCard from "./HabitAccordionCard.svelte";
  import HabitCreateModal from "../HabitCreateModal";

  export let plugin: HabitTrackerPlugin;
  export let refreshKey: number = 0;

  let habits: Habit[] = [];
  let archivedHabits: Habit[] = [];
  let loading = true;
  let error: string | null = null;

  const currentYear = new Date().getFullYear();
  let selectedYear = currentYear;
  let openHabitIds = new Set<string>();
  let archivedSectionOpen = false;
  let uiStateLoaded = false;

  let compact = false;
  let containerEl: HTMLElement;
  let ro: ResizeObserver;

  // Drag state
  let dragSrcIndex: number | null = null;
  let dragOverIndex: number | null = null;
  // Which index has draggable=true right now (only active when handle grabbed)
  let draggableIndex: number | null = null;

  $: canGoPrev = selectedYear > 2020;
  $: canGoNext = selectedYear < currentYear;
  $: if (refreshKey >= 0) loadHabits();

  let persistTimer: ReturnType<typeof setTimeout>;
  $: {
    selectedYear; openHabitIds; archivedSectionOpen;
    if (uiStateLoaded) {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(persistUIState, 800);
    }
  }

  // ── Data ───────────────────────────────────────────────────────────────

  async function loadHabits() {
    try {
      [habits, archivedHabits] = await Promise.all([
        plugin.dataManager.getActiveHabits(),
        plugin.dataManager.getArchivedHabits(),
      ]);
      if (!uiStateLoaded) {
        const ui = await plugin.dataManager.getUIState();
        selectedYear = ui.selectedYear ?? currentYear;
        openHabitIds = new Set(ui.openHabitIds ?? []);
        archivedSectionOpen = ui.archivedSectionOpen ?? false;
        uiStateLoaded = true;
      }
      error = null;
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  async function persistUIState() {
    await plugin.dataManager.saveUIState({
      selectedYear,
      openHabitIds: [...openHabitIds],
      archivedSectionOpen,
    });
  }

  // ── Year nav ───────────────────────────────────────────────────────────

  function prevYear() { if (canGoPrev) selectedYear--; }
  function nextYear() { if (canGoNext) selectedYear++; }

  // ── Accordion state ────────────────────────────────────────────────────

  function handleToggleOpen(e: CustomEvent<{ id: string; open: boolean }>) {
    const { id, open } = e.detail;
    const next = new Set(openHabitIds);
    if (open) next.add(id); else next.delete(id);
    openHabitIds = next;
  }

  function updateHabit(updated: Habit) {
    habits = habits.map(h => h.id === updated.id ? updated : h);
  }

  function removeHabit(id: string) {
    habits = habits.filter(h => h.id !== id);
    const next = new Set(openHabitIds);
    next.delete(id);
    openHabitIds = next;
  }

  async function handleArchive(e: CustomEvent<{ id: string }>) {
    removeHabit(e.detail.id);
    archivedHabits = await plugin.dataManager.getArchivedHabits();
  }

  async function handleUnarchive(id: string) {
    await plugin.dataManager.unarchiveHabit(id);
    [habits, archivedHabits] = await Promise.all([
      plugin.dataManager.getActiveHabits(),
      plugin.dataManager.getArchivedHabits(),
    ]);
  }

  // ── Drag and drop ──────────────────────────────────────────────────────
  //
  // KEY: draggable is only set to true on the item whose drag handle was
  // grabbed. This prevents the draggable attr from interfering with clicks
  // on the rest of the card (fold/unfold, checkboxes, etc.)

  function onHandleMousedown(index: number) {
    draggableIndex = index;
  }

  function onHandleMouseup() {
    // If drag never started, clear it
    if (dragSrcIndex === null) draggableIndex = null;
  }

  function onDragStart(e: DragEvent, index: number) {
    if (draggableIndex !== index) { e.preventDefault(); return; }
    dragSrcIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }
  }

  function onDragOver(e: DragEvent, index: number) {
    if (dragSrcIndex === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dragOverIndex = index;
  }

  function onDragLeave(e: DragEvent) {
    // Only clear if leaving the list area entirely
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !related.closest(".habit-item")) dragOverIndex = null;
  }

  async function onDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    const src = dragSrcIndex;
    dragSrcIndex = null;
    dragOverIndex = null;
    draggableIndex = null;

    if (src === null || src === targetIndex) return;

    const reordered = [...habits];
    const [moved] = reordered.splice(src, 1);
    reordered.splice(targetIndex, 0, moved);
    habits = reordered;
    await plugin.dataManager.reorderHabits(reordered.map(h => h.id));
  }

  function onDragEnd() {
    dragSrcIndex = null;
    dragOverIndex = null;
    draggableIndex = null;
  }

  // ── Add habit ──────────────────────────────────────────────────────────

  function openCreateModal() {
    new HabitCreateModal(plugin.app, plugin, (newHabit) => {
      habits = [...habits, newHabit];
      openHabitIds = new Set(openHabitIds).add(newHabit.id);
    }).open();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  onMount(() => {
    loadHabits();
    if (containerEl) {
      ro = new ResizeObserver(entries => {
        compact = entries[0].contentRect.width < 340;
      });
      ro.observe(containerEl);
    }
  });

  onDestroy(() => {
    clearTimeout(persistTimer);
    ro?.disconnect();
  });
</script>

<!-- ── Markup ──────────────────────────────────────────────────────────────── -->

<div class="ht-app" bind:this={containerEl} class:compact>

  <!-- Header -->
  <div class="app-header">
    <span class="app-title">Habits</span>

    {#if !compact}
      <div class="year-nav">
        <button class="year-btn" disabled={!canGoPrev} on:click={prevYear}>&lsaquo;</button>
        <span class="year-label">{selectedYear}</span>
        <button class="year-btn" disabled={!canGoNext} on:click={nextYear}>&rsaquo;</button>
      </div>
    {:else}
      <select class="year-select" bind:value={selectedYear}>
        {#each Array.from({length: currentYear - 2019}, (_, i) => currentYear - i) as yr}
          <option value={yr}>{yr}</option>
        {/each}
      </select>
    {/if}

    <button class="add-btn" on:click={openCreateModal}>
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="5.5" y1="1" x2="5.5" y2="10"/>
        <line x1="1" y1="5.5" x2="10" y2="5.5"/>
      </svg>
      {#if !compact}<span>New habit</span>{/if}
    </button>
  </div>

  <!-- Body -->
  {#if loading}
    <div class="state-center"><div class="spinner"></div></div>

  {:else if error}
    <div class="state-center">
      <p class="state-text">Failed to load habits.</p>
      <p class="state-sub">{error}</p>
      <button class="action-btn" on:click={loadHabits}>Retry</button>
    </div>

  {:else if habits.length === 0 && archivedHabits.length === 0}
    <div class="state-center" in:fly={{ y:10, duration:250, easing:quintOut }}>
      <div class="empty-icon">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" opacity="0.3">
          <rect x="3" y="3"   width="8" height="8" rx="2" fill="currentColor" opacity="0.5"/>
          <rect x="14" y="3"  width="8" height="8" rx="2" fill="currentColor" opacity="0.9"/>
          <rect x="25" y="3"  width="8" height="8" rx="2" fill="currentColor" opacity="0.3"/>
          <rect x="3" y="14"  width="8" height="8" rx="2" fill="currentColor"/>
          <rect x="14" y="14" width="8" height="8" rx="2" fill="currentColor" opacity="0.5"/>
          <rect x="25" y="14" width="8" height="8" rx="2" fill="currentColor" opacity="0.8"/>
          <rect x="3" y="25"  width="8" height="8" rx="2" fill="currentColor" opacity="0.6"/>
          <rect x="14" y="25" width="8" height="8" rx="2" fill="currentColor" opacity="0.3"/>
          <rect x="25" y="25" width="8" height="8" rx="2" fill="currentColor"/>
        </svg>
      </div>
      <p class="state-text">No habits yet.</p>
      <p class="state-sub">Track your daily consistency with a heatmap grid.</p>
      <button class="action-btn action-btn--primary" on:click={openCreateModal}>Create your first habit</button>
    </div>

  {:else}
    <div class="habits-list">

      {#each habits as habit, i (habit.id)}
        <div
          class="habit-item"
          class:is-drag-over={dragOverIndex === i && dragSrcIndex !== i}
          class:is-dragging={dragSrcIndex === i}
          draggable={draggableIndex === i}
          role="listitem"
          on:dragstart={(e) => onDragStart(e, i)}
          on:dragover={(e) => onDragOver(e, i)}
          on:dragleave={onDragLeave}
          on:drop={(e) => onDrop(e, i)}
          on:dragend={onDragEnd}
          in:fly={{ y:6, duration:180, delay:i*25, easing:quintOut }}
        >
          <HabitAccordionCard
            {habit}
            {selectedYear}
            {compact}
            isOpen={openHabitIds.has(habit.id)}
            dataManager={plugin.dataManager}
            weekStartsOn={plugin.settings.weekStartsOnMonday ? 1 : 0}
            on:archive={handleArchive}
            on:delete={(e) => removeHabit(e.detail.id)}
            on:toggleOpen={handleToggleOpen}
            on:habitUpdated={(e) => updateHabit(e.detail)}
            on:handleMousedown={() => onHandleMousedown(i)}
            on:handleMouseup={onHandleMouseup}
          />
        </div>
      {/each}

      <!-- Archived section -->
      {#if archivedHabits.length > 0}
        <div class="archived-section">
          <button class="archived-toggle" on:click={() => (archivedSectionOpen = !archivedSectionOpen)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              style="transform:rotate({archivedSectionOpen?180:0}deg);transition:transform 200ms ease;">
              <polyline points="2 3 5 6 8 3"/>
            </svg>
            Archived ({archivedHabits.length})
          </button>

          {#if archivedSectionOpen}
            <div class="archived-list" transition:fly={{ y:-4, duration:160, easing:quintOut }}>
              {#each archivedHabits as ah (ah.id)}
                <div class="archived-item" in:fade={{ duration:120 }}>
                  <div class="archived-swatch" style="background:{ah.color};"></div>
                  <span class="archived-name">{ah.name}</span>
                  <span class="archived-count">{ah.completions.length}</span>
                  <button class="unarchive-btn" on:click={() => handleUnarchive(ah.id)}>Restore</button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

    </div>
  {/if}

</div>

<style>
  .ht-app { display:flex; flex-direction:column; height:100%; overflow:hidden; }

  /* Header */
  .app-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:9px 12px; border-bottom:1px solid var(--background-modifier-border);
    flex-shrink:0; gap:8px;
  }

  .app-title { font-size:0.72rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.07em; white-space:nowrap; }

  .year-nav { display:flex; align-items:center; gap:4px; flex:1; justify-content:center; }
  .year-label { font-size:0.82rem; font-weight:600; color:var(--text-normal); min-width:38px; text-align:center; }
  .year-btn { all:unset; cursor:pointer; font-size:1.2rem; color:var(--text-muted); width:22px; height:22px; display:flex; align-items:center; justify-content:center; border-radius:4px; transition:color 120ms,background 120ms; }
  .year-btn:hover:not(:disabled) { color:var(--text-normal); background:var(--background-modifier-hover); }
  .year-btn:disabled { opacity:0.25; cursor:default; }

  .year-select { font-size:0.78rem; background:var(--background-modifier-form-field); border:1px solid var(--background-modifier-border); border-radius:4px; padding:2px 4px; color:var(--text-normal); }

  .add-btn { display:flex; align-items:center; gap:5px; background:var(--interactive-accent); color:var(--text-on-accent); border:none; border-radius:5px; padding:5px 10px; font-size:0.75rem; font-weight:500; cursor:pointer; white-space:nowrap; transition:opacity 120ms; flex-shrink:0; }
  .add-btn:hover { opacity:0.88; }
  .compact .add-btn { padding:5px 8px; }

  /* Habits list */
  .habits-list { flex:1; overflow-y:auto; padding:8px 10px 12px; display:flex; flex-direction:column; gap:6px; scrollbar-width:thin; scrollbar-color:var(--background-modifier-border) transparent; }
  .habits-list::-webkit-scrollbar { width:4px; }
  .habits-list::-webkit-scrollbar-thumb { background:var(--background-modifier-border); border-radius:3px; }

  /* Drag and drop */
  .habit-item { transition:opacity 150ms ease, transform 150ms ease; position:relative; }
  .habit-item.is-dragging { opacity:0.4; }
  .habit-item.is-drag-over::before {
    content:''; position:absolute; top:-3px; left:6px; right:6px;
    height:2px; background:var(--interactive-accent); border-radius:1px; z-index:10;
  }

  /* Archived */
  .archived-section { margin-top:4px; border-top:1px solid var(--background-modifier-border); padding-top:8px; }
  .archived-toggle { all:unset; cursor:pointer; display:flex; align-items:center; gap:6px; font-size:0.75rem; color:var(--text-muted); padding:3px 4px; border-radius:4px; transition:color 120ms,background 120ms; }
  .archived-toggle:hover { color:var(--text-normal); background:var(--background-modifier-hover); }
  .archived-list { margin-top:5px; display:flex; flex-direction:column; gap:3px; }
  .archived-item { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:6px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); }
  .archived-swatch { width:8px; height:8px; border-radius:2px; flex-shrink:0; opacity:0.6; }
  .archived-name { font-size:0.82rem; color:var(--text-muted); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .archived-count { font-size:0.72rem; color:var(--text-faint); flex-shrink:0; }
  .unarchive-btn { all:unset; cursor:pointer; font-size:0.72rem; color:var(--interactive-accent); padding:2px 7px; border-radius:4px; border:1px solid var(--interactive-accent); transition:background 120ms; flex-shrink:0; }
  .unarchive-btn:hover { background:var(--interactive-accent); color:var(--text-on-accent); }

  /* States */
  .state-center { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:32px 20px; text-align:center; }
  .empty-icon { opacity:0.6; }
  .state-text { margin:0; font-size:0.9rem; font-weight:500; color:var(--text-normal); }
  .state-sub { margin:0; font-size:0.78rem; color:var(--text-muted); max-width:220px; line-height:1.5; }
  .action-btn { margin-top:4px; padding:5px 16px; border-radius:5px; border:none; cursor:pointer; font-size:0.82rem; font-weight:500; background:var(--background-modifier-border); color:var(--text-normal); transition:opacity 120ms; }
  .action-btn--primary { background:var(--interactive-accent); color:var(--text-on-accent); }
  .action-btn:hover { opacity:0.85; }
  .spinner { width:22px; height:22px; border:2px solid var(--background-modifier-border); border-top-color:var(--interactive-accent); border-radius:50%; animation:spin 700ms linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
</style>
