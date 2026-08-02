<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ScoreDashboard from '$components/scoring/ScoreDashboard.svelte';
	import { scoresStore } from '$stores/scores.svelte';
	import type { ScanHistoryEntry } from '$stores/persistence/types';

	// PRD §12.1 called this Firebase-only, but §15.2 gives anonymous mode a localStorage
	// history — so it renders here too rather than showing an empty gate.
	let confirmingClear = $state(false);

	onMount(() => {
		void scoresStore.loadHistory();
	});

	function formatDate(iso: string): string {
		const date = new Date(iso);
		return Number.isNaN(date.getTime())
			? 'Unknown date'
			: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	function open(entry: ScanHistoryEntry) {
		scoresStore.view(entry);
	}

	async function confirmClear() {
		await scoresStore.clearHistory();
		confirmingClear = false;
	}

	/** Best and worst across the stored scans, for the journey summary. */
	const journey = $derived.by(() => {
		const entries = scoresStore.history;
		if (entries.length < 2) return null;

		const scores = entries.map((e) => e.averageScore);
		// History is newest-first, so the oldest entry is the starting point.
		const first = scores.at(-1) ?? 0;
		const latest = scores[0] ?? 0;

		return { first, latest, change: latest - first, best: Math.max(...scores) };
	});
</script>

<svelte:head>
	<title>Scan history — ATS Screener</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="history">
	<header>
		<h1>Scan history</h1>
		<p>Stored in this browser only. Nothing is uploaded.</p>
	</header>

	{#if scoresStore.history.length === 0}
		<div class="empty" data-testid="history-empty">
			<p>No scans yet.</p>
			<a class="cta" href={resolve('/scanner')}>Scan a resume</a>
		</div>
	{:else}
		{#if journey}
			<dl class="journey" data-testid="journey">
				<div>
					<dt>First scan</dt>
					<dd>{journey.first}</dd>
				</div>
				<div>
					<dt>Latest</dt>
					<dd>{journey.latest}</dd>
				</div>
				<div>
					<dt>Change</dt>
					<dd class={journey.change >= 0 ? 'up' : 'down'}>
						{journey.change >= 0 ? '+' : ''}{journey.change}
					</dd>
				</div>
				<div>
					<dt>Best</dt>
					<dd>{journey.best}</dd>
				</div>
			</dl>
		{/if}

		<ul class="entries" data-testid="history-list">
			{#each scoresStore.history as entry (entry.id)}
				<li>
					<button
						type="button"
						class="entry"
						onclick={() => {
							open(entry);
						}}
					>
						<span class="score">{entry.averageScore}</span>
						<span class="meta">
							<span class="when">{formatDate(entry.timestamp)}</span>
							<span class="detail">
								{entry.mode === 'targeted' ? 'Targeted' : 'General'}
								· {entry.passingCount} of 6 passing
								{#if entry.fileName}· {entry.fileName}{/if}
							</span>
							{#if entry.jobDescriptionSnippet}
								<span class="snippet">{entry.jobDescriptionSnippet}</span>
							{/if}
						</span>
					</button>
					<button
						type="button"
						class="remove"
						aria-label="Delete scan from {formatDate(entry.timestamp)}"
						onclick={() => {
							void scoresStore.removeFromHistory(entry.id);
						}}
					>
						Delete
					</button>
				</li>
			{/each}
		</ul>

		<div class="actions">
			{#if confirmingClear}
				<span class="confirm">Delete all {scoresStore.history.length} scans?</span>
				<button
					type="button"
					class="danger"
					onclick={() => {
						void confirmClear();
					}}
				>
					Yes, delete
				</button>
				<button
					type="button"
					onclick={() => {
						confirmingClear = false;
					}}>Cancel</button
				>
			{:else}
				<button
					type="button"
					onclick={() => {
						confirmingClear = true;
					}}
					data-testid="clear-history"
				>
					Clear history
				</button>
			{/if}
		</div>
	{/if}

	{#if scoresStore.viewingHistory && scoresStore.hasResults}
		<section class="viewer" data-testid="history-viewer">
			<div class="viewer-head">
				<h2>Stored scan</h2>
				<button
					type="button"
					onclick={() => {
						void goto(resolve('/scanner'));
					}}
				>
					Scan again
				</button>
			</div>
			<ScoreDashboard />
		</section>
	{/if}
</div>

<style>
	.history {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		max-width: 60rem;
		margin-inline: auto;
		padding: var(--space-12) var(--space-6) var(--space-24);
	}

	h1 {
		font-size: var(--text-3xl);
	}

	header p {
		color: var(--color-text-secondary);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-8);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
	}

	.cta {
		padding: var(--space-2) var(--space-5);
		border-radius: var(--radius-full);
		background: var(--gradient-primary);
		color: #06060f;
		font-weight: 600;
		text-decoration: none;
	}

	.journey {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-8);
		padding: var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
	}

	.journey dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.journey dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-2xl);
	}

	.up {
		color: var(--color-green);
	}
	.down {
		color: var(--color-amber);
	}

	.entries {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}

	.entries li {
		display: flex;
		align-items: stretch;
		gap: var(--space-2);
	}

	.entry {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
	}

	.entry:hover {
		background: var(--glass-bg-hover);
	}

	.score {
		font-family: var(--font-mono);
		font-size: var(--text-2xl);
		min-width: 3ch;
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.when {
		font-size: var(--text-sm);
	}

	.detail,
	.snippet {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.snippet {
		max-width: 40rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.confirm {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	button {
		padding: var(--space-2) var(--space-4);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	button:hover {
		background: var(--glass-bg-hover);
	}

	.remove {
		color: var(--color-text-tertiary);
	}

	.danger {
		color: var(--color-red);
		border-color: color-mix(in srgb, var(--color-red) 40%, transparent);
	}

	.viewer {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding-top: var(--space-6);
		border-top: 1px solid var(--glass-border);
	}

	.viewer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	h2 {
		font-size: var(--text-xl);
	}
</style>
