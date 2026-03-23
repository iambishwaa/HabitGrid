<!-- HeatmapGrid.svelte — pure reactive renderer -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Habit } from "../types";
  import type { DataManager } from "../DataManager";

  export let habit: Habit;        // localHabit passed from card — card owns this
  export let year: number;
  export let dataManager: DataManager;
  export let weekStartsOn: 0 | 1 = 1;
  export let compact: boolean = false;

  const dispatch = createEventDispatcher<{ toggle: { dateISO: string; completed: boolean; newHabit: Habit } }>();

  $: isCounter = habit.kind === "counter";
  $: target    = habit.target ?? 1;

  // doneSet and countMap derive DIRECTLY from habit prop.
  // When card updates its localHabit reference, these re-derive instantly.
  $: doneSet  = new Set<string>(habit.completions.filter(d => d.startsWith(`${year}-`)));
  $: countMap = habit.counts ?? {} as Record<string, number>;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function rgba(hex: string, a: number): string {
    const c = hex.replace("#","");
    const f = c.length===3 ? c.split("").map(x=>x+x).join("") : c;
    const r=parseInt(f.slice(0,2),16), g=parseInt(f.slice(2,4),16), b=parseInt(f.slice(4,6),16);
    if(isNaN(r)||isNaN(g)||isNaN(b)) return `rgba(99,99,99,${a})`;
    return `rgba(${r},${g},${b},${a})`;
  }

  const today = new Date().toISOString().slice(0,10);
  function isFuture(d: string)   { return d > today; }
  function isToday(d: string)    { return d === today; }
  function isCreation(d: string) { return habit.createdDate === d; }

  // ── Grid ────────────────────────────────────────────────────────────────

  $: grid           = buildGrid(year, weekStartsOn);
  $: monthPositions = buildMonthPositions(grid);
  const CELL=16, GAP=3;
  const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function buildGrid(yr:number, dow:0|1) {
    const weeks:Array<Array<{dateISO:string}|null>>=[];
    const j1=new Date(yr,0,1), d0=j1.getDay();
    const back=dow===1?(d0===0?6:d0-1):d0;
    const start=new Date(j1); start.setDate(j1.getDate()-back);
    const d31=new Date(yr,11,31), de=d31.getDay();
    const fwd=dow===1?(de===0?0:7-de):6-de;
    const end=new Date(d31); end.setDate(d31.getDate()+fwd);
    let cur=new Date(start), week:Array<{dateISO:string}|null>=[];
    while(cur<=end){
      week.push(cur.getFullYear()===yr?{dateISO:toISO(cur)}:null);
      cur.setDate(cur.getDate()+1);
      if(week.length===7){weeks.push(week);week=[];}
    }
    if(week.length) weeks.push(week);
    return weeks;
  }

  function toISO(d:Date){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

  function buildMonthPositions(g:typeof grid){
    let last=-1; const result:Array<{label:string;weekIndex:number}>=[];
    g.forEach((week,wi)=>{ const f=week.find(c=>c!==null); if(!f) return;
      const m=parseInt(f.dateISO.slice(5,7))-1;
      if(m!==last){last=m;result.push({label:MONTHS[m],weekIndex:wi});}
    }); return result;
  }

  // ── Click ────────────────────────────────────────────────────────────────

  let pending = new Set<string>();

  async function click(dateISO: string) {
    if (isFuture(dateISO) || pending.has(dateISO)) return;
    pending.add(dateISO); pending = new Set(pending);

    // Build the new habit state synchronously
    let newHabit: Habit;

    if (isCounter) {
      const current  = countMap[dateISO] ?? 0;
      // At target: next tap resets. Otherwise increment.
      const newCount = current >= target ? 0 : current + 1;
      const newCounts = { ...(habit.counts ?? {}) };
      if (newCount <= 0) delete newCounts[dateISO];
      else               newCounts[dateISO] = newCount;
      const newCompletions = newCount >= target
        ? [...new Set([...habit.completions, dateISO])].sort()
        : habit.completions.filter(d => d !== dateISO);
      newHabit = { ...habit, counts: newCounts, completions: newCompletions };
    } else {
      const wasDone = doneSet.has(dateISO);
      const newCompletions = wasDone
        ? habit.completions.filter(d => d !== dateISO)
        : [...habit.completions, dateISO].sort();
      newHabit = { ...habit, completions: newCompletions };
    }

    // Dispatch up to card IMMEDIATELY — card updates localHabit → re-render
    dispatch("toggle", { dateISO, completed: newHabit.completions.includes(dateISO), newHabit });

    // Write to disk in background
    try {
      if (isCounter) {
        const newCount = (newHabit.counts ?? {})[dateISO] ?? 0;
        await dataManager.setCount(habit.id, dateISO, newCount);
      } else {
        await dataManager.toggleCompletion(habit.id, dateISO);
      }
    } catch (e) {
      // Roll back — dispatch the original habit
      dispatch("toggle", { dateISO, completed: habit.completions.includes(dateISO), newHabit: habit });
      console.error("[HeatmapGrid]", e);
    } finally {
      pending.delete(dateISO); pending = new Set(pending);
    }
  }

  function keydown(e: KeyboardEvent, d: string) {
    if (e.key==="Enter"||e.key===" ") { e.preventDefault(); click(d); }
  }
</script>

<div class="hm" class:compact>
  {#if !compact}
  <div class="month-row" aria-hidden="true">
    {#each monthPositions as mp}
      <span class="mlbl" style="left:{mp.weekIndex*(CELL+GAP)}px;">{mp.label}</span>
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
            {@const count  = isCounter ? (countMap[cell.dateISO]??0) : 0}
            {@const done   = isCounter ? count>=target : doneSet.has(cell.dateISO)}
            {@const ratio  = isCounter ? Math.min(1,count/target) : 0}
            {@const future = isFuture(cell.dateISO)}
            {@const bg = isCounter
              ? count===0 ? rgba(habit.color,future?0.04:0.10) : rgba(habit.color,0.15+ratio*0.85)
              : doneSet.has(cell.dateISO) ? habit.color : rgba(habit.color,future?0.04:0.10)}
            <!-- svelte-ignore a11y-interactive-supports-focus -->
            <div
              class="cell"
              class:done
              class:tod={isToday(cell.dateISO)}
              class:fut={future}
              class:pend={pending.has(cell.dateISO)}
              role="gridcell"
              tabindex={future?-1:0}
              title="{cell.dateISO}{isCounter&&count>0?' · '+count+'/'+target+(habit.unit?' '+habit.unit:''):doneSet.has(cell.dateISO)?' ✓':''}{isToday(cell.dateISO)?' · today':''}{isCreation(cell.dateISO)?' · habit started here':''}"
              aria-pressed={done}
              style="background-color:{bg};"
              on:click={()=>click(cell.dateISO)}
              on:keydown={(e)=>keydown(e,cell.dateISO)}
            >
              {#if isCreation(cell.dateISO)&&!done}
                <span class="dot" aria-hidden="true"></span>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/each}
  </div>

  {#if !compact}
  <div class="legend" aria-hidden="true">
    <span class="ll">Less</span>
    {#each [0.08,0.25,0.5,0.8,1] as a}
      <div class="lc" style="background:{rgba(habit.color,a)};"></div>
    {/each}
    <span class="ll">More</span>
  </div>
  {/if}
</div>

<style>
  .hm{display:flex;flex-direction:column;gap:3px;width:100%;overflow:hidden;}
  .month-row{position:relative;height:14px;flex-shrink:0;}
  .mlbl{position:absolute;top:0;font-size:10px;color:var(--text-muted);white-space:nowrap;line-height:14px;pointer-events:none;}
  .weeks{display:flex;gap:3px;flex-shrink:0;}
  .week{display:flex;flex-direction:column;gap:3px;}
  .cell{width:16px;height:16px;border-radius:3px;cursor:pointer;position:relative;outline:none;flex-shrink:0;transition:transform 80ms ease;}
  .cell.spacer{background:transparent!important;pointer-events:none;}
  .cell.fut{pointer-events:none;cursor:default;}
  .cell.pend{opacity:0.5;cursor:wait;}
  .cell:not(.spacer):not(.fut):hover{transform:scale(1.4);z-index:2;}
  .cell:not(.spacer):not(.fut):focus-visible{box-shadow:0 0 0 2px var(--interactive-accent);z-index:2;}
  .cell.tod{box-shadow:0 0 0 1.5px var(--text-normal);}
  .cell.done.tod{box-shadow:0 0 0 1.5px var(--text-normal);}
  .dot{position:absolute;bottom:2px;right:2px;width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.5;pointer-events:none;}
  .compact .cell{width:9px;height:9px;border-radius:2px;}
  .compact .weeks{gap:2px;}
  .compact .week{gap:2px;}
  .legend{display:flex;align-items:center;gap:3px;justify-content:flex-end;padding-top:3px;}
  .ll{font-size:9px;color:var(--text-muted);}
  .lc{width:10px;height:10px;border-radius:2px;}
</style>
