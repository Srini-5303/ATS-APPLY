<script lang="ts">
	import { SECTION_TYPES, type ParsedResume, type SectionType } from '$engine/types/parser';

	/**
	 * What the parser actually extracted.
	 *
	 * This is the product's thesis made literal: an ATS scores the fields it managed to read,
	 * not the document you designed. Anything absent here is absent everywhere downstream, and
	 * until now the user had no way to find that out except by distrusting a low score.
	 *
	 * Missing sections are rendered rather than omitted — an empty slot is the finding.
	 */

	let { resume, open = false }: { resume: ParsedResume; open?: boolean } = $props();

	/** Sections a resume is normally expected to carry; the rest are bonuses, not gaps. */
	const EXPECTED: readonly SectionType[] = ['experience', 'education', 'skills'];

	const found = $derived(new Set(resume.sections.map((s) => s.type)));

	// Ordered by SECTION_TYPES rather than document order so the row reads the same way every
	// time. `unknown` is surfaced separately — it means something different.
	const detected = $derived(
		SECTION_TYPES.filter((t) => t !== 'unknown' && found.has(t)).map((type) => ({
			type,
			heading: resume.sections.find((s) => s.type === type)?.heading ?? null
		}))
	);

	const missing = $derived(EXPECTED.filter((t) => !found.has(t)));
	const unknownCount = $derived(resume.sections.filter((s) => s.type === 'unknown').length);

	const BULLET = /^\s*[-–—•·▪*]/;
	const bulletCount = $derived(
		resume.sections.reduce(
			(sum, s) => sum + s.content.filter((line) => BULLET.test(line.text)).length,
			0
		)
	);

	const layout = $derived(
		[
			resume.metadata.hasMultipleColumns ? 'multiple columns' : 'single column',
			resume.metadata.hasTables ? 'tables present' : null,
			resume.metadata.hasImages ? 'images present' : null
		].filter((x): x is string => x !== null)
	);

	/** Layout facts that cost points on strict parsers, so they read as findings not trivia. */
	const layoutRisky = $derived(
		resume.metadata.hasMultipleColumns || resume.metadata.hasTables || resume.metadata.hasImages
	);

	let showAllSkills = $state(false);
	const SKILL_PREVIEW = 24;
	const visibleSkills = $derived(
		showAllSkills ? resume.skills : resume.skills.slice(0, SKILL_PREVIEW)
	);

	/**
	 * Whether the parse turned up anything the reader should act on.
	 *
	 * Uploading a file scores it immediately, so the pre-scoring step where you would check the
	 * parse never appears on that path — the panel would sit collapsed and go unread. It opens
	 * itself when it has a finding instead, and stays shut when the answer is "everything came
	 * through", which is not worth the vertical space above the scores.
	 */
	const hasFindings = $derived(missing.length > 0 || unknownCount > 0 || layoutRisky);
</script>

<details
	class="panel"
	open={open || hasFindings}
	data-testid="extraction-panel"
	data-findings={hasFindings}
>
	<summary>
		<!-- `display: flex` on a summary removes the native disclosure triangle in Chrome, which
		     left the collapsed panel looking like an inert bar. Drawn explicitly instead. -->
		<svg class="chevron" viewBox="0 0 12 12" aria-hidden="true">
			<path d="M4 2.5 L8 6 L4 9.5" fill="none" stroke="currentColor" stroke-width="1.5" />
		</svg>
		<span class="title">What the parser saw</span>
		<span class="hint">Anything missing here is invisible to every ATS</span>
	</summary>

	<div class="body">
		<dl class="counts" data-testid="extraction-counts">
			<div>
				<dt>Words</dt>
				<dd>{resume.metadata.wordCount}</dd>
			</div>
			<div>
				<dt>Lines</dt>
				<dd>{resume.metadata.lineCount}</dd>
			</div>
			<div>
				<dt>Pages</dt>
				<dd>{resume.metadata.pageCount}</dd>
			</div>
			<div>
				<dt>Bullets</dt>
				<dd>{bulletCount}</dd>
			</div>
			<div>
				<dt>Roles</dt>
				<dd>{resume.experience.length}</dd>
			</div>
			<div>
				<dt>Degrees</dt>
				<dd>{resume.education.length}</dd>
			</div>
			<div>
				<dt>Projects</dt>
				<dd>{resume.projects.length}</dd>
			</div>
			<div>
				<dt>Skills</dt>
				<dd>{resume.skills.length}</dd>
			</div>
		</dl>

		<div class="field">
			<h3>Sections</h3>
			<ul class="chips" data-testid="extraction-sections">
				{#each detected as section (section.type)}
					<li class="chip found" title={section.heading ?? 'Inferred — no heading found'}>
						{section.type}{#if section.heading === null}<span class="mark">inferred</span>{/if}
					</li>
				{/each}
				{#each missing as type (type)}
					<li class="chip absent">{type}</li>
				{/each}
			</ul>
			{#if missing.length > 0}
				<p class="note warn">
					{missing.length === 1 ? 'This section was' : 'These sections were'} not found. Add a plain heading
					such as “{missing[0] === 'experience'
						? 'Experience'
						: missing[0] === 'education'
							? 'Education'
							: 'Skills'}” so the parser can file the content under it.
				</p>
			{/if}
			{#if unknownCount > 0}
				<p class="note">
					{unknownCount}
					{unknownCount === 1 ? 'heading was' : 'headings were'} not recognised. Workday files these as
					unclassified and may drop what follows them.
				</p>
			{/if}
		</div>

		<div class="field">
			<h3>Contact</h3>
			<ul class="chips">
				{#each [['name', resume.contact.name], ['email', resume.contact.email], ['phone', resume.contact.phone], ['location', resume.contact.location]] as [label, value] (label)}
					<li class="chip {value ? 'found' : 'absent'}">{label}</li>
				{/each}
			</ul>
		</div>

		{#if resume.skills.length > 0}
			<div class="field">
				<h3>Skills read from the document</h3>
				<ul class="chips" data-testid="extraction-skills">
					{#each visibleSkills as skill (skill)}
						<li class="chip found">{skill}</li>
					{/each}
				</ul>
				{#if resume.skills.length > SKILL_PREVIEW}
					<button type="button" class="more" onclick={() => (showAllSkills = !showAllSkills)}>
						{showAllSkills ? 'Show fewer' : `Show all ${String(resume.skills.length)}`}
					</button>
				{/if}
			</div>
		{/if}

		<div class="field">
			<h3>Layout</h3>
			<p class="note" class:warn={layoutRisky}>
				{resume.metadata.fileType.toUpperCase()} · {layout.join(' · ')}
				{#if layoutRisky}
					— strict parsers read columns straight across the page and flatten table cells.
				{/if}
			</p>
		</div>
	</div>
</details>

<style>
	.panel {
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
	}

	summary {
		display: flex;
		flex-wrap: wrap;
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
		flex-shrink: 0;
		color: var(--color-text-tertiary);
		transition: transform var(--duration-base) var(--ease-out);
	}

	.panel[open] .chevron {
		transform: rotate(90deg);
	}

	.title {
		font-weight: 600;
	}

	.hint {
		font-size: var(--text-sm);
		color: var(--color-text-tertiary);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: 0 var(--space-5) var(--space-5);
	}

	/* A readout, not a stat grid: the numbers are what the engine measured, so they are set in
	   mono and aligned in a column the eye can run down. */
	.counts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
		gap: var(--space-4);
		margin: 0;
		padding: var(--space-4) 0;
		border-block: 1px solid var(--glass-border);
	}

	.counts dt {
		font-size: var(--text-xs);
		color: var(--color-text-tertiary);
	}

	.counts dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-xl);
		font-variant-numeric: tabular-nums;
	}

	.field h3 {
		margin-bottom: var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-tertiary);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}

	.chip {
		padding: 2px var(--space-3);
		border-radius: var(--radius-full);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.chip.found {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--glass-border);
		color: var(--color-text-secondary);
	}

	/* An absent field is the finding, so it is drawn as an empty slot rather than left out. */
	.chip.absent {
		border: 1px dashed color-mix(in srgb, var(--color-amber) 45%, transparent);
		color: color-mix(in srgb, var(--color-amber) 80%, white 20%);
		text-decoration: line-through;
		text-decoration-color: color-mix(in srgb, var(--color-amber) 45%, transparent);
	}

	.mark {
		margin-left: var(--space-2);
		color: var(--color-text-tertiary);
	}

	.note {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.note.warn {
		color: color-mix(in srgb, var(--color-amber) 80%, white 20%);
	}

	.more {
		margin-top: var(--space-3);
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.more:hover {
		background: var(--glass-bg-hover);
	}
</style>
