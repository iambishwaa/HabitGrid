declare module "*.svelte" {
	import type { ComponentConstructorOptions, SvelteComponent } from "svelte";

	export default class extends SvelteComponent {
		constructor(options: ComponentConstructorOptions);
		$set(props: Record<string, unknown>): void;
		$destroy(): void;
	}
}
