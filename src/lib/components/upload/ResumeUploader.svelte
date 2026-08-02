<script lang="ts">
	import { onMount } from 'svelte';
	import { resumeStore } from '$stores/resume.svelte';

	let { onparsed }: { onparsed?: () => void } = $props();

	let dragging = $state(false);

	// Nothing here works until Svelte has attached the handlers. Surfacing that prevents a
	// user dropping a file into a dead zone during hydration.
	let ready = $state(false);
	onMount(() => {
		ready = true;
	});

	async function accept(file: File | undefined) {
		if (!file) return;
		await resumeStore.loadFile(file);
		if (resumeStore.isReady) onparsed?.();
	}

	async function onChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		await accept(input.files?.[0]);
		// Allow re-selecting the same file after a reset.
		input.value = '';
	}

	async function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		await accept(event.dataTransfer?.files[0]);
	}
</script>

<!--
	A <label> wrapping a visually-hidden <input type="file"> rather than a div with
	role="button".

	The earlier version nested the input inside an element that was itself a button, which axe
	flags as `nested-interactive` — and it left the input with no accessible name. This pattern
	needs no custom key handling either: the input is the real control, so Enter and Space work
	natively and focus lands somewhere meaningful.
-->
<div
	class="dropzone"
	class:dragging
	class:busy={resumeStore.status === 'parsing'}
	data-ready={ready}
	data-testid="uploader"
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => {
		dragging = false;
	}}
	ondrop={onDrop}
	role="presentation"
>
	<label class="target">
		<input
			type="file"
			accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
			class="visually-hidden"
			disabled={!ready}
			onchange={onChange}
			data-testid="file-input"
		/>

		{#if resumeStore.status === 'parsing'}
			<span class="headline" data-testid="upload-parsing">Reading your resume…</span>
			<span class="sub">Parsing happens in your browser. The file is never uploaded.</span>
		{:else if resumeStore.isReady}
			<span class="headline ok" data-testid="upload-done">
				{resumeStore.file?.name ?? 'Resume'} parsed
			</span>
			<span class="sub">
				{resumeStore.resume?.metadata.wordCount ?? 0} words ·
				{resumeStore.resume?.metadata.pageCount ?? 0} page(s) ·
				{resumeStore.resume?.sections.length ?? 0} sections ·
				{resumeStore.resume?.skills.length ?? 0} skills
			</span>
		{:else}
			<span class="headline">Upload your resume</span>
			<span class="sub">
				Drop a PDF or Word file here, or click to choose. Up to 10 MB, parsed in your browser.
			</span>
		{/if}
	</label>
</div>

{#if resumeStore.error}
	<p class="error" role="alert" data-testid="upload-error">
		{resumeStore.error.message}
		{#if resumeStore.error.hint}<span class="hint">{resumeStore.error.hint}</span>{/if}
	</p>
{/if}

<style>
	.dropzone {
		background: var(--glass-bg);
		border: 1.5px dashed var(--glass-border);
		border-radius: var(--radius-lg);
		transition:
			border-color var(--duration-base) var(--ease-out),
			background var(--duration-base) var(--ease-out);
	}

	.dropzone:hover,
	.dragging {
		background: var(--glass-bg-hover);
		border-color: var(--color-cyan);
	}

	/* The label is the click target, so it fills the zone. */
	.target {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 11rem;
		padding: var(--space-8);
		text-align: center;
		cursor: pointer;
	}

	.busy .target {
		cursor: progress;
	}

	/* Focus lives on the hidden input, so the ring has to be drawn on its container. */
	.dropzone:has(input:focus-visible) {
		outline: 2px solid var(--color-cyan);
		outline-offset: 2px;
	}

	.headline {
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.ok {
		color: var(--color-green);
	}

	.sub {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.error {
		margin-top: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: color-mix(in srgb, var(--color-red) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-red) 35%, transparent);
		border-radius: var(--radius-md);
		color: var(--color-red);
		font-size: var(--text-sm);
	}

	.hint {
		display: block;
		margin-top: var(--space-1);
		color: var(--color-text-secondary);
	}
</style>
