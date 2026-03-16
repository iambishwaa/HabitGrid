<!-- HeatmapGrid.svelte -->

<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Habit } from "../types";
  import type { DataManager } from "../DataManager";

  export let habit: Habit;
  export let year: number;
  export let dataManager: DataManager;
  export let weekStartsOn: 0 | 1 = 1;
  export let compact: boolean = false;

  const dispatch = createEventDispatcher<{ toggle: { dateISO: string; completed: boolean } }>();

  // ── Local completions ─────────────────────────────────────────────────────

  let localCompletions: string[] = [...habit.completions];
  let trackedId = habit.id;
  let trackedYear = year;
  let trackedLen = habit.completions.length;

  $: {
    const idChanged  = habit.id !== trackedId;
    const yrChanged  = year !== trackedYear;
    // Resync when parent passes a new completions array (external update)
    const lenChanged = habit.completions.length !== trackedLen;

    if (idChanged || yrChanged || lenChanged) {
      localCompletions = [...habit.completions];
      trackedId  = habit.id;
      trackedYear = year;
      trackedLen = habit.completions.length;
    }
  }

  $: completionSet = new Set<string>(
    localCompletions.filter(d => d.startsWith(`${year}-`))
  );

  // ── Helpers ───────────────────────────────────────────────────────────────

  function rgba(hex: string, a: number): string {
    const c = hex.replace("#", "");
    const f = c.length === 3 ? c.split("").map(x => x+x).join("") : c;
    const r = parseInt(f.slice(0,2),16), g = parseInt(f.slice(2,4),16), b = parseInt(f.slice(4,6),16);
    if (isNaN(r)||isNaN(g)||isNaN(b)) return `rgba(99,99,99,${a})`;
    return `rgba(${r},${g},${b},${a})`;
  }

  const today = new Date().toISOString().slice(0, 10);

  function isFuture(d: string) { return d > today; }
  function isToday(d: string)  { return d === today; }
  function isCreation(d: string) { return habit.createdDate === d; }

  // ── Grid — always full year ────────────────────────────────────────────────

  $: grid = buildGrid(year, weekStartsOn);

  // Month label positions: array of { label, weekIndex } so labels sit
  // exactly above the first week-column that belongs to each month.
  $: monthPositions = buildMonthPositions(grid);

  function buildGrid(yr: number, dow: 0|1) {
    const weeks: Array<Array<{dateISO:string}|null>> = [];
    const j1 = new Date(yr, 0, 1);
    const d0 = j1.getDay();
    const back = dow===1 ? (d0===0?6:d0-1) : d0;
    const start = new Date(j1); start.setDate(j1.getDate()-back);

    // Always go to Dec 31 + fill to end of that week
    const d31 = new Date(yr, 11, 31);
    const de = d31.getDay();
    const fwd = dow===1 ? (de===0?0:7-de) : 6-de;
    const end = new Date(d31); end.setDate(d31.getDate()+fwd);

    let cur = new Date(start), week: Array<{dateISO:string}|null> = [];
    while (cur <= end) {
      week.push(cur.getFullYear()===yr ? {dateISO:toISO(cur)} : null);
      cur.setDate(cur.getDate()+1);
      if (week.length===7) { weeks.push(week); week=[]; }
    }
    if (week.length) weeks.push(week);
    return weeks;
  }

  function toISO(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  /**
   * For each week-column index, check if the first real cell in that column
   * starts a new month. If so, record the label and the week index.
   * This ensures month labels are placed exactly above the right column.
   */
  function buildMonthPositions(g: typeof grid): Array<{label: string; weekIndex: number}> {
    const result: Array<{label: string; weekIndex: number}> = [];
    let lastMonth = -1;
    g.forEach((week, wi) => {
      const first = week.find(c => c !== null);
      if (!first) return;
      const m = parseInt(first.dateISO.slice(5,7)) - 1;
      if (m !== lastMonth) {
        lastMonth = m;
        result.push({ label: MONTHS[m], weekIndex: wi });
      }
    });
    return result;
  }

  // ── Click handler ─────────────────────────────────────────────────────────

  let pending = new Set<string>();

  async function click(dateISO: string) {
    if (isFuture(dateISO) || pending.has(dateISO)) return;
    pending.add(dateISO);
    pending = new Set(pending);
    const wasDone = localCompletions.includes(dateISO);
    if (wasDone) {
      localCompletions = localCompletions.filter(d => d !== dateISO);
    } else {
      localCompletions = [...localCompletions, dateISO];
    }
    // Keep trackedLen in sync so the $: block doesn't fight our local update
    trackedLen = localCompletions.length;
    try {
      const nowDone = await dataManager.toggleCompletion(habit.id, dateISO);
      dispatch("toggle", { dateISO, completed: nowDone });
    } catch (e) {
      localCompletions = wasDone
        ? [...localCompletions, dateISO]
        : localCompletions.filter(d => d !== dateISO);
      trackedLen = localCompletions.length;
      console.error("[HeatmapGrid]", e);
    } finally {
      pending.delete(dateISO);
      pending = new Set(pending);
    }
  }

  function keydown(e: KeyboardEvent, d: string) {
    if (e.key==="Enter"||e.key===" ") { e.preventDefault(); click(d); }
  }

  // Cell size + gap — must match CSS exactly so month label offsets are correct
  const CELL = 16;  // px
  const GAP  = 3;   // px — gap between week columns
</script>

<!-- ── Markup ─────────────────────────────────────────────────────────────── -->

<div class="hm" class:compact>

  <!-- Month labels: absolutely positioned above each month's first column -->
  {#if !compact}
  <div class="month-row" aria-hidden="true">
    {#each monthPositions as mp}
      <span
        class="mlbl"
        style="left:{mp.weekIndex * (CELL + GAP)}px;"
      >{mp.label}</span>
    {/each}
  </div>
  {/if}

  <!-- Week columns -->
  <div class="weeks">
    {#each grid as week}
      <div class="week">
        {#each week as cell}
          {#if cell === null}
            <div class="cell spacer"></div>
          {:else}
            <!-- svelte-ignore a11y-interactive-supports-focus -->
            <div
              class="cell"
              class:done={completionSet.has(cell.dateISO)}
              class:tod={isToday(cell.dateISO)}
              class:fut={isFuture(cell.dateISO)}
              class:pend={pending.has(cell.dateISO)}
              role="gridcell"
              tabindex={isFuture(cell.dateISO) ? -1 : 0}
              title="{cell.dateISO}{completionSet.has(cell.dateISO) ? ' ✓' : ''}{isToday(cell.dateISO) ? ' · today' : ''}{isCreation(cell.dateISO) ? ' · habit started here' : ''}"
              aria-pressed={completionSet.has(cell.dateISO)}
              style="background-color:{
                completionSet.has(cell.dateISO)
                  ? habit.color
                  : rgba(habit.color, isFuture(cell.dateISO) ? 0.04 : 0.12)
              };"
              on:click={() => click(cell.dateISO)}
              on:keydown={(e) => keydown(e, cell.dateISO)}
            >
              {#if isCreation(cell.dateISO) && !completionSet.has(cell.dateISO)}
                <span class="dot" aria-hidden="true"></span>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/each}
  </div>

  <!-- Legend -->
  {#if !compact}
  <div class="legend" aria-hidden="true">
    <span class="ll">Less</span>
    {#each [0.08, 0.25, 0.5, 0.8, 1] as a}
      <div class="lc" style="background:{rgba(habit.color, a)};"></div>
    {/each}
    <span class="ll">More</span>
  </div>
  {/if}

</div>

<!-- ── Styles ──────────────────────────────────────────────────────────────── -->

<style>
  .hm {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    /* Clip silently — no scrollbar ever shown */
    overflow: hidden;
  }

  /* Month label row — fixed height, relative so labels can use left: */
  .month-row {
    position: relative;
    height: 14px;
    flex-shrink: 0;
  }

  .mlbl {
    position: absolute;
    top: 0;
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
    line-height: 14px;
    pointer-events: none;
  }

  /* Week columns */
  .weeks { display: flex; gap: 3px; flex-shrink: 0; }
  .week  { display: flex; flex-direction: column; gap: 3px; }

  /* Cells — size must match CELL/GAP constants in script */
  .cell {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    cursor: pointer;
    position: relative;
    outline: none;
    flex-shrink: 0;
    transition: transform 80ms ease;
  }

  .cell.spacer { background: transparent !important; pointer-events: none; }
  .cell.fut    { pointer-events: none; cursor: default; }
  .cell.pend   { opacity: 0.5; cursor: wait; }

  .cell:not(.spacer):not(.fut):hover        { transform: scale(1.4); z-index: 2; }
  .cell:not(.spacer):not(.fut):focus-visible { box-shadow: 0 0 0 2px var(--interactive-accent); z-index: 2; }

  .cell.tod      { box-shadow: 0 0 0 1.5px var(--text-normal); }
  .cell.done.tod { box-shadow: 0 0 0 1.5px var(--text-normal); }

  .dot {
    position: absolute;
    bottom: 2px; right: 2px;
    width: 3px; height: 3px;
    border-radius: 50%;
    background: currentColor;
    opacity: .5;
    pointer-events: none;
  }

  /* Compact */
  .compact .cell  { width: 9px; height: 9px; border-radius: 2px; }
  .compact .weeks { gap: 2px; }
  .compact .week  { gap: 2px; }

  /* Legend */
  .legend {
    display: flex;
    align-items: center;
    gap: 3px;
    justify-content: flex-end;
    padding-top: 3px;
  }
  .ll { font-size: 9px; color: var(--text-muted); }
  .lc { width: 10px; height: 10px; border-radius: 2px; }
</style>
