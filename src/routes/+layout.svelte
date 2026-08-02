<script lang="ts">
	import '$styles/global.css';
	import type { Snippet } from 'svelte';
	import Navbar from '$components/ui/Navbar.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<a class="skip-link" href="#main">Skip to content</a>

<Navbar />

<main id="main">
	{@render children()}
</main>

<footer>
	<p>Parsed entirely in your browser. Your resume file is never uploaded.</p>
</footer>

<style>
	main {
		min-height: 70vh;
	}

	footer {
		padding: var(--space-8) var(--space-6);
		border-top: 1px solid var(--glass-border);
		text-align: center;
		font-size: var(--text-sm);
		color: var(--color-text-tertiary);
	}
</style>
