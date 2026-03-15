<!-- ─────────────────────────────────────────────────────────────────────────
  StatsFooter.svelte — Lifetime stats bar rendered below the heatmap.

  Displays: Total Completions · Current Streak · Best Streak · Created Date
  Pure display — no side effects, no async. Parent passes computed stats down.
  ─────────────────────────────────────────────────────────────────────────── -->

<script lang="ts">
  import type { StreakStats } from "../types";

  export let stats: StreakStats;
  export let createdDate: string;
  export let habitColor: string;

  // ── Formatters ────────────────────────────────────────────────────────

  function formatDate(iso: string): string {
    try {
      return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  }

  function pluralDays(n: number): string {
    return `${n} day${n === 1 ? "" : "s"}`;
  }
</script>

<!-- ── Markup ──────────────────────────────────────────────────────────────── -->

<div class="stats-footer">

  <div class="stat-item">
    <span class="stat-value" style="color: {habitColor}">
      {stats.totalCompletions.toLocaleString()}
    </span>
    <span class="stat-label">Total</span>
  </div>

  <div class="stat-divider" aria-hidden="true"></div>

  <div class="stat-item">
    <span
      class="stat-value"
      class:streak-alive={stats.currentStreak > 0}
      style={stats.currentStreak > 0 ? `color: ${habitColor}` : ""}
    >
      {pluralDays(stats.currentStreak)}
    </span>
    <span class="stat-label">Current streak</span>
  </div>

  <div class="stat-divider" aria-hidden="true"></div>

  <div class="stat-item">
    <span class="stat-value" style="color: {habitColor}">
      {pluralDays(stats.bestStreak)}
    </span>
    <span class="stat-label">Best streak</span>
  </div>

  <div class="stat-divider" aria-hidden="true"></div>

  <div class="stat-item">
    <span class="stat-value stat-value--small">
      {formatDate(createdDate)}
    </span>
    <span class="stat-label">Started</span>
  </div>

</div>

<!-- ── Styles ──────────────────────────────────────────────────────────────── -->

<style>
  .stats-footer {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0;
    padding: 10px 2px 2px;
    border-top: 1px solid var(--background-modifier-border);
    margin-top: 10px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    gap: 2px;
    min-width: 0;
  }

  .stat-value {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-normal);
    white-space: nowrap;
    letter-spacing: -0.01em;
    transition: color 200ms ease;
  }

  .stat-value--small {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .stat-label {
    font-size: 0.65rem;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .streak-alive {
    animation: pulse-in 300ms ease;
  }

  .stat-divider {
    width: 1px;
    height: 28px;
    background: var(--background-modifier-border);
    flex-shrink: 0;
    margin: 0 4px;
  }

  @keyframes pulse-in {
    0%   { transform: scale(0.9); opacity: 0.5; }
    60%  { transform: scale(1.06); }
    100% { transform: scale(1); opacity: 1; }
  }
</style>
