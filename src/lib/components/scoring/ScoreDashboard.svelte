<script lang="ts">
	import { log } from '$lib/log';
	import { resumeStore } from '$stores/resume.svelte';
	import { scoresStore } from '$stores/scores.svelte';
	import PlatformDetail from './PlatformDetail.svelte';
	import ScoreCard from './ScoreCard.svelte';
	import ScoringStages from './ScoringStages.svelte';

	let exporting = $state(false);

	const delta = $derived(scoresStore.scoreDelta);

	type View = 'cards' | 'detail';

	/**
	 * Cards first: six numbers side by side is the comparison people come for. The detail view
	 * answers the next question — why this number — and costs a click rather than pushing six
	 * expanded panels onto everyone.
	 */
	let view = $state<View>('cards');

	const VIEWS: { id: View; label: string }[] = [
		{ id: 'cards', label: 'Cards' },
		{ id: 'detail', label: 'Detail' }
	];

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

	<div class="toolbar">
		<div class="tabs" role="tablist" aria-label="How to show the platform scores">
			{#each VIEWS as tab (tab.id)}
				<button
					type="button"
					role="tab"
					id="tab-{tab.id}"
					aria-selected={view === tab.id}
					aria-controls="panel-{tab.id}"
					class:selected={view === tab.id}
					onclick={() => (view = tab.id)}
					data-testid="view-{tab.id}"
				>
					<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
						{#if tab.id === 'cards'}
							<rect x="2" y="2" width="5" height="5" rx="1" />
							<rect x="9" y="2" width="5" height="5" rx="1" />
							<rect x="2" y="9" width="5" height="5" rx="1" />
							<rect x="9" y="9" width="5" height="5" rx="1" />
						{:else}
							<path d="M2 4h12M2 8h12M2 12h7" />
						{/if}
					</svg>
					{tab.label}
				</button>
			{/each}
		</div>

		<!-- Icon only: the label was the longest string in the row and this is a secondary
		     action. The accessible name carries the full wording. -->
		<button
			type="button"
			class="download"
			onclick={() => void download()}
			disabled={exporting}
			aria-label={exporting ? 'Building the PDF report' : 'Download the PDF report'}
			title={exporting ? 'Building the PDF report…' : 'Download the PDF report'}
			data-testid="export-pdf"
		>
			{#if exporting}
				<span class="spin" aria-hidden="true"></span>
			{:else}
				<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
					<path d="M8 2v7.5M4.75 6.75 8 10l3.25-3.25M3 13h10" />
				</svg>
			{/if}
		</button>
	</div>

	{#if view === 'cards'}
		<div class="grid" role="tabpanel" id="panel-cards" aria-labelledby="tab-cards">
			{#each scoresStore.results as result (result.platformId)}
				<ScoreCard {result} />
			{/each}
		</div>
	{:else}
		<div class="stack" role="tabpanel" id="panel-detail" aria-labelledby="tab-detail">
			{#each scoresStore.results as result, i (result.platformId)}
				<!-- The first opens so the view is never a wall of shut rows with nothing to read. -->
				<PlatformDetail {result} open={i === 0} />
			{/each}
		</div>
	{/if}
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

	/* Tabs and the export action share one line: they are both controls over the same panel,
	   and the export button was previously a full-width row of its own for one small action. */
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.download {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background var(--duration-base) var(--ease-out);
	}

	.download:hover:not(:disabled) {
		background: var(--glass-bg-hover);
		color: var(--color-text-primary);
	}

	.download:disabled {
		cursor: progress;
	}

	.spin {
		width: 0.875rem;
		height: 0.875rem;
		border: 1.5px solid color-mix(in srgb, var(--color-cyan) 30%, transparent);
		border-top-color: var(--color-cyan);
		border-radius: var(--radius-full);
		animation: spin 700ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation: none;
			opacity: 0.7;
		}
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: var(--space-1);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		align-self: flex-start;
	}

	.tabs button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		background: transparent;
		border: 0;
		border-radius: var(--radius-full);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-text-tertiary);
		cursor: pointer;
		transition: background var(--duration-base) var(--ease-out);
	}

	.tabs button:hover:not(.selected) {
		background: var(--glass-bg-hover);
		color: var(--color-text-secondary);
	}

	.tabs .selected {
		background: rgba(255, 255, 255, 0.09);
		color: var(--color-text-primary);
	}

	.icon {
		width: 0.875rem;
		height: 0.875rem;
		flex-shrink: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		gap: var(--space-4);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	@media (max-width: 34rem) {
		.tab-hint {
			display: none;
		}
	}
</style>
