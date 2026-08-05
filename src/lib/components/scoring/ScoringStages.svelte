<script lang="ts">
	import { scoresStore } from '$stores/scores.svelte';

	/**
	 * The two-stage provenance ledger.
	 *
	 * Scoring genuinely happens in two passes — rules produce a number in the browser, then an
	 * LLM adjusts it by at most ±15 — but on screen that was one line of grey text and a
	 * pulsing dot. Numbers appeared, numbers quietly changed, and nothing said a second pass
	 * had run.
	 *
	 * Numbering is used here because the content really is a sequence: stage 2 reads stage 1's
	 * output and cannot start before it.
	 *
	 * No progress bar: the round trip has no knowable duration, so a bar would have to invent
	 * one. An elapsed counter says the same thing without lying.
	 */

	let elapsedMs = $state(0);

	// The cleanup runs both when `refining` flips and when the component is destroyed, so the
	// timer needs no handle outside this effect.
	$effect(() => {
		if (!scoresStore.refining) return;

		const startedAt = Date.now();
		elapsedMs = 0;
		const timer = setInterval(() => (elapsedMs = Date.now() - startedAt), 100);

		return () => {
			clearInterval(timer);
		};
	});

	const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

	type Stage = 'waiting' | 'running' | 'landed' | 'skipped';

	function currentStage(): Stage {
		if (scoresStore.refining) return 'running';
		if (scoresStore.retryAtMs !== null || scoresStore.refinementUnavailable) return 'skipped';
		if (scoresStore.provider !== null && scoresStore.provider !== 'rule-based') return 'landed';
		return 'waiting';
	}

	const aiStage = $derived(currentStage());

	/** Model name only — the vendor prefix is noise once the row already says which stage. */
	const model = $derived(scoresStore.provider?.split(':').at(-1) ?? null);
</script>

<ol class="ledger" data-testid="provenance" aria-live="polite">
	<li class="stage done">
		<span class="index" aria-hidden="true">1</span>
		<span class="name">Rules</span>
		<span class="detail">{scoresStore.results.length} platforms scored in your browser</span>
		<span class="state">done</span>
	</li>

	<li class="stage {aiStage}">
		<span class="index" aria-hidden="true">2</span>
		<span class="name">AI review</span>

		<span class="detail">
			{#if aiStage === 'running'}
				Refining the rule-based scores, up to 15 points either way
			{:else if aiStage === 'landed'}
				{#if scoresStore.adjustedCount === 0}
					Refined by AI, which left every score as the rules set it
				{:else}
					Refined by AI · adjusted {scoresStore.adjustedCount} of {scoresStore.results.length}
				{/if}
				{#if model}<span class="model">{model}</span>{/if}
			{:else if scoresStore.retryAtMs !== null}
				The AI service is rate limited — the scores below still stand
			{:else if aiStage === 'skipped'}
				The AI service is unavailable — the scores below still stand
			{:else}
				Not run
			{/if}
		</span>

		<span class="state">
			{#if aiStage === 'running'}
				<span class="spin" aria-hidden="true"></span>
				<span class="clock">{seconds(elapsedMs)}</span>
			{:else if aiStage === 'landed'}
				{scoresStore.refineMs === null ? 'done' : seconds(scoresStore.refineMs)}
			{:else if aiStage === 'skipped'}
				skipped
			{:else}
				—
			{/if}
		</span>
	</li>
</ol>

<style>
	.ledger {
		display: flex;
		flex-direction: column;
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.stage {
		display: grid;
		grid-template-columns: auto auto 1fr auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--glass-bg);
		font-size: var(--text-sm);
	}

	.stage + .stage {
		border-top: 1px solid var(--glass-border);
	}

	/* Mono is the voice of the machine throughout this page: anything the engine produced or
	   measured is set in it, anything written for a person is not. */
	.index,
	.state,
	.clock,
	.model {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.index {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--glass-border);
		color: var(--color-text-tertiary);
	}

	.name {
		font-weight: 600;
	}

	.detail {
		color: var(--color-text-secondary);
	}

	.model {
		margin-left: var(--space-2);
		padding: 1px var(--space-2);
		border-radius: var(--radius-full);
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text-tertiary);
	}

	.state {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.done .index,
	.landed .index {
		border-color: var(--color-green);
		color: var(--color-green);
	}

	.done .state,
	.landed .state {
		color: var(--color-green);
	}

	.running .index {
		border-color: var(--color-cyan);
		color: var(--color-cyan);
	}

	.running .state {
		color: var(--color-cyan);
	}

	.skipped .index {
		border-color: var(--color-amber);
		color: var(--color-amber);
	}

	.skipped .state {
		color: var(--color-amber);
	}

	.spin {
		width: 0.75rem;
		height: 0.75rem;
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
			border-top-color: var(--color-cyan);
			opacity: 0.7;
		}
	}

	@media (max-width: 34rem) {
		.stage {
			grid-template-columns: auto 1fr auto;
		}

		.detail {
			grid-column: 2 / -1;
			order: 1;
		}
	}
</style>
