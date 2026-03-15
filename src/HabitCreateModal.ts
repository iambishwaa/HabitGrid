// ─────────────────────────────────────────────────────────────────────────────
// HabitCreateModal.ts — Modal for creating a new habit.
//
// Fields:
//   • Name         (required, text input)
//   • Color        (hex swatch grid + manual hex input)
//   • Quote        (optional motivational sub-title)
//   • Icon         (optional Lucide icon name)
//
// On submit → calls DataManager.createHabit() → fires the onCreated callback
// so HabitTrackerApp can prepend the new card without a full re-load.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Modal, Notice, Setting } from "obsidian";
import type HabitTrackerPlugin from "./main";
import type { Habit } from "./types";

// ── Preset color palette ──────────────────────────────────────────────────────

const PRESET_COLORS: string[] = [
	"#6366f1", // indigo
	"#8b5cf6", // violet
	"#a855f7", // purple
	"#ec4899", // pink
	"#ef4444", // red
	"#f97316", // orange
	"#eab308", // yellow
	"#22c55e", // green
	"#14b8a6", // teal
	"#06b6d4", // cyan
	"#3b82f6", // blue
	"#64748b", // slate
];

// ── Modal class ───────────────────────────────────────────────────────────────

export default class HabitCreateModal extends Modal {
	private plugin: HabitTrackerPlugin;
	private onCreated: (habit: Habit) => void;

	// Form state
	private habitName = "";
	private habitColor = PRESET_COLORS[0];
	private habitQuote = "";
	private habitIcon = "";

	// DOM refs
	private nameInputEl: HTMLInputElement | null = null;
	private hexInputEl: HTMLInputElement | null = null;
	private colorSwatches: HTMLElement[] = [];
	private submitBtn: HTMLButtonElement | null = null;

	constructor(
		app: App,
		plugin: HabitTrackerPlugin,
		onCreated: (habit: Habit) => void,
	) {
		super(app);
		this.plugin = plugin;
		this.onCreated = onCreated;
	}

	// ── Modal lifecycle ──────────────────────────────────────────────────────

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("habit-create-modal");

		this.buildUI(contentEl);

		// Auto-focus the name field
		setTimeout(() => this.nameInputEl?.focus(), 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ── UI builder ───────────────────────────────────────────────────────────

	private buildUI(container: HTMLElement): void {
		// ── Title ──
		container.createEl("h2", {
			text: "New habit",
			cls: "modal-title",
		});

		// ── Name field ──
		new Setting(container)
			.setName("Name")
			.setDesc("What habit are you tracking?")
			.addText((text) => {
				this.nameInputEl = text.inputEl;
				text.setPlaceholder("e.g. Morning reading").onChange((v) => {
					this.habitName = v;
					this.updateSubmitState();
				});

				// Submit on Enter
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") this.handleSubmit();
				});
			});

		// ── Quote field ──
		new Setting(container)
			.setName("Motivational note")
			.setDesc("Appears below the habit name when expanded (optional).")
			.addText((text) =>
				text.setPlaceholder("e.g. for a sharper mind").onChange((v) => {
					this.habitQuote = v;
				}),
			);

		// ── Icon field ──
		new Setting(container)
			.setName("Icon")
			.setDesc("Lucide icon name, e.g. book-open, dumbbell (optional).")
			.addText((text) =>
				text.setPlaceholder("book-open").onChange((v) => {
					this.habitIcon = v.trim();
				}),
			);

		// ── Color picker ──
		const colorSection = container.createDiv({ cls: "color-section" });

		colorSection.createEl("div", {
			text: "Color",
			cls: "color-section-label",
		});

		// Swatch grid
		const swatchGrid = colorSection.createDiv({ cls: "swatch-grid" });

		for (const hex of PRESET_COLORS) {
			const swatch = swatchGrid.createDiv({ cls: "color-swatch" });
			swatch.style.setProperty("--swatch-color", hex);

			if (hex === this.habitColor) swatch.addClass("is-selected");

			swatch.addEventListener("click", () => {
				this.selectColor(hex);
			});

			swatch.setAttribute("title", hex);
			swatch.setAttribute("role", "radio");
			swatch.setAttribute("aria-label", `Color ${hex}`);
			swatch.setAttribute(
				"aria-checked",
				hex === this.habitColor ? "true" : "false",
			);
			swatch.setAttribute("tabindex", "0");
			swatch.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this.selectColor(hex);
				}
			});

			this.colorSwatches.push(swatch);
		}

		// Manual hex input
		const hexRow = colorSection.createDiv({ cls: "hex-row" });
		hexRow.createEl("span", { text: "#", cls: "hex-prefix" });

		this.hexInputEl = hexRow.createEl("input", {
			type: "text",
			cls: "hex-input",
			attr: {
				placeholder: "6366f1",
				maxlength: "6",
				"aria-label": "Custom hex color",
			},
		});
		this.hexInputEl.value = this.habitColor.replace("#", "");

		this.hexInputEl.addEventListener("input", () => {
			const raw = this.hexInputEl!.value.replace(/[^0-9a-fA-F]/g, "");
			this.hexInputEl!.value = raw;
			if (raw.length === 6) {
				this.selectColor("#" + raw, false);
			}
		});

		// Preview dot
		const previewDot = colorSection.createDiv({ cls: "color-preview-dot" });
		previewDot.style.background = this.habitColor;

		// Keep preview dot in sync — use a closure over previewDot
		const origSelect = this.selectColor.bind(this);
		this.selectColor = (hex: string, updateHex?: boolean) => {
			origSelect(hex, updateHex);
			previewDot.style.background = this.habitColor;
		};

		// ── Buttons ──
		const btnRow = container.createDiv({ cls: "modal-btn-row" });

		const cancelBtn = btnRow.createEl("button", {
			text: "Cancel",
			cls: "mod-cta-secondary",
		});
		cancelBtn.addEventListener("click", () => this.close());

		this.submitBtn = btnRow.createEl("button", {
			text: "Create habit",
			cls: "mod-cta",
			attr: { disabled: "true" },
		});
		this.submitBtn.addEventListener("click", () => this.handleSubmit());
	}

	// ── Color selection ──────────────────────────────────────────────────────

	private selectColor(hex: string, updateHexInput = true): void {
		this.habitColor = hex;

		// Update swatch selection state
		this.colorSwatches.forEach((swatch) => {
			const swatchHex = swatch.style.getPropertyValue("--swatch-color");
			const isSelected = swatchHex === hex;
			swatch.toggleClass("is-selected", isSelected);
			swatch.setAttribute("aria-checked", isSelected ? "true" : "false");
		});

		// Sync hex input
		if (updateHexInput && this.hexInputEl) {
			this.hexInputEl.value = hex.replace("#", "");
		}
	}

	// ── Submit state ─────────────────────────────────────────────────────────

	private updateSubmitState(): void {
		if (!this.submitBtn) return;
		const valid = this.habitName.trim().length > 0;
		this.submitBtn.toggleAttribute("disabled", !valid);
	}

	// ── Form submission ──────────────────────────────────────────────────────

	private async handleSubmit(): Promise<void> {
		const name = this.habitName.trim();
		if (!name) {
			this.nameInputEl?.focus();
			return;
		}

		if (this.submitBtn) {
			this.submitBtn.textContent = "Creating…";
			this.submitBtn.setAttribute("disabled", "true");
		}

		try {
			const habit = await this.plugin.dataManager.createHabit({
				name,
				quote: this.habitQuote.trim(),
				color: this.habitColor,
				icon: this.habitIcon || undefined,
			});

			new Notice(`✓ "${habit.name}" added`);
			this.onCreated(habit);
			this.close();
		} catch (err) {
			new Notice(`✗ Failed to create habit: ${err}`);
			if (this.submitBtn) {
				this.submitBtn.textContent = "Create habit";
				this.submitBtn.removeAttribute("disabled");
			}
		}
	}
}
