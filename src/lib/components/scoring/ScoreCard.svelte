<script lang="ts">
	import { DIMENSIONS, type Dimension, type ScoreResult } from '$engine/types/scoring';
	import { scoresStore } from '$stores/scores.svelte';

	let { result }: { result: ScoreResult } = $props();

	/**
	 * What the AI pass changed on this platform, if anything.
	 *
	 * Shown on the card rather than only in the summary because this is where the number the
	 * user is reading actually lives — a total elsewhere saying "adjusted 5 of 6" does not tell
	 * them which five.
	 */
	const adjustment = $derived(scoresStore.adjustmentFor(result.platformId));
	const ruleBasedScore = $derived(scoresStore.ruleBasedScores[result.platformId]);

	const LABELS: Record<Dimension, string> = {
		formatting: 'Formatting',
		keywordMatch: 'Keywords',
		sections: 'Sections',
		experience: 'Experience',
		education: 'Education',
		quantification: 'Quantification'
	};

	// Six bars, not five. PRD §12.2 drew five and omitted quantification even though it
	// carries up to 20% of the weight (ADR 0001 §5).
	//
	// In general mode the keyword slot measures industry-vocabulary coverage rather than JD
	// matching, so that bar is labelled for what it actually shows (ADR 0001 §1).
	const bars = $derived(
		DIMENSIONS.map((d) => ({
			dimension: d,
			label:
				d === 'keywordMatch' && result.breakdown.keywordMatch.isIndustryProxy
					? 'Industry terms'
					: LABELS[d],
			score: result.breakdown[d].score
		}))
	);

	const RADIUS = 34;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	const dashOffset = $derived(CIRCUMFERENCE * (1 - result.overallScore / 100));

	/**
	 * At or above this a score reads as healthy.
	 *
	 * One constant for both the ring and the dimension bars: they sit on the same card, and a
	 * bar that stays cool while the ring beside it has already turned would be telling the
	 * reader two different things about the same threshold.
	 */
	const STRONG_SCORE = 75;

	function toneFor(score: number): 'good' | 'mid' | 'low' {
		if (score >= STRONG_SCORE) return 'good';
		if (score >= 50) return 'mid';
		return 'low';
	}

	const tone = $derived(toneFor(result.overallScore));
</script>

<article class="card" data-testid="score-card" data-platform={result.platformId}>
	<header>
		<div>
			<h3>{result.system}</h3>
			<p class="vendor">{result.vendor}</p>
		</div>

		<div class="ring-wrap">
			<svg viewBox="0 0 80 80" class="ring" aria-hidden="true">
				<circle cx="40" cy="40" r={RADIUS} class="track" />
				<circle
					cx="40"
					cy="40"
					r={RADIUS}
					class="value {tone}"
					stroke-dasharray={CIRCUMFERENCE}
					stroke-dashoffset={dashOffset}
				/>
				<text x="40" y="40" class="score-text">{result.overallScore}</text>
			</svg>

			{#if adjustment !== null}
				<span
					class="adjustment"
					data-testid="ai-adjustment"
					title="The AI review moved this score by {adjustment} from the rule-based {ruleBasedScore}"
				>
					{adjustment > 0 ? '+' : ''}{adjustment}
				</span>
			{/if}
		</div>
	</header>

	{#if adjustment !== null}
		<p class="sr-only">
			The AI review adjusted this score by {adjustment} points from the rule-based
			{ruleBasedScore}.
		</p>
	{/if}

	<p class="sr-only">
		{result.system} scores {result.overallScore} out of 100 and is
		{result.passesFilter ? 'likely to pass' : 'likely to be filtered out'}.
	</p>

	<p class="status {result.passesFilter ? 'pass' : 'fail'}" data-testid="score-status">
		{result.passesFilter ? 'Likely to pass' : 'May be filtered'}
	</p>

	<ul class="bars">
		{#each bars as bar (bar.dimension)}
			<li>
				<span class="bar-label">{bar.label}</span>
				<span class="track-bar">
					<span class="fill" data-weak={bar.score < STRONG_SCORE} style:width="{bar.score}%"></span>
				</span>
				<span class="bar-value">{bar.score}</span>
			</li>
		{/each}
	</ul>
</article>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	h3 {
		font-size: var(--text-lg);
	}

	.vendor {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.ring-wrap {
		position: relative;
		flex-shrink: 0;
		line-height: 0;
	}

	.ring {
		width: 68px;
		height: 68px;
		flex-shrink: 0;
		transform: rotate(-90deg);
	}

	/* Pinned to the ring rather than placed in a row of its own: it annotates this number, and
	   reads as a correction to it.
	   Cyan carries "the AI touched this" on every chip, because amber would collide with the
	   amber ring on exactly the cards most likely to have been adjusted downwards. Direction is
	   in the sign, which is unambiguous without colour. */
	.adjustment {
		position: absolute;
		right: -4px;
		bottom: -2px;
		padding: 1px var(--space-2);
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-cyan) 40%, transparent);
		background: var(--color-bg-primary);
		color: var(--color-cyan);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
	}

	.track {
		fill: none;
		stroke: rgba(255, 255, 255, 0.09);
		stroke-width: 7;
	}

	.value {
		fill: none;
		stroke-width: 7;
		stroke-linecap: round;
		transition: stroke-dashoffset var(--duration-slow) var(--ease-out);
	}

	.value.good {
		stroke: var(--color-green);
	}
	.value.mid {
		stroke: var(--color-amber);
	}
	.value.low {
		stroke: var(--color-red);
	}

	.score-text {
		fill: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 22px;
		text-anchor: middle;
		dominant-baseline: central;
		transform: rotate(90deg);
		transform-origin: 40px 40px;
	}

	.status {
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.pass {
		color: var(--color-green);
	}
	.fail {
		color: var(--color-amber);
	}

	.bars {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}

	.bars li {
		display: grid;
		grid-template-columns: 6.5rem 1fr 2rem;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-xs);
	}

	.bar-label {
		color: var(--color-text-secondary);
	}

	.track-bar {
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
		transition: width var(--duration-slow) var(--ease-out);
	}

	/* Attribute rather than a class so the threshold is assertable in a test without pinning a
	   style name. (0,2,0) beats the plain `.fill` rule above, so ordering is not load-bearing. */
	.fill[data-weak='true'] {
		background: var(--gradient-warn);
	}

	.bar-value {
		font-family: var(--font-mono);
		text-align: right;
		color: var(--color-text-tertiary);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}
</style>
