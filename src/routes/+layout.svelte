<script lang="ts">
	import '$styles/global.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<a class="skip-link" href="#main">Skip to content</a>

<main id="main">
	{@render children()}
</main>
