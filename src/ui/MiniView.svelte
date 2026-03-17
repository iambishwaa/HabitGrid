<!-- MiniView.svelte — compact 7-day view for screens < 450px -->

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


  // ── Last 7 days ────────────────────────────────────────────────────────

  const DAY_SHORT = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function getLast7(): { dateISO: string; dayLabel: string; dateNum: number; isToday: boolean }[] {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = toISO(d);
      result.push({
        dateISO: iso,
        dayLabel: DAY_SHORT[d.getDay()],
        dateNum: d.getDate(),
        isToday: i === 0,
      });
    }
    return result;
  }

  function toISO(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  $: days = getLast7();

  // ── Per-habit local completions ────────────────────────────────────────
  // Local state — not reactive to habit prop changes mid-toggle.
  // Resyncs when habits array length changes (new habit added/removed)
  // or when a specific habit's completion count changes (external update).

  let localMaps: Record<string, Set<string>> = buildMaps(habits);
  let trackedSig = buildSig(habits);

  function buildMaps(hs: Habit[]): Record<string, Set<string>> {
    return Object.fromEntries(hs.map(h => [h.id, new Set(h.completions)]));
  }

  // Signature: "id:len,id:len,..." — cheap way to detect external changes
  function buildSig(hs: Habit[]): string {
    return hs.map(h => `${h.id}:${h.completions.length}`).join(",");
  }

  $: {
    const sig = buildSig(habits);
    if (sig !== trackedSig) {
      localMaps = buildMaps(habits);
      trackedSig = sig;
    }
  }

  // Alias for template
  $: completionMaps = localMaps;

  // ── Toggle ─────────────────────────────────────────────────────────────

  let pending = new Set<string>(); // "habitId:dateISO"

  async function toggle(habit: Habit, dateISO: string) {
    const key = `${habit.id}:${dateISO}`;
    if (pending.has(key)) return;
    pending.add(key);
    pending = new Set(pending);

    const oldSet = localMaps[habit.id] ?? new Set<string>();
    const wasDone = oldSet.has(dateISO);

    // Create a NEW Set so Svelte detects the reference change
    const newSet = new Set(oldSet);
    if (wasDone) newSet.delete(dateISO);
    else         newSet.add(dateISO);

    // Assign new Set AND new outer object — both references change
    localMaps = { ...localMaps, [habit.id]: newSet };
    trackedSig = buildSig(habits.map(h =>
      h.id === habit.id ? { ...h, completions: [...newSet] } : h
    ));

    try {
      await dataManager.toggleCompletion(habit.id, dateISO);
      dispatch("habitUpdated", { ...habit,
        completions: wasDone
          ? habit.completions.filter(d => d !== dateISO)
          : [...habit.completions, dateISO]
      });
      plugin.onDataChanged(instanceId);
    } catch (_e) {
      // Roll back — restore old set
      localMaps = { ...localMaps, [habit.id]: oldSet };
    } finally {
      pending.delete(key);
      pending = new Set(pending);
    }
  }

  function openCreateModal() {
    new HabitCreateModal(plugin.app, plugin, (newHabit) => {
      habits = [...habits, newHabit];
      completionMaps[newHabit.id] = new Set(newHabit.completions);
      plugin.onDataChanged(instanceId);
    }).open();
  }

  // ── Icon rendering ─────────────────────────────────────────────────────

  function renderIcon(el: HTMLElement, icon: string | undefined, name: string) {
    if (!el) return;
    el.empty();
    if (icon) {
      const isEmoji = /\p{Emoji}/u.test(icon);
      if (isEmoji) {
        el.textContent = icon;
      } else {
        try { setIcon(el, icon); }
        catch (_e) { el.textContent = name.slice(0,1).toUpperCase(); }
      }
    } else {
      el.textContent = name.slice(0,1).toUpperCase();
    }
  }

  // ── Hex → rgba ─────────────────────────────────────────────────────────

  function rgba(hex: string, a: number): string {
    const c = hex.replace("#","");
    const f = c.length===3 ? c.split("").map(x=>x+x).join("") : c;
    const r = parseInt(f.slice(0,2),16), g = parseInt(f.slice(2,4),16), b = parseInt(f.slice(4,6),16);
    if (isNaN(r)||isNaN(g)||isNaN(b)) return `rgba(99,99,99,${a})`;
    return `rgba(${r},${g},${b},${a})`;
  }
</script>

<!-- ── Markup ──────────────────────────────────────────────────────────────── -->

<div class="mini-view">

  <!-- Header: "Habits by HabitGrid" + add button on right -->
  <div class="mini-header">
    <div class="mini-titles">
      <span class="mini-title">Habits</span>
      <span class="mini-brand">by HabitGrid</span>
    </div>
    <button class="mini-add-btn" on:click={openCreateModal} title="Add new habit" aria-label="Add new habit">+</button>
  </div>

  <!-- Day header row — no add button here -->
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
    {@const set = completionMaps[habit.id]}
    <div class="habit-row" style="--hc:{habit.color};">

      <!-- Name + icon -->
      <div class="habit-name-col">
        <div
          class="mini-icon"
          style="background:{rgba(habit.color, 0.2)}; color:{habit.color};"
          use:renderIconAction={{ icon: habit.icon, name: habit.name }}
        ></div>
        <span class="habit-label">{habit.name}</span>
      </div>

      <!-- 7 day cells -->
      {#each days as day}
        {@const isCounter = habit.kind === "counter"}
        {@const count = isCounter ? (localMaps[habit.id]?.size ? (habit.counts?.[day.dateISO] ?? 0) : 0) : 0}
        {@const habitTarget = habit.target ?? 1}
        {@const done = set ? set.has(day.dateISO) : false}
        {@const ratio = isCounter ? Math.min(1, count / habitTarget) : (done ? 1 : 0)}
        {@const key = `${habit.id}:${day.dateISO}`}
        <div class="cell-col">
          {#if isCounter}
            <!-- Counter: shows progress as opacity + count number -->
            <button
              class="mini-cell mini-cell-counter"
              class:mini-cell-done={ratio >= 1}
              class:mini-cell-today={day.isToday}
              class:mini-cell-pending={pending.has(key)}
              style="background:{ratio > 0 ? rgba(habit.color, 0.15 + ratio * 0.85) : rgba(habit.color, 0.10)}; border-color:{rgba(habit.color, 0.3)};"
              on:click={() => toggle(habit, day.dateISO)}
              title="{day.dateISO} · {count}/{habitTarget}{habit.unit ? ' '+habit.unit : ''}"
              aria-label="{habit.name} {day.dateISO}"
            >
              {#if count > 0}
                <span class="mini-count" style="color:{ratio >= 1 ? 'white' : habit.color};">{count}</span>
              {/if}
            </button>
          {:else}
            <!-- Boolean: simple checkbox -->
            <button
              class="mini-cell"
              class:mini-cell-done={done}
              class:mini-cell-today={day.isToday}
              class:mini-cell-pending={pending.has(key)}
              style="background:{done ? habit.color : rgba(habit.color, 0.12)};"
              on:click={() => toggle(habit, day.dateISO)}
              title="{day.dateISO}{done ? ' ✓' : ''}"
              aria-pressed={done}
              aria-label="{habit.name} {day.dateISO}"
            >
              {#if done}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round">
                  <polyline points="1.5 5 4 7.5 8.5 2.5"/>
                </svg>
              {/if}
            </button>
          {/if}
        </div>
      {/each}

    </div>
  {/each}

</div>

<!-- ── Svelte action for icon rendering ──────────────────────────────────── -->
<script context="module" lang="ts">
  export function renderIconAction(node: HTMLElement, params: { icon?: string; name: string }) {
    function render({ icon, name }: { icon?: string; name: string }) {
      node.textContent = "";
      if (icon) {
        const isEmoji = /\p{Emoji}/u.test(icon);
        if (isEmoji) {
          node.textContent = icon;
        } else {
          try {
            const { setIcon } = require("obsidian");
            setIcon(node, icon);
          } catch (_e) {
            node.textContent = name.slice(0,1).toUpperCase();
          }
        }
      } else {
        node.textContent = name.slice(0,1).toUpperCase();
      }
    }
    render(params);
    return {
      update(p: { icon?: string; name: string }) { render(p); },
    };
  }
</script>

<!-- ── Styles ──────────────────────────────────────────────────────────────── -->

<style>
  .mini-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 4px 0;
  }

  /* ── Mini header ── */
  .mini-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 6px 4px;
    border-bottom: 1px solid var(--background-modifier-border);
    margin-bottom: 2px;
  }

  .mini-titles {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }

  .mini-title {
    font-size: .78rem;
    font-weight: 600;
    color: var(--text-normal);
    letter-spacing: .03em;
  }

  .mini-brand {
    font-size: .68rem;
    color: var(--text-faint);
    font-style: italic;
  }

  .mini-add-btn {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 5px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 18px;
    font-weight: 300;
    line-height: 1;
    transition: opacity 120ms ease;
    padding: 0 0 1px 0;
  }

  .mini-add-btn:hover { opacity: .88; }

  /* ── Day header ── */
  .day-header {
    display: flex;
    align-items: flex-end;
    padding: 0 6px 6px;
    gap: 3px;
  }

  .name-col {
    flex: 1;
    min-width: 0;
  }

  .day-col {
    width: 30px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }

  .day-label {
    font-size: 10px;
    color: var(--text-muted);
    font-weight: 400;
    line-height: 1;
  }

  .day-num {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 400;
    line-height: 1;
  }

  .day-today .day-label,
  .day-today .day-num {
    color: var(--text-normal);
    font-weight: 600;
  }

  /* ── Habit rows ── */
  .habit-row {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    border-radius: 8px;
    transition: background 120ms ease;
  }

  .habit-row:hover {
    background: color-mix(in srgb, var(--hc) 5%, transparent);
  }

  /* Separator line between rows */
  .habit-row + .habit-row {
    border-top: 1px solid var(--background-modifier-border);
    border-radius: 0;
    padding-top: 4px;
  }

  .habit-row:last-child {
    border-radius: 0 0 8px 8px;
  }

  /* ── Name column ── */
  .habit-name-col {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    overflow: hidden;
  }

  .mini-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 600;
    overflow: hidden;
  }

  .mini-icon :global(svg) {
    width: 19px;
    height: 19px;
    stroke: currentColor;
    fill: none;
  }

  .habit-label {
    font-size: .84rem;
    font-weight: 500;
    color: var(--text-normal);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Day cells ── */
  .cell-col {
    width: 30px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mini-cell {
    all: unset;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    cursor: pointer;
    transition: transform 80ms ease, opacity 100ms ease;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mini-cell.mini-cell-counter {
    border: 1px solid;
  }

  .mini-count {
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .mini-cell:hover { transform: scale(1.1); }
  .mini-cell:active { transform: scale(.92); }
  .mini-cell.mini-cell-pending { opacity: .5; pointer-events: none; }

  .mini-cell.mini-cell-today {
    box-shadow: 0 0 0 2px var(--text-normal);
  }

  .mini-cell.mini-cell-done.mini-cell-today {
    box-shadow: 0 0 0 2px var(--text-normal);
  }
</style>
