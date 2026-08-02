<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>{page.status} — ATS Screener</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap">
	<p class="status">{page.status}</p>
	<h1>Something went wrong</h1>
	<p class="msg">{page.error?.message ?? 'Unexpected error'}</p>

	{#if page.error?.requestId}
		<!-- Surfaced so a user can quote it in a bug report; the details stay server-side. -->
		<p class="ref">Reference: <code>{page.error.requestId}</code></p>
	{/if}

	<a href={resolve('/')}>Back to home</a>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		min-height: 70vh;
		padding: var(--space-8);
		text-align: center;
	}

	.status {
		font-family: var(--font-mono);
		font-size: var(--text-5xl);
		color: var(--color-text-tertiary);
	}

	.msg {
		color: var(--color-text-secondary);
	}

	.ref {
		font-size: var(--text-sm);
		color: var(--color-text-tertiary);
	}
</style>
