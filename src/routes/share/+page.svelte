<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const share = $derived(data.share);
	const ogUrl = $derived(
		`${page.url.origin}/api/og?s=${String(share.score)}&p=${String(share.passing)}`
	);

	const tone = $derived(share.score >= 75 ? 'good' : share.score >= 50 ? 'mid' : 'low');

	const tweetUrl = $derived(
		`https://twitter.com/intent/tweet?${new URLSearchParams({
			text: `My resume scores ${String(share.score)}/100 across 6 enterprise ATS platforms — ${String(share.passing)} of 6 would let it through.`,
			url: page.url.href
		}).toString()}`
	);

	let copied = $state(false);

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(page.url.href);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard access can be denied; the URL is visible in the address bar anyway.
			copied = false;
		}
	}
</script>

<svelte:head>
	<title>ATS score: {share.score}/100 — ATS Screener</title>
	<meta
		name="description"
		content="Scored {share.score}/100 across 6 enterprise ATS platforms. {share.passing} of 6 would pass."
	/>
	<meta property="og:title" content="ATS score: {share.score}/100" />
	<meta
		property="og:description"
		content="{share.passing} of 6 enterprise ATS platforms would let this resume through."
	/>
	<meta property="og:image" content={ogUrl} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content={ogUrl} />
</svelte:head>

<div class="share">
	<div class="card">
		<p class="label">ATS readiness</p>
		<p class="score {tone}" data-testid="share-score">{share.score}</p>
		<p class="sub" data-testid="share-passing">
			{share.passing} of 6 platforms would let this resume through
		</p>

		{#if share.delta !== null && share.delta !== 0}
			<p class="delta {share.delta > 0 ? 'up' : 'down'}">
				{share.delta > 0 ? '+' : ''}{share.delta} since the previous scan
			</p>
		{/if}

		<p class="mode">{share.targeted ? 'Scored against a specific job' : 'General readiness'}</p>
	</div>

	<div class="actions">
		<a class="cta" href={resolve('/scanner')}>Scan your own resume</a>
		<!-- resolve() applies to app routes; this is an external intent URL -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="secondary" href={tweetUrl} target="_blank" rel="noopener noreferrer">Share on X</a>
		<button type="button" class="secondary" onclick={() => void copyLink()}>
			{copied ? 'Copied' : 'Copy link'}
		</button>
	</div>

	<p class="disclaimer">
		Shared scores are self-reported and are not verified. Run your own scan to see how your resume
		reads.
	</p>
</div>

<style>
	.share {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-6);
		max-width: 34rem;
		margin-inline: auto;
		padding: var(--space-20) var(--space-6);
		text-align: center;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-10) var(--space-6);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-xl);
	}

	.label {
		font-size: var(--text-xs);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.score {
		font-family: var(--font-mono);
		font-size: var(--text-7xl);
		font-weight: 700;
		line-height: 1;
	}

	.good {
		color: var(--color-green);
	}
	.mid {
		color: var(--color-amber);
	}
	.low {
		color: var(--color-red);
	}

	.sub {
		color: var(--color-text-secondary);
	}

	.delta {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.up {
		color: var(--color-green);
	}
	.down {
		color: var(--color-amber);
	}

	.mode {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-3);
	}

	.cta,
	.secondary {
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius-full);
		text-decoration: none;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.cta {
		background: var(--gradient-primary);
		color: #06060f;
		font-weight: 600;
		border: none;
	}

	.secondary {
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		color: var(--color-text-primary);
	}

	.disclaimer {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
		max-width: 28rem;
	}
</style>
