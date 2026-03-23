# HabitGrid — Habit Tracker for Obsidian

> Track your daily habits with GitHub-style heatmaps, streak analytics, and a beautiful minimal UI — all inside Obsidian.

![HabitGrid Banner](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?style=flat&logo=obsidian&logoColor=white) ![Version](https://img.shields.io/badge/version-0.1.0-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## What is HabitGrid?

HabitGrid turns Obsidian into a full habit tracking system. Every habit you track gets a year-long heatmap grid — the darker the cell, the more consistent you've been. It's the same visual language as GitHub's contribution graph, but for your daily life.

Your data lives in your vault. No cloud, no subscription, no external service.

---

## Features

### 🟩 Heatmap Grid
- Full year heatmap for every habit, coloured by your chosen accent
- Cells fill darker as you complete — empty days show a soft tint so the grid always looks alive
- Hover any cell to see the exact date, completion status, and progress
- The creation day is marked with a small dot — your habit's birthday
- Today's cell has a ring around it so you always know where you are

### ✅ Two Habit Types

**Simple (Boolean)** — Done or not done. One tap marks the day complete.

**Counter** — For habits that need multiple completions per day. Set a daily target (e.g. 5 glasses of water) and a unit (L, pages, reps). The checkbox fills in segments as you log each one, and turns solid with a checkmark when you hit your target. Tap once more to reset.

### 📊 Streak Analytics
- Current streak, best streak, total completions, start date
- Stats are hidden by default and revealed with the ℹ️ button — visible when you need them, gone when you don't

### 🗂️ Two Views

**Full view** — Accordion cards with the year heatmap, streak stats, and all controls. Opens at full size, supports drag-to-reorder, and shows one habit at a time (configurable).

**Mini view** — Automatically activates when the panel width drops below 450px. Shows the last 7 days as checkboxes in a compact row layout — perfect for a sidebar panel you glance at daily.

### 🎨 Per-Habit Customisation
Each habit has:
- A name and optional motivational quote (shown as a subtitle)
- A colour — choose from 12 presets or open the system colour picker for any colour
- An icon — paste any emoji or type a Lucide icon name (e.g. `dumbbell`, `book-open`)

### 🔁 Live Sync Between Views
Open HabitGrid as both a full tab and a sidebar panel at the same time. Tick a habit in one — the other updates instantly. No refresh needed.

### 💾 Automatic Backup to Your Vault
Every habit toggle writes to a date file inside a `HabitGrid/` folder in your vault:

```
HabitGrid/
  2026-04-21.md
  2026-04-22.md
  ...
```

Each file has:
- YAML frontmatter with `tags: [habitgrid]` so you can find all files in graph view
- A `habit_name: true` or `habit_name: 3` key for each habit logged that day
- A warning callout so the file's purpose is clear

These files are your backup. If `data.json` is ever lost, you can rebuild everything from them.

### 🔧 Rebuild from Files
Settings → **Rebuild Habit Database** scans your `HabitGrid/` folder and reconstructs all completions and counter counts. A hidden `meta.json` file (inside the plugin folder, invisible in the vault) stores your habit colours, icons, quotes, and types — so a full rebuild restores your habits looking exactly as they were.

### 🗑️ Safe Delete
Deleting a habit adds it to a permanent tombstone list. Rebuild will never resurrect it from old files, even if that habit's key exists in hundreds of daily notes.

### 🔄 Full Reset
Settings → Danger Zone → type the confirmation phrase → **Delete everything**. Wipes all habits and history. A reset timestamp is stored in `data.json` so Rebuild ignores all files before the reset date — old data can never come back accidentally.

---

## Getting Started

### Install
1. Open Obsidian Settings → Community Plugins → Browse
2. Search for **HabitGrid**
3. Install and enable

Or manually: copy `main.js`, `manifest.json` into `.obsidian/plugins/habitgrid-by-bishwaa/` and enable in Community Plugins.

### Open HabitGrid
Use the command palette (`Cmd/Ctrl + P`) and search for:

| Command | What it does |
|---|---|
| `HabitGrid — Open (large view)` | Opens a full tab |
| `HabitGrid — Open in sidebar` | Opens in the right sidebar (mini view) |
| `HabitGrid — Open new instance` | Opens an additional independent instance |

### Create Your First Habit
Click **+ New habit** → fill in name, optional quote and icon, choose a colour → **Create habit**.

For a counter habit (e.g. drink 4L water daily), select **Counter** from the Habit type dropdown and set the target and unit.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| HabitGrid folder location | vault root | Parent folder for the `HabitGrid/` date files. Change to move all files. |
| Week starts on Monday | On | Toggle to start heatmap weeks on Sunday |
| Auto-collapse habits | On | Opening one habit closes the others. Turn off to keep multiple open. |

---

## Recovery Guide

If your `data.json` is lost or corrupted:

1. Open Obsidian Settings → HabitGrid
2. Click **Rebuild now**
3. HabitGrid scans your `HabitGrid/` folder files and restores:
   - ✅ All habit names, colours, icons, quotes, types
   - ✅ Boolean completions (every date you ticked)
   - ✅ Counter counts (exact numbers, not just completed days)
   - ✅ Correct sort order

---

## File Structure

```
Your Vault/
├── HabitGrid/
│   ├── 2026-04-21.md      ← one file per day you logged habits
│   ├── 2026-04-22.md
│   └── ...
└── .obsidian/
    └── plugins/
        └── habitgrid-by-bishwaa/
            ├── data.json  ← main database
            └── meta.json  ← appearance backup (auto-managed)
```

A sample date file looks like this:

```markdown
---
date: 2026-04-21
tags: [habitgrid]
habit_morning_reading: true
habit_water: 3
habit_exercise: true
---

> [!warning] Do not edit this file manually
> This file is managed by **HabitGrid**. Manual edits may be lost or cause data conflicts.
```

---

## Privacy

- All data is stored locally in your vault
- No internet connection required
- No analytics or telemetry
- No external servers

---

## Development

Built with TypeScript, Svelte 4, and esbuild.

```bash
git clone https://github.com/iambishwaa/habitgrid
cd habitgrid
npm install

# Create .env.local with your vault path
echo "VAULT_PATH=/path/to/your/vault" > .env.local

npm run dev   # watch mode — builds directly to your vault
npm run build # production build
```

---

_Track your habits, own your data — by bishwaa_

<div align="center">

**Built with ❤️ by Bishwaa Adhikarii, Nepal 🇳🇵**

_If this plugin made your daily life better, I'd love to hear from you._

|     |                                                                                      |
| :-: | :----------------------------------------------------------------------------------- |
| 🌐  | **Website** — [bishwaa.com.np](http://bishwaa.com.np/)                               |
| 💼  | **LinkedIn** — [linkedin.com/in/iambishwaa](https://www.linkedin.com/in/iambishwaa/) |
| 🐙  | **GitHub** — [github.com/iambishwaa](https://github.com/iambishwaa)                  |
| 📬  | **Say thanks** — [pi@bishwaa.com.np](mailto:pi@bishwaa.com.np)                       |
| ☕  | **Buy me a momo** — [buymemomo.com/iambishwaa](https://buymemomo.com/iambishwaa)     |

</div>
