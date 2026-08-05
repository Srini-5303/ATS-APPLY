<script lang="ts">
	import { resolve } from '$app/paths';
	import { buildShareQuery } from '$lib/share';
	import { log } from '$lib/log';
	import { resumeStore } from '$stores/resume.svelte';
	import { scoresStore } from '$stores/scores.svelte';
	import ScoreCard from './ScoreCard.svelte';
	import ScoringStages from './ScoringStages.svelte';

	let exporting = $state(false);

	const delta = $derived(scoresStore.scoreDelta);

	const shareUrl = $derived(
		`${resolve('/share')}?${buildShareQuery({
			score: scoresStore.averageScore,
			passing: scoresStore.passingCount,
			delta,
			targeted: scoresStore.jobDescription.trim() !== ''
		})}`
	);

	async function download() {
		exporting = true;
		try {
			// jsPDF is ~350KB and most sessions never export, so it is loaded on demand.
			const { exportReport } = await import('$utils/export-pdf');
			await exportReport({
				results: scoresStore.results,
				averageScore: scoresStore.averageScore,
				passingCount: scoresStore.passingCount,
				...(resumeStore.file?.name === undefined ? {} : { fileName: resumeStore.file.name }),
				...(resumeStore.resume?.contact.name == null
					? {}
					: { candidateName: resumeStore.resume.contact.name }),
				targeted: scoresStore.jobDescription.trim() !== ''
			});
		} catch (err) {
			log.error('pdf export failed', { err: err instanceof Error ? err.message : String(err) });
		} finally {
			exporting = false;
		}
	}
</script>

<section class="dashboard" data-testid="dashboard" aria-live="polite">
	<div class="summary">
		<div class="headline">
			<p class="avg" data-testid="average-score">{scoresStore.averageScore}</p>
			<p class="avg-label">average across 6 platforms</p>
		</div>

		<dl class="stats" data-testid="summary-stats">
			<div>
				<dt>Likely to pass</dt>
				<dd data-testid="passing-count">{scoresStore.passingCount} of 6</dd>
			</div>
			<div>
				<dt>Spread</dt>
				<dd data-testid="spread">{scoresStore.spread} pts</dd>
			</div>
			{#if delta !== null}
				<div>
					<dt>Since last scan</dt>
					<dd class={delta > 0 ? 'up' : 'down'} data-testid="score-delta">
						{delta > 0 ? '+' : ''}{delta}
					</dd>
				</div>
			{/if}
		</dl>
	</div>

	<ScoringStages />

	{#if scoresStore.topSuggestions.length > 0}
		<div class="wins">
			<h2>Quick wins</h2>
			<ul>
				{#each scoresStore.topSuggestions as suggestion (suggestion.summary)}
					<li>
						<span class="impact {suggestion.impact}">{suggestion.impact}</span>
						<span>{suggestion.summary}</span>
						<span class="platforms">{suggestion.platforms.join(', ')}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="share-row">
		<button
			type="button"
			onclick={() => void download()}
			disabled={exporting}
			data-testid="export-pdf"
		>
			{exporting ? 'Building PDF…' : 'Download PDF report'}
		</button>
		<!-- shareUrl is built with resolve('/share'); the rule cannot see through the template
		     literal that appends the query string -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="share-link" href={shareUrl} data-testid="share-link">Share this result</a>
	</div>

	<div class="grid">
		{#each scoresStore.results as result (result.platformId)}
			<ScoreCard {result} />
		{/each}
	</div>
</section>

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
		padding: var(--space-6);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
	}

	.avg {
		font-family: var(--font-mono);
		font-size: var(--text-5xl);
		font-weight: 700;
		line-height: 1;
		background: var(--gradient-primary);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.avg-label {
		font-size: var(--text-sm);
		color: var(--color-text-tertiary);
	}

	.stats {
		display: flex;
		gap: var(--space-8);
	}

	.stats dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.stats dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-xl);
	}

	.stats .up {
		color: var(--color-green);
	}

	.stats .down {
		color: var(--color-amber);
	}

	.wins {
		padding: var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
	}

	.wins h2 {
		font-size: var(--text-base);
		margin-bottom: var(--space-3);
	}

	.wins ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}

	.wins li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
	}

	.impact {
		padding: 2px var(--space-2);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.impact.critical {
		background: color-mix(in srgb, var(--color-red) 20%, transparent);
		color: var(--color-red);
	}
	.impact.high {
		background: color-mix(in srgb, var(--color-amber) 20%, transparent);
		color: var(--color-amber);
	}
	.impact.medium,
	.impact.low {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-secondary);
	}

	.platforms {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.share-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.share-row button,
	.share-link {
		padding: var(--space-2) var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		font-size: var(--text-sm);
		color: var(--color-text-primary);
		text-decoration: none;
		cursor: pointer;
	}

	.share-row button:hover:not(:disabled),
	.share-link:hover {
		background: var(--glass-bg-hover);
	}

	.share-row button:disabled {
		opacity: 0.5;
		cursor: progress;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		gap: var(--space-4);
	}
</style>
