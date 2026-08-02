<script lang="ts">
	import { scoresStore } from '$stores/scores.svelte';
	import ScoreCard from './ScoreCard.svelte';
</script>

<section class="dashboard" data-testid="dashboard" aria-live="polite">
	<div class="summary">
		<div class="headline">
			<p class="avg" data-testid="average-score">{scoresStore.averageScore}</p>
			<p class="avg-label">average across 6 platforms</p>
		</div>

		<dl class="stats">
			<div>
				<dt>Likely to pass</dt>
				<dd data-testid="passing-count">{scoresStore.passingCount} of 6</dd>
			</div>
			<div>
				<dt>Spread</dt>
				<dd data-testid="spread">{scoresStore.spread} pts</dd>
			</div>
		</dl>
	</div>

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

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		gap: var(--space-4);
	}
</style>
