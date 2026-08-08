<script lang="ts">
	import { DIMENSIONS, type ScoreResult, type Suggestion } from '$engine/types/scoring';
	import { dimensionEvidence, labelFor, STRONG_SCORE } from '$utils/evidence';

	/**
	 * One platform, opened up dimension by dimension.
	 *
	 * The card view shows six numbers and drops everything behind them, yet the engine already
	 * records *why* each one came out that way — which requirements went unmatched, which
	 * sections it could not find, how many bullets carry a figure. This is that evidence, with
	 * the advice for each bar sitting next to the bar it would move.
	 */

	let { result, open = false }: { result: ScoreResult; open?: boolean } = $props();

	const rows = $derived(
		DIMENSIONS.map((dimension) => ({
			dimension,
			label: labelFor(result, dimension),
			score: result.breakdown[dimension].score,
			evidence: dimensionEvidence(result, dimension),
			advice: result.suggestions.filter((s) => s.dimension === dimension)
		}))
	);

	/** Advice that belongs to the document rather than to any one bar. */
	const general = $derived(result.suggestions.filter((s) => s.dimension === undefined));
</script>

<details class="platform" {open} data-testid="platform-detail" data-platform={result.platformId}>
	<summary>
		<svg class="chevron" viewBox="0 0 12 12" aria-hidden="true">
			<path d="M4 2.5 L8 6 L4 9.5" fill="none" stroke="currentColor" stroke-width="1.5" />
		</svg>
		<span class="name">{result.system}</span>
		<span class="vendor">{result.vendor}</span>
		<span class="verdict {result.passesFilter ? 'pass' : 'fail'}">
			{result.passesFilter ? 'Likely to pass' : 'May be filtered'}
		</span>
		<span class="total" data-weak={result.overallScore < STRONG_SCORE}>{result.overallScore}</span>
	</summary>

	{#snippet advice(suggestion: Suggestion)}
		<div class="advice" data-testid="dimension-advice">
			<p class="advice-summary">
				<span class="impact {suggestion.impact}">{suggestion.impact}</span>
				{suggestion.summary}
			</p>
			{#each suggestion.details as detail, i (i)}
				<p class="detail">{detail}</p>
			{/each}
		</div>
	{/snippet}

	<div class="rows">
		{#each rows as row (row.dimension)}
			<section class="row" data-dimension={row.dimension}>
				<header>
					<h4>{row.label}</h4>
					<span class="score" data-weak={row.score < STRONG_SCORE}>{row.score}</span>
				</header>

				<ul class="evidence">
					{#each row.evidence as line, i (i)}
						<li>{line}</li>
					{/each}
				</ul>

				{#each row.advice as suggestion (suggestion.summary)}
					{@render advice(suggestion)}
				{/each}
			</section>
		{/each}

		{#if general.length > 0}
			<section class="row">
				<header><h4>Whole document</h4></header>
				{#each general as suggestion (suggestion.summary)}
					{@render advice(suggestion)}
				{/each}
			</section>
		{/if}
	</div>
</details>

<style>
	.platform {
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
	}

	summary {
		display: grid;
		grid-template-columns: auto auto 1fr auto auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		cursor: pointer;
		border-radius: var(--radius-lg);
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary:hover {
		background: var(--glass-bg-hover);
	}

	.chevron {
		width: 0.75rem;
		height: 0.75rem;
		color: var(--color-text-tertiary);
		transition: transform var(--duration-base) var(--ease-out);
	}

	.platform[open] .chevron {
		transform: rotate(90deg);
	}

	.name {
		font-weight: 600;
	}

	.vendor {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.verdict {
		font-size: var(--text-xs);
	}

	.verdict.pass {
		color: var(--color-green);
	}

	.verdict.fail {
		color: var(--color-amber);
	}

	.total {
		font-family: var(--font-mono);
		font-size: var(--text-2xl);
		font-variant-numeric: tabular-nums;
		color: var(--color-green);
	}

	.total[data-weak='true'] {
		color: var(--color-amber);
	}

	/* Six discrete blocks rather than rows in a table. The dimensions are independent
	   measurements, and a shared border made them read as one continuous list where a long
	   evidence line from one bled into the next. */
	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-1) var(--space-4) var(--space-4);
	}

	.row {
		padding: var(--space-4);
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: var(--radius-md);
	}

	.row header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	/* Matches the section labels in the extraction panel, so a heading that names a measured
	   thing looks the same everywhere in the report. */
	h4 {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-tertiary);
	}

	/* No bar here. The card view already draws six of them; repeating the shape inside the
	   detail view added length without adding information the number does not carry. Colour on
	   the number is what is left to carry the signal, so it does the whole job:
	   cyan is the first stop of the gradient the card bars fill with, so a healthy score reads
	   the same way in both views. Solid rather than a clipped gradient — across two or three
	   digits a gradient resolves to one colour anyway, and it would leave 36 elements per
	   report relying on `background-clip: text` to be visible at all. */
	.score {
		font-family: var(--font-mono);
		font-size: var(--text-xl);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--color-cyan);
	}

	.score[data-weak='true'] {
		color: color-mix(in srgb, var(--color-amber) 85%, white 15%);
	}

	.evidence {
		margin: var(--space-3) 0 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.evidence li + li {
		margin-top: var(--space-1);
	}

	.advice {
		margin-top: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: color-mix(in srgb, var(--color-cyan) 7%, transparent);
		border-left: 2px solid var(--color-cyan);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.advice-summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.detail {
		margin-top: var(--space-1);
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.impact {
		padding: 1px var(--space-2);
		border-radius: var(--radius-full);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 400;
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

	@media (max-width: 40rem) {
		summary {
			grid-template-columns: auto 1fr auto;
		}

		.vendor,
		.verdict {
			grid-column: 2 / -1;
		}
	}
</style>
