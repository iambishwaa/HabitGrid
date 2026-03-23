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

  // ── localHabit — THE single source of truth for this card ─────────────────
  //
  // The card owns localHabit. All operations update it synchronously before
  // any await. The grid derives its state purely from localHabit.
  //
  // We resync from the incoming `habit` prop only when completions or counts
  // actually change (i.e. an external update from MiniView or another window).
  // We use a "sync signature" to detect this and avoid fighting our own updates.

  let localHabit: Habit = { ...habit, completions: [...habit.completions], counts: habit.counts ? { ...habit.counts } : undefined };
  let syncSig = sigOf(habit);

  function sigOf(h: Habit): string {
    return h.completions.join(",") + "|" + JSON.stringify(h.counts ?? {});
  }

  // Resync localHabit when an external change arrives
  $: {
    const incoming = sigOf(habit);
    if (incoming !== syncSig) {
      localHabit = { ...habit, completions: [...habit.completions], counts: habit.counts ? { ...habit.counts } : undefined };
      syncSig = incoming;
    }
  }

  let showDeleteConfirm = false;
  let togglingToday = false;
  let counterBusy = false;
  let showStats = false;

  $: stats        = computeStreakStats(localHabit.completions);
  $: todayISO     = new Date().toISOString().slice(0,10);
  $: isCounter    = localHabit.kind === "counter";
  $: target       = localHabit.target ?? 1;
  $: todayCount   = isCounter ? (localHabit.counts?.[todayISO] ?? 0) : 0;
  $: completedToday = isCounter ? todayCount >= target : localHabit.completions.includes(todayISO);
  $: counterDone  = isCounter && completedToday;

  // ── Icon badge ─────────────────────────────────────────────────────────────

  let iconEl: HTMLElement;
  $: if (iconEl) renderIcon(iconEl, localHabit.icon, localHabit.name);

  function renderIcon(el: HTMLElement, icon?: string, name?: string) {
    el.empty();
    if (icon) {
      const isEmoji = /\p{Emoji}/u.test(icon);
      if (isEmoji) { el.textContent = icon; }
      else { try { setIcon(el, icon); } catch { el.textContent = (name||"H").slice(0,1).toUpperCase(); } }
    } else { el.textContent = (name||"H").slice(0,1).toUpperCase(); }
  }

  function rgba(hex: string, a: number): string {
    const c=hex.replace("#",""); const f=c.length===3?c.split("").map(x=>x+x).join(""):c;
    const r=parseInt(f.slice(0,2),16),g=parseInt(f.slice(2,4),16),b=parseInt(f.slice(4,6),16);
    if(isNaN(r)||isNaN(g)||isNaN(b)) return `rgba(99,99,99,${a})`; return `rgba(${r},${g},${b},${a})`;
  }

  // ── Helper: update localHabit and dispatch ─────────────────────────────────

  function applyHabit(h: Habit) {
    localHabit = h;
    syncSig    = sigOf(h); // prevent $: resync from fighting this
    dispatch("habitUpdated", h);
  }

  // ── Today checkbox toggle ─────────────────────────────────────────────────

  async function toggleToday(e: MouseEvent) {
    e.stopPropagation();
    if (togglingToday || isCounter) return;
    togglingToday = true;
    const wasComplete = localHabit.completions.includes(todayISO);
    const newCompletions = wasComplete
      ? localHabit.completions.filter(d => d !== todayISO)
      : [...localHabit.completions, todayISO].sort();
    applyHabit({ ...localHabit, completions: newCompletions });
    try {
      await dataManager.toggleCompletion(localHabit.id, todayISO);
    } catch (_e) {
      applyHabit({ ...localHabit, completions: wasComplete ? [...localHabit.completions, todayISO] : localHabit.completions.filter(d => d !== todayISO) });
    } finally { togglingToday = false; }
  }

  // ── Counter tap ────────────────────────────────────────────────────────────
  //
  // Tap increments 0 → 1 → ... → target (complete, full ring + check).
  // One more tap resets to 0. No tap ever does nothing. No negative values.

  async function tapCounter(e: MouseEvent) {
    e.stopPropagation();
    if (counterBusy) return;
    counterBusy = true;

    const current  = todayCount;
    const newCount = current >= target ? 0 : current + 1;
    const newCounts = { ...(localHabit.counts ?? {}) };
    if (newCount <= 0) delete newCounts[todayISO];
    else newCounts[todayISO] = newCount;

    const newCompletions = newCount >= target
      ? [...new Set([...localHabit.completions, todayISO])].sort()
      : localHabit.completions.filter(d => d !== todayISO);

    applyHabit({ ...localHabit, counts: newCounts, completions: newCompletions });

    try {
      await dataManager.setCount(localHabit.id, todayISO, newCount);
    } catch (_e) {
      // Roll back
      const rolled = { ...(localHabit.counts ?? {}), [todayISO]: current };
      applyHabit({ ...localHabit, counts: rolled });
    } finally { counterBusy = false; }
  }

  // ── Grid toggle (from cell click) ─────────────────────────────────────────

  function handleGridToggle(e: CustomEvent<{ dateISO: string; completed: boolean; newHabit: Habit }>) {
    applyHabit(e.detail.newHabit);
  }

  // ── Fold / Unfold ─────────────────────────────────────────────────────────

  function toggleOpen() {
    dispatch("toggleOpen", { id: localHabit.id, open: !isOpen });
  }

  // ── Edit / Archive / Delete ────────────────────────────────────────────────

  function openEditModal(e: MouseEvent) {
    e.stopPropagation();
    new HabitEditModal(plugin.app, plugin, localHabit, (updated) => {
      applyHabit(updated);
    }).open();
  }

  async function handleArchive(e: MouseEvent) {
    e.stopPropagation();
    await dataManager.archiveHabit(localHabit.id);
    dispatch("archive", { id: localHabit.id });
  }

  function requestDelete(e: MouseEvent) { e.stopPropagation(); showDeleteConfirm = true; }

  async function confirmDelete() {
    showDeleteConfirm = false;
    await dataManager.deleteHabit(localHabit.id);
    dispatch("delete", { id: localHabit.id });
  }

  // ── Segmented ring SVG ────────────────────────────────────────────────────

  function segPath(i: number, total: number): string {
    const gap   = total > 1 ? 0.08 : 0;
    const slice = (2 * Math.PI) / total;
    const s     = -Math.PI/2 + i*slice + gap/2;
    const en    = -Math.PI/2 + (i+1)*slice - gap/2;
    const r1=14, r2=9, cx=16, cy=16;
    const large = slice - gap > Math.PI ? 1 : 0;
    const p = (r:number, a:number) => [cx+r*Math.cos(a), cy+r*Math.sin(a)];
    const [x1,y1]=p(r1,s), [x2,y2]=p(r1,en), [x3,y3]=p(r2,en), [x4,y4]=p(r2,s);
    return `M${x1} ${y1} A${r1} ${r1} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r2} ${r2} 0 ${large} 0 ${x4} ${y4}Z`;
  }
</script>

<div
  class="card"
  class:is-open={isOpen}
  class:compact
  style="--hc:{localHabit.color};"
>

  {#if showDeleteConfirm}
    <div class="del-overlay" transition:fade={{ duration:140 }}>
      <div>
        <p class="del-msg">Delete <strong>{localHabit.name}</strong>?</p>
        <p class="del-sub">Removes all history permanently, archive if you want to use later.</p>
      </div>
      <div class="del-btns">
        <button class="del-btn del-cancel" on:click={() => (showDeleteConfirm=false)}>Cancel</button>
        <button class="del-btn del-confirm" on:click={confirmDelete}>Delete</button>
      </div>
    </div>

  {:else}

    <!-- Header -->
    <div
      class="header"
      role="button"
      tabindex="0"
      aria-expanded={isOpen}
      on:click={toggleOpen}
      on:keydown={(e)=>(e.key==="Enter"||e.key===" ")&&toggleOpen()}
    >

      {#if !compact}
        <div class="grip" aria-hidden="true" role="button"
          on:mousedown|stopPropagation={()=>dispatch("handleMousedown")}
          on:mouseup|stopPropagation={()=>dispatch("handleMouseup")}
          on:click|stopPropagation>
          <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
            <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
            <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
            <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
          </svg>
        </div>
      {/if}

      <!-- Icon badge -->
      <div class="icon-badge" bind:this={iconEl}
        style="background:{rgba(localHabit.color,.2)};color:{localHabit.color};"></div>

      <!-- Name + quote -->
      <div class="identity">
        <span class="name-text">{localHabit.name}</span>
        {#if localHabit.quote && !compact}
          <span class="quote-text">{localHabit.quote}</span>
        {/if}
      </div>

      <!-- Right controls -->
      <div class="hright" on:click|stopPropagation>

        <!-- Streak pill -->
        {#if stats.currentStreak > 0 && !compact}
          <div class="streak-pill">
            <span>🔥</span>
            <span class="streak-num">{stats.currentStreak}</span>
            <span class="streak-lbl">day streak</span>
          </div>
        {/if}

        <!-- Counter ring OR boolean checkbox -->
        {#if isCounter}
          <button
            class="counter-btn"
            class:counter-done={counterDone}
            class:counter-busy={counterBusy}
            on:click={tapCounter}
            title="{counterDone ? 'Done! Tap to reset' : 'Tap to log · '+todayCount+'/'+target+(localHabit.unit?' '+localHabit.unit:'')}"
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              {#if counterDone}
                <rect width="32" height="32" rx="8" fill="{localHabit.color}"/>
                <path d="M7 16L13 22L25 10" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              {:else}
                <rect width="32" height="32" rx="8" fill="{rgba(localHabit.color,.1)}"/>
                {#each Array(target) as _,i}
                  <path d={segPath(i,target)} fill="{i<todayCount ? localHabit.color : rgba(localHabit.color,.2)}"/>
                {/each}
              {/if}
            </svg>
          </button>
        {:else}
          <button
            class="chk-btn"
            class:chk-done={completedToday}
            class:chk-busy={togglingToday}
            on:click={toggleToday}
            title="{completedToday ? 'Done today — tap to unmark' : 'Mark done today'}"
          >
            {#if completedToday}
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="8" fill="{localHabit.color}"/>
                <path d="M7 16L13 22L25 10" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {:else}
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="1.2" y="1.2" width="29.6" height="29.6" rx="7"
                  fill="{localHabit.color}" fill-opacity="0.12"
                  stroke="{localHabit.color}" stroke-width="1.8"/>
              </svg>
            {/if}
          </button>
        {/if}

        <!-- Chevron -->
        <button class="chevron-btn" on:click={toggleOpen}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            style="transition:transform 200ms ease;transform:rotate({isOpen?180:0}deg);">
            <polyline points="2.5 4.5 6.5 8.5 10.5 4.5"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Body -->
    {#if isOpen}
      <div class="body" transition:slide={{ duration:200, easing:quintOut }}>
        <div class="heatmap-row">
          <div class="heatmap-wrap">
            <HeatmapGrid
              habit={localHabit}
              year={selectedYear}
              {dataManager} {weekStartsOn} {compact}
              on:toggle={handleGridToggle}
            />
          </div>

          {#if !compact}
            <div class="toolbar">
              <button class="tb-btn" class:tb-active={showStats}
                on:click|stopPropagation={()=>(showStats=!showStats)} title="Stats">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="8" stroke-width="3"/>
                  <line x1="12" y1="12" x2="12" y2="16"/>
                </svg>
              </button>
              <div class="tb-div"></div>
              <button class="tb-btn" on:click={openEditModal} title="Edit">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/>
                </svg>
              </button>
              <button class="tb-btn" on:click={handleArchive} title="Archive">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
                  <line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              </button>
              <button class="tb-btn tb-danger" on:click={requestDelete} title="Delete">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
            </div>
          {/if}
        </div>

        {#if !compact && showStats}
          <div transition:slide={{ duration:160, easing:cubicOut }}>
            <StatsFooter {stats} createdDate={localHabit.createdDate} habitColor={localHabit.color}/>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .card{position:relative;border-radius:10px;border:1px solid var(--background-modifier-border);background:var(--background-primary);overflow:hidden;transition:border-color 180ms,box-shadow 180ms;}
  .card:hover{border-color:color-mix(in srgb,var(--hc) 35%,var(--background-modifier-border));}
  .card.is-open{border-color:color-mix(in srgb,var(--hc) 50%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--hc) 10%,transparent);}

  .del-overlay{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;flex-wrap:wrap;background:rgba(229,62,62,.07);border-left:3px solid #e53e3e;}
  .del-msg{margin:0;font-size:.83rem;color:var(--text-normal);}.del-msg strong{color:#e53e3e;}
  .del-sub{margin:2px 0 0;font-size:.74rem;color:var(--text-muted);}
  .del-btns{display:flex;gap:6px;}
  .del-btn{border:none;border-radius:6px;padding:5px 14px;font-size:.78rem;font-weight:500;cursor:pointer;transition:opacity 120ms;}
  .del-cancel{background:var(--background-modifier-border);color:var(--text-normal);}
  .del-confirm{background:#e53e3e;color:#fff;}
  .del-btn:hover{opacity:.85;}

  .header{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 8px;cursor:pointer;user-select:none;border-left:3px solid transparent;transition:border-color 200ms,background 120ms;}
  .card.is-open .header{border-left-color:var(--hc);padding-left:5px;}
  .header:hover{background:color-mix(in srgb,var(--hc) 6%,transparent);}
  .card.is-open .header:hover{background:color-mix(in srgb,var(--hc) 9%,transparent);}
  .header:focus-visible{outline:2px solid var(--interactive-accent);outline-offset:-2px;}

  .grip{cursor:grab;color:var(--text-faint);padding:2px;border-radius:3px;flex-shrink:0;display:flex;align-items:center;opacity:0;transition:opacity 150ms;}
  .header:hover .grip{opacity:1;}
  .grip:active{cursor:grabbing;}

  .icon-badge{flex-shrink:0;width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;overflow:hidden;}
  .icon-badge :global(svg){width:20px;height:20px;stroke:currentColor;fill:none;}

  .identity{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;}
  .name-text{font-size:.88rem;font-weight:600;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3;}
  .quote-text{font-size:.72rem;color:var(--text-muted);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;}

  .hright{display:flex;align-items:center;gap:6px;flex-shrink:0;}

  .streak-pill{display:flex;align-items:center;gap:4px;padding:5px 9px;border-radius:8px;background:color-mix(in srgb,var(--hc) 12%,var(--background-secondary));border:1px solid color-mix(in srgb,var(--hc) 25%,transparent);white-space:nowrap;font-size:12px;}
  .streak-num{font-size:.78rem;font-weight:700;color:var(--hc);}
  .streak-lbl{font-size:.72rem;color:var(--text-muted);}

  .chk-btn{all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:6px;flex-shrink:0;transition:transform 130ms,opacity 120ms;}
  .chk-btn:hover:not(.chk-busy){transform:scale(1.08);}
  .chk-btn:active{transform:scale(.9);}
  .chk-btn.chk-busy{opacity:.5;pointer-events:none;}
  .chk-btn.chk-done svg{animation:chk-spring 280ms cubic-bezier(.34,1.56,.64,1);}
  @keyframes chk-spring{0%{transform:scale(.55) rotate(-8deg);opacity:.6}60%{transform:scale(1.12) rotate(2deg)}100%{transform:scale(1) rotate(0);opacity:1}}

  .counter-btn{all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;flex-shrink:0;transition:transform 130ms,opacity 120ms;}
  .counter-btn:hover:not(.counter-busy){transform:scale(1.08);}
  .counter-btn:active{transform:scale(.9);}
  .counter-btn.counter-busy{opacity:.5;pointer-events:none;}
  .counter-btn.counter-done svg{animation:chk-spring 280ms cubic-bezier(.34,1.56,.64,1);}

  .chevron-btn{all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;color:var(--text-muted);transition:background 120ms,color 120ms;}
  .chevron-btn:hover{background:var(--background-modifier-hover);color:var(--text-normal);}

  .body{padding:0 0 8px;border-top:1px solid var(--background-modifier-border);}
  .heatmap-row{display:flex;align-items:flex-start;gap:4px;padding:6px 6px 0;}
  .heatmap-wrap{flex:1;min-width:0;}

  .toolbar{display:flex;flex-direction:column;align-items:center;gap:1px;flex-shrink:0;padding-top:2px;}
  .tb-btn{all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:5px;color:var(--text-faint);transition:color 120ms,background 120ms;}
  .tb-btn:hover{color:var(--text-normal);background:var(--background-modifier-hover);}
  .tb-active{color:var(--interactive-accent)!important;background:color-mix(in srgb,var(--interactive-accent) 12%,transparent)!important;}
  .tb-danger:hover{color:#e53e3e;background:rgba(229,62,62,.1);}
  .tb-div{width:16px;height:1px;background:var(--background-modifier-border);margin:2px 0;}

  .compact .header{padding:6px 8px;}
  .compact .icon-badge{width:28px;height:28px;border-radius:8px;font-size:13px;}
  .compact .grip{display:none;}
</style>
