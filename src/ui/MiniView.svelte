<!-- MiniView.svelte -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Habit } from "../types";
  import type { DataManager } from "../DataManager";
  import type HabitTrackerPlugin from "../main";
  import { setIcon } from "obsidian";
  import HabitCreateModal from "../HabitCreateModal";

  export let habits: Habit[];
  export let dataManager: DataManager;
  export let plugin: HabitTrackerPlugin;
  export let instanceId: string = "";

  const dispatch = createEventDispatcher<{ habitUpdated: Habit }>();

  // ── Last 7 days ───────────────────────────────────────────────────────────

  const DAY_SHORT = ["Su","Mo","Tu","We","Th","Fr","Sa"];

  $: days = getLast7();

  function getLast7() {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = toISO(d);
      result.push({ dateISO: iso, dayLabel: DAY_SHORT[d.getDay()], dateNum: d.getDate(), isToday: i === 0 });
    }
    return result;
  }

  function toISO(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  // ── Per-habit local state ─────────────────────────────────────────────────
  // localSets: habitId → Set<dateISO> of completions
  // localCounts: habitId → Record<dateISO, count>
  // Always replaced with new objects — never mutated in place.

  let localSets:   Record<string, Set<string>>            = buildSets(habits);
  let localCounts: Record<string, Record<string, number>> = buildCounts(habits);
  let syncSig = buildSig(habits);

  function buildSets(hs: Habit[]): Record<string, Set<string>> {
    return Object.fromEntries(hs.map(h => [h.id, new Set(h.completions)]));
  }

  function buildCounts(hs: Habit[]): Record<string, Record<string, number>> {
    return Object.fromEntries(hs.map(h => [h.id, h.counts ? { ...h.counts } : {}]));
  }

  function buildSig(hs: Habit[]): string {
    return hs.map(h => `${h.id}:${h.completions.join(",")}:${JSON.stringify(h.counts ?? {})}`).join("|");
  }

  // Resync when habits array changes externally (main view, other window)
  $: {
    const incoming = buildSig(habits);
    if (incoming !== syncSig) {
      localSets   = buildSets(habits);
      localCounts = buildCounts(habits);
      syncSig     = incoming;
    }
  }

  // ── Toggle ────────────────────────────────────────────────────────────────

  let pending = new Set<string>();

  async function toggle(habit: Habit, dateISO: string) {
    const key = `${habit.id}:${dateISO}`;
    if (pending.has(key)) return;
    pending.add(key); pending = new Set(pending);

    const isCounter = habit.kind === "counter";
    const target    = habit.target ?? 1;

    let newHabit: Habit;

    if (isCounter) {
      const oldCounts = localCounts[habit.id] ?? {};
      const current   = oldCounts[dateISO] ?? 0;
      const newCount  = current >= target ? 0 : current + 1;
      const newCountsForHabit = { ...oldCounts };
      if (newCount <= 0) delete newCountsForHabit[dateISO];
      else newCountsForHabit[dateISO] = newCount;

      // New Set — never mutate
      const newSet = new Set(localSets[habit.id] ?? new Set<string>());
      if (newCount >= target) newSet.add(dateISO);
      else                    newSet.delete(dateISO);

      const newCompletions = newCount >= target
        ? [...new Set([...habit.completions, dateISO])].sort()
        : habit.completions.filter(d => d !== dateISO);

      localSets   = { ...localSets,   [habit.id]: newSet };
      localCounts = { ...localCounts, [habit.id]: newCountsForHabit };
      syncSig = buildSig(habits.map(h => h.id === habit.id ? { ...h, completions: newCompletions, counts: newCountsForHabit } : h));

      newHabit = { ...habit, completions: newCompletions, counts: newCountsForHabit };

      // Notify immediately — before disk write
      dispatch("habitUpdated", newHabit);
      plugin.onDataChanged(instanceId, newHabit);

      try {
        await dataManager.setCount(habit.id, dateISO, newCount);
      } catch (_e) {
        localSets   = { ...localSets,   [habit.id]: new Set(localSets[habit.id]) };
        localCounts = { ...localCounts, [habit.id]: { ...oldCounts } };
      }

    } else {
      const oldSet  = localSets[habit.id] ?? new Set<string>();
      const wasDone = oldSet.has(dateISO);

      const newSet = new Set(oldSet);
      if (wasDone) newSet.delete(dateISO);
      else         newSet.add(dateISO);

      const newCompletions = wasDone
        ? habit.completions.filter(d => d !== dateISO)
        : [...habit.completions, dateISO].sort();

      localSets = { ...localSets, [habit.id]: newSet };
      syncSig   = buildSig(habits.map(h => h.id === habit.id ? { ...h, completions: newCompletions } : h));

      newHabit = { ...habit, completions: newCompletions };

      // Notify immediately — before disk write
      dispatch("habitUpdated", newHabit);
      plugin.onDataChanged(instanceId, newHabit);

      try {
        await dataManager.toggleCompletion(habit.id, dateISO);
      } catch (_e) {
        localSets = { ...localSets, [habit.id]: new Set(oldSet) };
      }
    }

    pending.delete(key); pending = new Set(pending);
  }

  // ── Create modal ──────────────────────────────────────────────────────────

  function openCreateModal() {
    new HabitCreateModal(plugin.app, plugin, (newHabit) => {
      habits = [...habits, newHabit];
      localSets   = { ...localSets,   [newHabit.id]: new Set(newHabit.completions) };
      localCounts = { ...localCounts, [newHabit.id]: newHabit.counts ? { ...newHabit.counts } : {} };
      syncSig = buildSig(habits);
      plugin.onDataChanged(instanceId); // full reload — new habit not in other instance yet
    }).open();
  }

  // ── Icon rendering ────────────────────────────────────────────────────────

  function rgba(hex: string, a: number): string {
    const c=hex.replace("#",""); const f=c.length===3?c.split("").map(x=>x+x).join(""):c;
    const r=parseInt(f.slice(0,2),16),g=parseInt(f.slice(2,4),16),b=parseInt(f.slice(4,6),16);
    if(isNaN(r)||isNaN(g)||isNaN(b)) return `rgba(99,99,99,${a})`; return `rgba(${r},${g},${b},${a})`;
  }

  function renderIconAction(node: HTMLElement, params: { icon?: string; name: string }) {
    function render({ icon, name }: { icon?: string; name: string }) {
      node.textContent = "";
      if (icon) {
        const isEmoji = /\p{Emoji}/u.test(icon);
        if (isEmoji) { node.textContent = icon; }
        else { try { setIcon(node, icon); } catch { node.textContent = name.slice(0,1).toUpperCase(); } }
      } else { node.textContent = name.slice(0,1).toUpperCase(); }
    }
    render(params);
    return { update(p: { icon?: string; name: string }) { render(p); } };
  }
</script>

<div class="mini-view">

  <!-- Header -->
  <div class="mini-header">
    <div class="mini-titles">
      <span class="mini-title">Habits</span>
      <span class="mini-brand">by HabitGrid</span>
    </div>
    <button class="mini-add-btn" on:click={openCreateModal} title="Add new habit">+</button>
  </div>

  <!-- Day column headers -->
  <div class="day-header">
    <div class="name-col"></div>
    {#each days as day}
      <div class="day-col" class:day-today={day.isToday}>
        <span class="day-label">{day.dayLabel}</span>
        <span class="day-num">{day.dateNum}</span>
      </div>
    {/each}
  </div>

  <!-- Habit rows -->
  {#each habits as habit (habit.id)}
    {@const isCounter = habit.kind === "counter"}
    {@const target    = habit.target ?? 1}
    {@const habitSet  = localSets[habit.id]   ?? new Set()}
    {@const habitCnts = localCounts[habit.id] ?? {}}
    <div class="habit-row" style="--hc:{habit.color};">

      <div class="habit-name-col">
        <div class="mini-icon"
          style="background:{rgba(habit.color,.2)};color:{habit.color};"
          use:renderIconAction={{ icon: habit.icon, name: habit.name }}></div>
        <span class="habit-label">{habit.name}</span>
      </div>

      {#each days as day}
        {@const key    = `${habit.id}:${day.dateISO}`}
        {@const count  = isCounter ? (habitCnts[day.dateISO] ?? 0) : 0}
        {@const done   = isCounter ? count >= target : habitSet.has(day.dateISO)}
        {@const ratio  = isCounter ? Math.min(1, count/target) : (done ? 1 : 0)}
        <div class="cell-col">
          <button
            class="mini-cell"
            class:mini-cell-done={done}
            class:mini-cell-today={day.isToday}
            class:mini-cell-pending={pending.has(key)}
            style="background:{
              isCounter
                ? done ? habit.color : count === 0 ? rgba(habit.color,.10) : rgba(habit.color, 0.15+ratio*0.85)
                : done ? habit.color : rgba(habit.color,.12)
            }; {isCounter && !done ? 'border:1px solid '+rgba(habit.color,.3)+';' : ''}"
            on:click={() => toggle(habit, day.dateISO)}
            title="{day.dateISO}{isCounter&&count>0?' · '+count+'/'+target+(habit.unit?' '+habit.unit:''):done?' ✓':''}"
            aria-pressed={done}
          >
            {#if done}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" stroke-width="2" stroke-linecap="round">
                <polyline points="2 6 5 9 10 3"/>
              </svg>
            {:else if isCounter && count > 0}
              <span class="mini-count" style="color:{habit.color};">{count}</span>
            {/if}
          </button>
        </div>
      {/each}
    </div>
  {/each}

</div>

<script context="module" lang="ts">
  export { };
</script>

<style>
  .mini-view{display:flex;flex-direction:column;width:100%;padding:4px 0;}

  .mini-header{display:flex;align-items:center;justify-content:space-between;padding:6px 6px 4px;border-bottom:1px solid var(--background-modifier-border);margin-bottom:2px;}
  .mini-titles{display:flex;align-items:baseline;gap:5px;}
  .mini-title{font-size:.78rem;font-weight:600;color:var(--text-normal);letter-spacing:.03em;}
  .mini-brand{font-size:.68rem;color:var(--text-faint);font-style:italic;}
  .mini-add-btn{background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:5px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;font-weight:300;line-height:1;padding:0 0 1px;transition:opacity 120ms;}
  .mini-add-btn:hover{opacity:.88;}

  .day-header{display:flex;align-items:flex-end;padding:0 6px 4px;gap:0;}
  .name-col{flex:1;min-width:0;}
  .day-col{width:30px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1px;}
  .day-label{font-size:10px;color:var(--text-muted);font-weight:400;line-height:1;}
  .day-num{font-size:12px;color:var(--text-muted);font-weight:400;line-height:1;}
  .day-today .day-label,.day-today .day-num{color:var(--text-normal);font-weight:600;}

  .habit-row{display:flex;align-items:center;gap:0;padding:4px 6px;border-radius:6px;transition:background 120ms;}
  .habit-row:hover{background:color-mix(in srgb,var(--hc) 5%,transparent);}
  .habit-row+.habit-row{border-top:1px solid var(--background-modifier-border);}

  .habit-name-col{flex:1;min-width:0;display:flex;align-items:center;gap:7px;overflow:hidden;}
  .mini-icon{width:36px;height:36px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;overflow:hidden;}
  .mini-icon :global(svg){width:19px;height:19px;stroke:currentColor;fill:none;}
  .habit-label{font-size:.84rem;font-weight:500;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

  .cell-col{width:30px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
  .mini-cell{all:unset;width:24px;height:24px;border-radius:6px;cursor:pointer;transition:transform 80ms,opacity 100ms;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;}
  .mini-cell:hover{transform:scale(1.1);}
  .mini-cell:active{transform:scale(.92);}
  .mini-cell.mini-cell-pending{opacity:.5;pointer-events:none;}
  .mini-cell.mini-cell-today{box-shadow:0 0 0 2px var(--text-normal);}
  .mini-count{font-size:10px;font-weight:700;line-height:1;}
</style>
