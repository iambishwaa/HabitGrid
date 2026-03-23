// HabitCreateModal.ts

import { App, Modal, Notice, Setting } from "obsidian";
import type HabitTrackerPlugin from "./main";
import type { Habit } from "./types";

const PRESET_COLORS: string[] = [
	"#6366f1",
	"#8b5cf6",
	"#a855f7",
	"#ec4899",
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#14b8a6",
	"#06b6d4",
	"#3b82f6",
	"#64748b",
];

export default class HabitCreateModal extends Modal {
	private plugin: HabitTrackerPlugin;
	private onCreated: (habit: Habit) => void;

	private habitName = "";
	private habitColor = PRESET_COLORS[0];
	private habitQuote = "";
	private habitIcon = "";
	private habitKind: "boolean" | "counter" = "boolean";
	private habitTarget = 1;
	private habitUnit = "";

	private nameInputEl: HTMLInputElement | null = null;
	private targetRow: HTMLElement | null = null;
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

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("habit-create-modal");
		this.buildUI(contentEl);
		setTimeout(() => this.nameInputEl?.focus(), 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private buildUI(container: HTMLElement): void {
		container.createEl("h2", { text: "New habit", cls: "modal-title" });

		// ── Name ──
		new Setting(container).setName("Name").addText((text) => {
			this.nameInputEl = text.inputEl;
			text.setPlaceholder("e.g. Drink water").onChange((v) => {
				this.habitName = v;
				this.updateSubmitState();
			});
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") this.handleSubmit();
			});
		});

		// ── Quote ──
		new Setting(container).setName("Motivational note").addText((text) =>
			text.setPlaceholder("e.g. for a sharper mind").onChange((v) => {
				this.habitQuote = v;
			}),
		);

		// ── Icon ──
		new Setting(container)
			.setName("Icon")
			.setDesc("Emoji or Lucide icon name")
			.addText((text) =>
				text.setPlaceholder("💧 or droplets").onChange((v) => {
					this.habitIcon = v.trim();
				}),
			);

		// ── Type ──
		new Setting(container)
			.setName("Habit type")
			.setDesc("Simple done/not-done, or incremental counter")
			.addDropdown((drop) => {
				drop.addOption("boolean", "✓  Simple (done / not done)");
				drop.addOption(
					"counter",
					"🔢  Counter (multiple times per day)",
				);
				drop.setValue("boolean");
				drop.onChange((v) => {
					this.habitKind = v as "boolean" | "counter";
					if (this.targetRow) {
						this.targetRow.style.display =
							v === "counter" ? "" : "none";
					}
				});
			});

		// ── Counter config (hidden by default) ──
		this.targetRow = container.createDiv();
		this.targetRow.style.display = "none";

		new Setting(this.targetRow)
			.setName("Daily target")
			.setDesc("How many times to complete this habit per day")
			.addText((text) =>
				text.setPlaceholder("5").onChange((v) => {
					this.habitTarget = parseInt(v) || 1;
				}),
			);

		new Setting(this.targetRow)
			.setName("Unit")
			.setDesc("Label for each increment — e.g. L, pages, reps")
			.addText((text) =>
				text.setPlaceholder("e.g. L").onChange((v) => {
					this.habitUnit = v.trim();
				}),
			);

		// ── Color ──
		const colorSection = container.createDiv({ cls: "color-section" });
		colorSection.createEl("div", {
			text: "Color",
			cls: "color-section-label",
		});

		const swatchGrid = colorSection.createDiv({ cls: "swatch-grid" });
		for (const hex of PRESET_COLORS) {
			const swatch = swatchGrid.createDiv({ cls: "color-swatch" });
			swatch.style.setProperty("--swatch-color", hex);
			if (hex === this.habitColor) swatch.addClass("is-selected");
			swatch.setAttribute("role", "radio");
			swatch.setAttribute("tabindex", "0");
			swatch.setAttribute("title", hex);
			swatch.setAttribute(
				"aria-checked",
				hex === this.habitColor ? "true" : "false",
			);
			swatch.addEventListener("click", () => this.selectColor(hex));
			swatch.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this.selectColor(hex);
				}
			});
			this.colorSwatches.push(swatch);
		}

		// Native color picker — opens OS color wheel/gradient on click
		const pickerRow = colorSection.createDiv({ cls: "color-picker-row" });
		pickerRow.createEl("span", {
			text: "Custom color:",
			cls: "color-picker-label",
		});

		const colorInput = pickerRow.createEl("input", {
			type: "color",
			cls: "color-picker-input",
			attr: { value: this.habitColor },
		}) as HTMLInputElement;

		const previewDot = pickerRow.createDiv({ cls: "color-preview-dot" });
		previewDot.style.background = this.habitColor;

		colorInput.addEventListener("input", () => {
			this.selectColor(colorInput.value, false);
			previewDot.style.background = colorInput.value;
		});

		const origSelect = this.selectColor.bind(this);
		this.selectColor = (hex, updatePicker = true) => {
			origSelect(hex, updatePicker);
			previewDot.style.background = hex;
			if (updatePicker) colorInput.value = hex;
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

	private selectColor(hex: string, updateHexInput = true): void {
		this.habitColor = hex;
		this.colorSwatches.forEach((s) => {
			const sel = s.style.getPropertyValue("--swatch-color") === hex;
			s.toggleClass("is-selected", sel);
			s.setAttribute("aria-checked", sel ? "true" : "false");
		});
		if (updateHexInput && this.hexInputEl)
			this.hexInputEl.value = hex.replace("#", "");
	}

	private updateSubmitState(): void {
		if (!this.submitBtn) return;
		this.submitBtn.toggleAttribute("disabled", !this.habitName.trim());
	}

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
				kind: this.habitKind,
				target:
					this.habitKind === "counter"
						? this.habitTarget || 1
						: undefined,
				unit:
					this.habitKind === "counter"
						? this.habitUnit || undefined
						: undefined,
			});
			new Notice(`✓ "${habit.name}" added`);
			this.onCreated(habit);
			this.close();
		} catch (err) {
			new Notice(`✗ Failed: ${err}`);
			if (this.submitBtn) {
				this.submitBtn.textContent = "Create habit";
				this.submitBtn.removeAttribute("disabled");
			}
		}
	}
}
