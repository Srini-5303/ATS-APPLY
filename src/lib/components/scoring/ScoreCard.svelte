<script lang="ts">
	import { DIMENSIONS, type Dimension, type ScoreResult } from '$engine/types/scoring';

	let { result }: { result: ScoreResult } = $props();

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
	const bars = $derived(
		DIMENSIONS.map((d) => ({
			dimension: d,
			label: LABELS[d],
			score: result.breakdown[d].score
		}))
	);

	// In general mode the keyword slot measures industry-vocabulary coverage rather than JD
	// matching, so the bar is labelled for what it actually shows (ADR 0001 §1).
	const keywordLabel = $derived(
		result.breakdown.keywordMatch.isIndustryProxy ? 'Industry terms' : 'Keywords'
	);

	const RADIUS = 34;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	const dashOffset = $derived(CIRCUMFERENCE * (1 - result.overallScore / 100));

	const tone = $derived(
		result.overallScore >= 75 ? 'good' : result.overallScore >= 50 ? 'mid' : 'low'
	);
</script>

<article class="card" data-testid="score-card" data-platform={result.platformId}>
	<header>
		<div>
			<h3>{result.system}</h3>
			<p class="vendor">{result.vendor}</p>
		</div>

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
	</header>

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
				<span class="bar-label">
					{bar.dimension === 'keywordMatch' ? keywordLabel : bar.label}
				</span>
				<span class="track-bar">
					<span class="fill" style:width="{bar.score}%"></span>
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

	.ring {
		width: 68px;
		height: 68px;
		flex-shrink: 0;
		transform: rotate(-90deg);
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
