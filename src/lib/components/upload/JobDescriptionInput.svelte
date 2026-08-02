<script lang="ts">
	import { onMount } from 'svelte';
	import { parseJobDescription, type ParsedJobDescription } from '$engine/job-parser';
	import { canonicalize } from '$engine/nlp/synonyms';
	import { jdLibraryStore } from '$stores/jd-library.svelte';
	import { resumeStore } from '$stores/resume.svelte';
	import { scoresStore } from '$stores/scores.svelte';

	/** Parsing on every keystroke is wasted work on a paste of several hundred words. */
	const DEBOUNCE_MS = 400;

	let expanded = $state(false);
	let text = $state(scoresStore.jobDescription);
	let parsed = $state<ParsedJobDescription | null>(null);
	let showLibrary = $state(false);
	let labelDraft = $state('');
	let savePrompt = $state(false);

	onMount(() => {
		jdLibraryStore.load();
		if (text.trim() !== '') parsed = parseJobDescription(text);
	});

	let timer: ReturnType<typeof setTimeout> | undefined;

	function onInput() {
		scoresStore.jobDescription = text;

		clearTimeout(timer);
		timer = setTimeout(() => {
			parsed = text.trim() === '' ? null : parseJobDescription(text);
		}, DEBOUNCE_MS);
	}

	/**
	 * Which of the posting's requirements the resume already covers.
	 *
	 * Uses canonical forms so "k8s" on the resume satisfies "Kubernetes" in the posting —
	 * the same folding the scorer applies, so the preview cannot disagree with the result.
	 */
	const coverage = $derived.by(() => {
		if (!parsed) return null;

		const resumeTerms = new Set(
			[
				...(resumeStore.resume?.skills ?? []),
				...(resumeStore.resume?.rawText.toLowerCase().split(/[\s,;|]+/) ?? [])
			].map((t) => canonicalize(t))
		);

		const all = [...parsed.requiredSkills, ...parsed.preferredSkills];
		const present = all.filter((s) => resumeTerms.has(s));
		const absent = all.filter((s) => !resumeTerms.has(s));

		return { present, absent, total: all.length };
	});

	function loadEntry(content: string) {
		text = content;
		showLibrary = false;
		onInput();
	}

	function confirmSave() {
		jdLibraryStore.save(labelDraft, text);
		labelDraft = '';
		savePrompt = false;
	}

	function clearJd() {
		text = '';
		parsed = null;
		scoresStore.jobDescription = '';
	}
</script>

<section class="jd">
	<button
		type="button"
		class="toggle"
		aria-expanded={expanded}
		onclick={() => {
			expanded = !expanded;
		}}
		data-testid="jd-toggle"
	>
		<span>{expanded ? '−' : '+'}</span>
		Target a specific job {text.trim() === '' ? '(optional)' : '· added'}
	</button>

	{#if expanded}
		<div class="body">
			<p class="hint">
				Paste the posting. Scores switch from general readiness to how well you match this specific
				role.
			</p>

			<textarea
				bind:value={text}
				oninput={onInput}
				rows="8"
				placeholder="Paste the full job description…"
				aria-label="Job description"
				data-testid="jd-input"
			></textarea>

			<div class="actions">
				{#if jdLibraryStore.entries.length > 0}
					<button
						type="button"
						onclick={() => {
							showLibrary = !showLibrary;
						}}
					>
						Saved ({jdLibraryStore.entries.length})
					</button>
				{/if}
				<button
					type="button"
					disabled={text.trim() === ''}
					onclick={() => {
						savePrompt = true;
					}}
					data-testid="jd-save"
				>
					Save this one
				</button>
				<button type="button" disabled={text.trim() === ''} onclick={clearJd}>Clear</button>
			</div>

			{#if savePrompt}
				<div class="save-row">
					<input
						bind:value={labelDraft}
						placeholder="Name it, e.g. Stripe — Senior Backend"
						aria-label="Label for this job description"
						data-testid="jd-label"
					/>
					<button type="button" onclick={confirmSave} disabled={labelDraft.trim() === ''}>
						Save
					</button>
					<button
						type="button"
						onclick={() => {
							savePrompt = false;
						}}>Cancel</button
					>
				</div>
			{/if}

			{#if showLibrary}
				<ul class="library" data-testid="jd-library">
					{#each jdLibraryStore.entries as entry (entry.id)}
						<li>
							<button
								type="button"
								class="link"
								onclick={() => {
									loadEntry(entry.content);
								}}
							>
								{entry.label}
							</button>
							<button
								type="button"
								class="link danger"
								aria-label="Delete {entry.label}"
								onclick={() => {
									jdLibraryStore.remove(entry.id);
								}}
							>
								Delete
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if parsed}
				<div class="preview" data-testid="jd-preview">
					<dl>
						{#if parsed.experienceLevel}
							<div>
								<dt>Level</dt>
								<dd>{parsed.experienceLevel}</dd>
							</div>
						{/if}
						{#if parsed.educationRequirement}
							<div>
								<dt>Education</dt>
								<dd>{parsed.educationRequirement}</dd>
							</div>
						{/if}
						{#if parsed.industry}
							<div>
								<dt>Field</dt>
								<dd>{parsed.industry}</dd>
							</div>
						{/if}
					</dl>

					{#if coverage && coverage.total > 0 && !resumeStore.isReady}
						<!-- Without a resume there is nothing to compare against; saying "0 of 12
						     covered" would read as a failing result rather than a missing input. -->
						<p class="coverage">
							{coverage.total} requirements found. Upload your resume to see which you already cover.
						</p>
						<ul class="chips">
							{#each coverage.absent as skill (skill)}
								<li class="missing">{skill}</li>
							{/each}
						</ul>
					{:else if coverage && coverage.total > 0}
						<p class="coverage">
							Your resume covers
							<strong data-testid="jd-covered">{coverage.present.length}</strong>
							of {coverage.total} requirements found.
						</p>

						<ul class="chips">
							{#each coverage.present as skill (skill)}
								<li class="have">{skill}</li>
							{/each}
							{#each coverage.absent as skill (skill)}
								<li class="missing">{skill}</li>
							{/each}
						</ul>
					{:else}
						<p class="coverage">
							No specific skills were recognised in this posting, so scoring will stay in general
							mode.
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</section>

<style>
	.jd {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		align-self: flex-start;
		padding: var(--space-2) var(--space-4);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.toggle:hover {
		background: var(--glass-bg-hover);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
	}

	.hint {
		font-size: var(--text-sm);
		color: var(--color-text-tertiary);
	}

	textarea,
	input {
		width: 100%;
		padding: var(--space-3);
		background: var(--color-bg-secondary);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
		resize: vertical;
	}

	.actions,
	.save-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.save-row input {
		flex: 1 1 16rem;
		width: auto;
	}

	.actions button,
	.save-row button {
		padding: var(--space-2) var(--space-4);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		font-size: var(--text-sm);
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.library {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}

	.library li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--text-sm);
	}

	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-cyan);
		cursor: pointer;
		text-align: left;
	}

	.danger {
		color: var(--color-red);
	}

	.preview dl {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-bottom: var(--space-3);
	}

	.preview dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.preview dd {
		margin: 0;
		font-size: var(--text-sm);
	}

	.coverage {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
		margin-bottom: var(--space-2);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}

	.chips li {
		padding: 2px var(--space-2);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-family: var(--font-mono);
	}

	.have {
		background: color-mix(in srgb, var(--color-green) 18%, transparent);
		color: var(--color-green);
	}

	.missing {
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text-tertiary);
	}
</style>
