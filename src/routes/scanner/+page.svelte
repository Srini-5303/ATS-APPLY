<script lang="ts">
	// Phase 1 builds this out into the full upload -> parse -> score flow. The route exists
	// now so the landing-page link resolves against SvelteKit's typed routes.
</script>

<svelte:head>
	<title>Scan your resume — ATS Screener</title>
</svelte:head>

<section class="scanner">
	<h1>Scan your resume</h1>
	<p>Upload a PDF and see how six enterprise ATS platforms read it.</p>
</section>

<style>
	.scanner {
		max-width: 60rem;
		margin-inline: auto;
		padding: var(--space-16) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	h1 {
		font-size: var(--text-3xl);
	}

	p {
		color: var(--color-text-secondary);
	}
</style>
