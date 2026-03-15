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

  // ── LOCAL COMPLETIONS — this component owns its display state ────────────
  //
  // The parent NEVER needs to re-pass props for the grid to update.
  // We initialise from habit.completions once, and update locally on every
  // click. The $: block only re-syncs when the habit ID changes (switching
  // to a completely different habit).

  let localCompletions: string[] = [...habit.completions];
  let trackedId = habit.id;

  $: if (habit.id !== trackedId) {
    localCompletions = [...habit.completions];
    trackedId = habit.id;
  }

  // completionSet is derived from localCompletions — updates instantly on click
  $: completionSet = new Set(localCompletions.filter(d => d.startsWith(`${year}-`)));

  // ── Helpers ───────────────────────────────────────────────────────────────

  function hexToRgba(hex: string, alpha: number): string {
    const c = hex.replace("#", "");
    const f = c.length === 3 ? c.split("").map(x => x+x).join("") : c;
    const r = parseInt(f.slice(0,2),16), g = parseInt(f.slice(2,4),16), b = parseInt(f.slice(4,6),16);
    if (isNaN(r)||isNaN(g)||isNaN(b)) return `rgba(99,99,99,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  const today = new Date().toISOString().slice(0, 10);

  function isCompleted(d: string) { return completionSet.has(d); }
  function isToday(d: string)     { return d === today; }
  function isFuture(d: string)    { return d > today; }
  function isCreation(d: string)  { return habit.createdDate === d; }

  function cellBg(d: string): string {
    if (isCompleted(d)) return habit.color;
    return hexToRgba(habit.color, isFuture(d) ? 0.05 : 0.12);
  }

  // ── Grid builder ──────────────────────────────────────────────────────────

  $: grid = buildGrid(year, weekStartsOn);
  $: dayLabels = weekStartsOn === 1 ? ["M","T","W","T","F","S","S"] : ["S","M","T","W","T","F","S"];
  $: monthLabels = buildMonthLabels(grid);

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function buildGrid(yr: number, dow: 0|1) {
    const weeks: Array<Array<{dateISO:string}|null>> = [];
    const j1 = new Date(yr, 0, 1);
    const d0 = j1.getDay();
    const back = dow === 1 ? (d0===0?6:d0-1) : d0;
    const start = new Date(j1); start.setDate(j1.getDate() - back);
    const d31 = new Date(yr, 11, 31);
    const de = d31.getDay();
    const fwd = dow === 1 ? (de===0?0:7-de) : 6-de;
    const end = new Date(d31); end.setDate(d31.getDate() + fwd);
    let cur = new Date(start), week: Array<{dateISO:string}|null> = [];
    while (cur <= end) {
      week.push(cur.getFullYear()===yr ? {dateISO:iso(cur)} : null);
      cur.setDate(cur.getDate()+1);
      if (week.length===7) { weeks.push(week); week=[]; }
    }
    if (week.length) weeks.push(week);
    return weeks;
  }

  function iso(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function buildMonthLabels(g: typeof grid): Array<string|null> {
    let last = -1;
    return g.map(w => {
      const f = w.find(c=>c!==null);
      if (!f) return null;
      const m = parseInt(f.dateISO.slice(5,7))-1;
      if (m!==last){last=m;return MONTHS[m];}
      return null;
    });
  }

  // ── Toggle ────────────────────────────────────────────────────────────────

  let pending = new Set<string>();

  async function click(dateISO: string) {
    if (isFuture(dateISO) || pending.has(dateISO)) return;
    pending.add(dateISO);
    pending = pending; // svelte invalidation

    const wasDone = localCompletions.includes(dateISO);

    // Paint immediately — no async wait
    if (wasDone) {
      localCompletions = localCompletions.filter(d => d !== dateISO);
    } else {
      localCompletions = [...localCompletions, dateISO];
    }

    try {
      const nowDone = await dataManager.toggleCompletion(habit.id, dateISO);
      dispatch("toggle", { dateISO, completed: nowDone });
    } catch (e) {
      // roll back
      localCompletions = wasDone
        ? [...localCompletions, dateISO]
        : localCompletions.filter(d => d !== dateISO);
      console.error("[HeatmapGrid]", e);
    } finally {
      pending.delete(dateISO);
      pending = pending;
    }
  }

  function keydown(e: KeyboardEvent, d: string) {
    if (e.key==="Enter"||e.key===" ") { e.preventDefault(); click(d); }
  }
</script>

<!-- ── Markup ─────────────────────────────────────────────────────────────── -->

<div class="hm" class:compact role="grid" aria-label="Habit heatmap {year}">

  {#if !compact}
  <div class="months" aria-hidden="true">
    <div class="sp"></div>
    {#each monthLabels as lbl}
      <div class="mlbl">{lbl??""}</div>
    {/each}
  </div>
  {/if}

  <div class="body">
    {#if !compact}
    <div class="dows" aria-hidden="true">
      {#each dayLabels as lbl, i}
        <div class="dow" class:hide={i%2===0}>{lbl}</div>
      {/each}
    </div>
    {/if}

    <div class="weeks">
      {#each grid as week}
        <div class="week">
          {#each week as cell}
            {#if cell===null}
              <div class="cell spacer"></div>
            {:else}
              <!-- svelte-ignore a11y-interactive-supports-focus -->
              <div
                class="cell"
                class:done={isCompleted(cell.dateISO)}
                class:tod={isToday(cell.dateISO)}
                class:fut={isFuture(cell.dateISO)}
                class:pend={pending.has(cell.dateISO)}
                role="gridcell"
                tabindex={isFuture(cell.dateISO)?-1:0}
                title="{cell.dateISO}{isCompleted(cell.dateISO)?' ✓':''}{isToday(cell.dateISO)?' · today':''}"
                aria-pressed={isCompleted(cell.dateISO)}
                style="background:{cellBg(cell.dateISO)};"
                on:click={()=>click(cell.dateISO)}
                on:keydown={(e)=>keydown(e,cell.dateISO)}
              >
                {#if isCreation(cell.dateISO)&&!isCompleted(cell.dateISO)}
                  <span class="dot" aria-hidden="true"></span>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  </div>

  {#if !compact}
  <div class="legend" aria-hidden="true">
    <span class="ll">Less</span>
    {#each [0.08,0.25,0.5,0.75,1] as a}
      <div class="lc" style="background:{hexToRgba(habit.color,a)};"></div>
    {/each}
    <span class="ll">More</span>
  </div>
  {/if}

</div>

<!-- ── Styles ──────────────────────────────────────────────────────────────── -->

<style>
  .hm { display:flex; flex-direction:column; gap:3px; width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; }

  .months { display:flex; gap:3px; padding-left:22px; }
  .sp { width:22px; flex-shrink:0; }
  .mlbl { width:18px; font-size:10px; color:var(--text-muted); line-height:1; overflow:visible; white-space:nowrap; flex-shrink:0; }

  .body { display:flex; }
  .dows { display:flex; flex-direction:column; gap:3px; width:20px; flex-shrink:0; }
  .dow { height:14px; font-size:9px; color:var(--text-muted); line-height:14px; text-align:right; padding-right:3px; }
  .dow.hide { visibility:hidden; }

  .weeks { display:flex; gap:3px; }
  .week  { display:flex; flex-direction:column; gap:3px; }

  .cell {
    width:14px; height:14px; border-radius:3px;
    cursor:pointer; position:relative; outline:none; flex-shrink:0;
    transition: transform 80ms ease;
  }
  .cell.spacer { background:transparent!important; pointer-events:none; }
  .cell.fut    { pointer-events:none; cursor:default; }
  .cell.pend   { opacity:0.5; cursor:wait; }

  .cell:not(.spacer):not(.fut):hover { transform:scale(1.35); z-index:2; }
  .cell:not(.spacer):not(.fut):focus-visible { box-shadow:0 0 0 2px var(--interactive-accent); z-index:2; }

  .cell.tod        { box-shadow:0 0 0 1.5px var(--text-normal); }
  .cell.done.tod   { box-shadow:0 0 0 1.5px var(--text-normal); }

  .dot { position:absolute; bottom:2px; right:2px; width:3px; height:3px; border-radius:50%; background:currentColor; opacity:.5; pointer-events:none; }

  .compact .cell  { width:10px; height:10px; border-radius:2px; }
  .compact .weeks { gap:2px; }
  .compact .week  { gap:2px; }

  .legend { display:flex; align-items:center; gap:3px; justify-content:flex-end; padding-top:2px; }
  .ll { font-size:9px; color:var(--text-muted); }
  .lc { width:11px; height:11px; border-radius:2px; }
</style>
