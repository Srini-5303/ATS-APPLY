<script lang="ts">
	import { DIMENSIONS, type Dimension, type ScoreResult } from '$engine/types/scoring';

	/**
	 * One platform, opened up dimension by dimension.
	 *
	 * The card view shows six numbers and drops everything behind them, yet the engine already
	 * records *why* each one came out that way — which requirements went unmatched, which
	 * sections it could not find, how many bullets carry a figure. This is that evidence, with
	 * the advice for each bar sitting next to the bar it would move.
	 */

	let { result, open = false }: { result: ScoreResult; open?: boolean } = $props();

	const LABELS: Record<Dimension, string> = {
		formatting: 'Formatting',
		keywordMatch: 'Keywords',
		sections: 'Sections',
		experience: 'Experience',
		education: 'Education',
		quantification: 'Quantification'
	};

	/** Matches the ring and the card bars — one threshold across the whole report. */
	const STRONG_SCORE = 75;

	/** At most this many terms before a list stops being readable. */
	const SAMPLE = 12;

	function sample(terms: string[]): string {
		const rest = terms.length - SAMPLE;
		const head = terms.slice(0, SAMPLE).join(', ');
		return rest > 0 ? `${head} + ${String(rest)} more` : head;
	}

	/**
	 * The evidence behind one score, in the engine's own words.
	 *
	 * Returns the facts only. Anything prescriptive belongs in a suggestion, so the two never
	 * say the same thing twice in one panel.
	 */
	function evidenceFor(dimension: Dimension): string[] {
		const b = result.breakdown;

		switch (dimension) {
			case 'formatting':
				return b.formatting.issues.length === 0
					? ['Nothing in the layout tripped this parser.']
					: b.formatting.details;

			case 'keywordMatch': {
				const noun = b.keywordMatch.isIndustryProxy ? 'industry terms' : 'requirements';
				const lines = [
					`Matched ${String(b.keywordMatch.matched.length)} of ${String(
						b.keywordMatch.matched.length + b.keywordMatch.missing.length
					)} ${noun}.`
				];
				if (b.keywordMatch.matched.length > 0) {
					lines.push(`Found: ${sample(b.keywordMatch.matched)}.`);
				}
				if (b.keywordMatch.missing.length > 0) {
					lines.push(`Absent: ${sample(b.keywordMatch.missing)}.`);
				}
				if (b.keywordMatch.synonymMatched.length > 0) {
					lines.push(
						`Credited at a discount because the wording differs: ${sample(b.keywordMatch.synonymMatched)}.`
					);
				}
				return lines;
			}

			case 'sections': {
				const lines = [`Found: ${b.sections.present.join(', ') || 'none'}.`];
				if (b.sections.missing.length > 0) {
					lines.push(`This platform also expects: ${b.sections.missing.join(', ')}.`);
				}
				return lines;
			}

			case 'experience':
				if (b.experience.totalBullets === 0)
					return ['No bullet points were found under your roles.'];
				return [
					`${String(b.experience.actionVerbCount)} of ${String(b.experience.totalBullets)} bullets open with a strong action verb.`,
					// Label once, then quote. Repeating "Strongest:" on every line reads as a stutter.
					...(b.experience.highlights.length > 0
						? ['Your strongest bullets:', ...b.experience.highlights.map((h) => `“${h}”`)]
						: [])
				];

			case 'education':
				return b.education.notes.length > 0 ? b.education.notes : ['Nothing missing here.'];

			case 'quantification':
				if (b.quantification.totalBullets === 0) return ['No bullet points to measure.'];
				return [
					`${String(b.quantification.quantifiedBullets)} of ${String(b.quantification.totalBullets)} bullets carry a concrete figure.`,
					...(b.quantification.examples.length > 0
						? ['Counted here:', ...b.quantification.examples.map((e) => `“${e}”`)]
						: [])
				];
		}
	}

	const rows = $derived(
		DIMENSIONS.map((dimension) => ({
			dimension,
			label:
				dimension === 'keywordMatch' && result.breakdown.keywordMatch.isIndustryProxy
					? 'Industry terms'
					: LABELS[dimension],
			score: result.breakdown[dimension].score,
			evidence: evidenceFor(dimension),
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

	<div class="rows">
		{#each rows as row (row.dimension)}
			<section class="row" data-dimension={row.dimension}>
				<header>
					<h4>{row.label}</h4>
					<span class="track">
						<span class="fill" data-weak={row.score < STRONG_SCORE} style:width="{row.score}%"
						></span>
					</span>
					<span class="score" data-weak={row.score < STRONG_SCORE}>{row.score}</span>
				</header>

				<ul class="evidence">
					{#each row.evidence as line, i (i)}
						<li>{line}</li>
					{/each}
				</ul>

				{#each row.advice as suggestion (suggestion.summary)}
					<div class="advice" data-testid="dimension-advice">
						<p class="summary">
							<span class="impact {suggestion.impact}">{suggestion.impact}</span>
							{suggestion.summary}
						</p>
						{#each suggestion.details as detail, i (i)}
							<p class="detail">{detail}</p>
						{/each}
					</div>
				{/each}
			</section>
		{/each}

		{#if general.length > 0}
			<section class="row">
				<header><h4>Whole document</h4></header>
				{#each general as suggestion (suggestion.summary)}
					<div class="advice" data-testid="dimension-advice">
						<p class="summary">
							<span class="impact {suggestion.impact}">{suggestion.impact}</span>
							{suggestion.summary}
						</p>
						{#each suggestion.details as detail, i (i)}
							<p class="detail">{detail}</p>
						{/each}
					</div>
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

	.rows {
		display: flex;
		flex-direction: column;
		padding: 0 var(--space-5) var(--space-5);
	}

	.row {
		padding: var(--space-4) 0;
		border-top: 1px solid var(--glass-border);
	}

	.row header {
		display: grid;
		grid-template-columns: 9rem 1fr 2.5rem;
		align-items: center;
		gap: var(--space-3);
	}

	h4 {
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.track {
		height: 6px;
		background: rgba(255, 255, 255, 0.08);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--gradient-primary);
		border-radius: var(--radius-full);
	}

	.fill[data-weak='true'] {
		background: var(--gradient-warn);
	}

	.score {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-tertiary);
	}

	.score[data-weak='true'] {
		color: color-mix(in srgb, var(--color-amber) 85%, white 15%);
	}

	/* Indented to the bar's own column, so the eye reads evidence as belonging to the score
	   above it rather than to the panel. */
	.evidence {
		margin: var(--space-2) 0 0 9.75rem;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.evidence li + li {
		margin-top: var(--space-1);
	}

	.advice {
		margin: var(--space-3) 0 0 9.75rem;
		padding: var(--space-3) var(--space-4);
		background: rgba(255, 255, 255, 0.03);
		border-left: 2px solid var(--color-cyan);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.summary {
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

		.row header {
			grid-template-columns: 1fr 2.5rem;
		}

		.track {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		.evidence,
		.advice {
			margin-left: 0;
		}
	}
</style>
