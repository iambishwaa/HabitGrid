// HabitEditModal.ts — Edit an existing habit's name, quote, icon, color

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

export default class HabitEditModal extends Modal {
	private plugin: HabitTrackerPlugin;
	private habit: Habit;
	private onSaved: (updated: Habit) => void;

	private habitName: string;
	private habitColor: string;
	private habitQuote: string;
	private habitIcon: string;

	private nameInputEl: HTMLInputElement | null = null;
	private hexInputEl: HTMLInputElement | null = null;
	private colorSwatches: HTMLElement[] = [];
	private submitBtn: HTMLButtonElement | null = null;
	private iconPreviewEl: HTMLElement | null = null;

	constructor(
		app: App,
		plugin: HabitTrackerPlugin,
		habit: Habit,
		onSaved: (updated: Habit) => void,
	) {
		super(app);
		this.plugin = plugin;
		this.habit = habit;
		this.onSaved = onSaved;
		// Pre-fill from existing habit
		this.habitName = habit.name;
		this.habitColor = habit.color;
		this.habitQuote = habit.quote ?? "";
		this.habitIcon = habit.icon ?? "";
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
		container.createEl("h2", { text: "Edit habit", cls: "modal-title" });

		// ── Name ──
		new Setting(container).setName("Name").addText((text) => {
			this.nameInputEl = text.inputEl;
			text.setValue(this.habitName)
				.setPlaceholder("e.g. Morning reading")
				.onChange((v) => {
					this.habitName = v;
					this.updateSubmitState();
				});
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") this.handleSubmit();
			});
		});

		// ── Quote ──
		new Setting(container)
			.setName("Motivational note")
			.setDesc("Short subtitle shown below the habit name.")
			.addText((text) =>
				text
					.setValue(this.habitQuote)
					.setPlaceholder("e.g. for a sharper mind")
					.onChange((v) => {
						this.habitQuote = v;
					}),
			);

		// ── Icon ──
		new Setting(container)
			.setName("Icon")
			.setDesc("Any Lucide icon name — e.g. book-open, dumbbell, apple")
			.addText((text) => {
				text.setValue(this.habitIcon)
					.setPlaceholder("book-open")
					.onChange((v) => {
						this.habitIcon = v.trim();
						this.refreshIconPreview();
					});
			});

		// Icon preview row
		const previewRow = container.createDiv({ cls: "icon-preview-row" });
		previewRow.createEl("span", {
			text: "Preview:",
			cls: "icon-preview-label",
		});
		this.iconPreviewEl = previewRow.createDiv({
			cls: "icon-preview-badge",
		});
		this.iconPreviewEl.style.background = this.habitColor;
		this.refreshIconPreview();

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
			if (raw.length === 6) this.selectColor("#" + raw, false);
		});

		const previewDot = colorSection.createDiv({ cls: "color-preview-dot" });
		previewDot.style.background = this.habitColor;
		// Override selectColor to also update preview dot
		const origSelect = this.selectColor.bind(this);
		this.selectColor = (hex, updateHex?) => {
			origSelect(hex, updateHex);
			previewDot.style.background = this.habitColor;
			if (this.iconPreviewEl)
				this.iconPreviewEl.style.background = this.habitColor;
		};

		// ── Buttons ──
		const btnRow = container.createDiv({ cls: "modal-btn-row" });
		const cancelBtn = btnRow.createEl("button", {
			text: "Cancel",
			cls: "mod-cta-secondary",
		});
		cancelBtn.addEventListener("click", () => this.close());
		this.submitBtn = btnRow.createEl("button", {
			text: "Save changes",
			cls: "mod-cta",
		});
		this.submitBtn.addEventListener("click", () => this.handleSubmit());
		this.updateSubmitState();
	}

	private refreshIconPreview(): void {
		if (!this.iconPreviewEl) return;
		this.iconPreviewEl.empty();
		this.iconPreviewEl.style.background = this.habitColor;
		if (this.habitIcon) {
			const isEmoji = /\p{Emoji}/u.test(this.habitIcon);
			if (isEmoji) {
				this.iconPreviewEl.textContent = this.habitIcon;
				(this.iconPreviewEl as HTMLElement).style.fontSize = "16px";
			} else {
				try {
					const { setIcon } = require("obsidian");
					setIcon(this.iconPreviewEl, this.habitIcon);
				} catch (_e) {
					this.iconPreviewEl.textContent = this.habitIcon.slice(0, 2);
				}
			}
		} else {
			this.iconPreviewEl.textContent = this.habitName
				.slice(0, 1)
				.toUpperCase();
		}
	}

	private selectColor(hex: string, updateHexInput = true): void {
		this.habitColor = hex;
		this.colorSwatches.forEach((s) => {
			const isSelected =
				s.style.getPropertyValue("--swatch-color") === hex;
			s.toggleClass("is-selected", isSelected);
			s.setAttribute("aria-checked", isSelected ? "true" : "false");
		});
		if (updateHexInput && this.hexInputEl) {
			this.hexInputEl.value = hex.replace("#", "");
		}
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
			this.submitBtn.textContent = "Saving…";
			this.submitBtn.setAttribute("disabled", "true");
		}
		try {
			await this.plugin.dataManager.updateHabit(this.habit.id, {
				name,
				quote: this.habitQuote.trim(),
				color: this.habitColor,
				icon: this.habitIcon || undefined,
			});
			const fresh = await this.plugin.dataManager.getHabit(this.habit.id);
			new Notice(`✓ "${name}" updated`);
			if (fresh) this.onSaved(fresh);
			this.close();
		} catch (err) {
			new Notice(`✗ Failed to save: ${err}`);
			if (this.submitBtn) {
				this.submitBtn.textContent = "Save changes";
				this.submitBtn.removeAttribute("disabled");
			}
		}
	}
}
