<script lang="ts">
	import JobDescriptionInput from '$components/upload/JobDescriptionInput.svelte';
	import ResumeUploader from '$components/upload/ResumeUploader.svelte';
	import ScoreDashboard from '$components/scoring/ScoreDashboard.svelte';
	import { resumeStore } from '$stores/resume.svelte';
	import { scoresStore } from '$stores/scores.svelte';

	type Phase = 'upload' | 'parsed' | 'results';

	// An explicit phase union rather than a pile of booleans — the scanner page is where
	// state combinations multiply fastest.
	const phase = $derived<Phase>(
		scoresStore.hasResults ? 'results' : resumeStore.isReady ? 'parsed' : 'upload'
	);

	const STEPS = ['Upload', 'Parse', 'Score', 'Results'] as const;
	const stepIndex = $derived(
		phase === 'results' ? 3 : phase === 'parsed' ? 2 : resumeStore.status === 'parsing' ? 1 : 0
	);

	let pasted = $state('');

	function runScore() {
		const resume = resumeStore.resume;
		if (!resume) return;

		// Deterministic scores render immediately; refinement adjusts them in place when it
		// arrives, so there is never a spinner standing in for results (ADR 0001 §2).
		scoresStore.score(resume);
		void scoresStore.refine(resume);
	}

	function startOver() {
		resumeStore.reset();
		scoresStore.reset();
		pasted = '';
	}

	function usePastedText() {
		if (pasted.trim() === '') return;
		resumeStore.loadText(pasted);
	}
</script>

<svelte:head>
	<title>Scan your resume — ATS Screener</title>
	<meta
		name="description"
		content="See how Workday, Taleo, iCIMS, Greenhouse, Lever and SuccessFactors each read your resume."
	/>
</svelte:head>

<div class="scanner">
	<header class="intro">
		<h1>Scan your resume</h1>
		<p>Six enterprise platforms, six different verdicts. Your file stays in your browser.</p>
	</header>

	<ol class="steps" aria-label="Progress">
		{#each STEPS as step, i (step)}
			<li class:done={i < stepIndex} class:current={i === stepIndex}>
				<span class="dot">{i + 1}</span>
				<span>{step}</span>
			</li>
		{/each}
	</ol>

	{#if phase !== 'results'}
		<ResumeUploader onparsed={runScore} />

		<details class="paste">
			<summary>Or paste your resume as text</summary>
			<textarea
				bind:value={pasted}
				rows="10"
				placeholder="Paste the full text of your resume…"
				data-testid="paste-input"
			></textarea>
			<button type="button" onclick={usePastedText} disabled={pasted.trim() === ''}>
				Use this text
			</button>
		</details>
	{/if}

	<!-- Rendered once, outside the phase branches: a second instance further down would be a
	     different component and would drop the user's pasted posting on every transition. -->
	<JobDescriptionInput />

	{#if resumeStore.warnings.length > 0 && phase !== 'upload'}
		<ul class="warnings" data-testid="warnings">
			{#each resumeStore.warnings as warning (warning.code)}
				<li>
					<strong>{warning.message}</strong>
					{#if warning.hint}<span>{warning.hint}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if phase === 'parsed'}
		<div class="actions">
			<button type="button" class="primary" onclick={runScore} data-testid="scan-button">
				Score my resume
			</button>
			<button type="button" onclick={startOver}>Start over</button>
		</div>
	{/if}

	{#if phase === 'results'}
		<ScoreDashboard />

		<div class="actions">
			<button type="button" class="primary" onclick={runScore} data-testid="rescan">
				{scoresStore.jobDescription.trim() === '' ? 'Re-score' : 'Re-score against this job'}
			</button>
			<button type="button" onclick={startOver} data-testid="start-over">Scan another</button>
		</div>
	{/if}
</div>

<style>
	.scanner {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		max-width: 68rem;
		margin-inline: auto;
		padding: var(--space-12) var(--space-6) var(--space-24);
	}

	.intro h1 {
		font-size: var(--text-3xl);
	}

	.intro p {
		color: var(--color-text-secondary);
	}

	.steps {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
		list-style: none;
		padding: 0;
		font-size: var(--text-sm);
		color: var(--color-text-tertiary);
	}

	.steps li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.dot {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--glass-border);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
	}

	.steps .current {
		color: var(--color-text-primary);
	}

	.steps .current .dot {
		border-color: var(--color-cyan);
		color: var(--color-cyan);
	}

	.steps .done .dot {
		background: var(--color-green);
		border-color: var(--color-green);
		color: #06060f;
	}

	.paste summary {
		cursor: pointer;
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.paste textarea {
		width: 100%;
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		resize: vertical;
	}

	.warnings {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		padding: var(--space-4);
		background: color-mix(in srgb, var(--color-amber) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-amber) 25%, transparent);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}

	.warnings span {
		display: block;
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	button {
		padding: var(--space-3) var(--space-6);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: background var(--duration-base) var(--ease-out);
	}

	button:hover:not(:disabled) {
		background: var(--glass-bg-hover);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.primary {
		background: var(--gradient-primary);
		border-color: transparent;
		color: #06060f;
		font-weight: 600;
	}
</style>
