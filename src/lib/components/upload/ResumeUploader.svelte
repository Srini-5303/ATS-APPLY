<script lang="ts">
	import { onMount } from 'svelte';
	import { resumeStore } from '$stores/resume.svelte';

	let { onparsed }: { onparsed?: () => void } = $props();

	let fileInput: HTMLInputElement | null = $state(null);
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

	function openPicker() {
		fileInput?.click();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openPicker();
		}
	}
</script>

<div
	class="dropzone"
	class:dragging
	class:busy={resumeStore.status === 'parsing'}
	role="button"
	tabindex="0"
	aria-label="Upload your resume as a PDF or Word document"
	aria-disabled={!ready}
	data-ready={ready}
	data-testid="uploader"
	onclick={openPicker}
	onkeydown={onKeydown}
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
>
	<input
		bind:this={fileInput}
		type="file"
		accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
		class="visually-hidden"
		disabled={!ready}
		onchange={onChange}
		data-testid="file-input"
		tabindex="-1"
	/>

	{#if resumeStore.status === 'parsing'}
		<p class="headline" data-testid="upload-parsing">Reading your resume…</p>
		<p class="sub">Parsing happens in your browser. The file is never uploaded.</p>
	{:else if resumeStore.isReady}
		<p class="headline ok" data-testid="upload-done">
			{resumeStore.file?.name ?? 'Resume'} parsed
		</p>
		<p class="sub">
			{resumeStore.resume?.metadata.wordCount ?? 0} words ·
			{resumeStore.resume?.metadata.pageCount ?? 0} page(s) ·
			{resumeStore.resume?.sections.length ?? 0} sections ·
			{resumeStore.resume?.skills.length ?? 0} skills
		</p>
	{:else}
		<p class="headline">Drop a PDF or Word file here, or click to choose</p>
		<p class="sub">Up to 10 MB. Parsed in your browser — the file never leaves your device.</p>
	{/if}
</div>

{#if resumeStore.error}
	<p class="error" role="alert" data-testid="upload-error">
		{resumeStore.error.message}
		{#if resumeStore.error.hint}<span class="hint">{resumeStore.error.hint}</span>{/if}
	</p>
{/if}

<style>
	.dropzone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 11rem;
		padding: var(--space-8);
		text-align: center;
		cursor: pointer;
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

	.busy {
		cursor: progress;
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
		color: var(--color-text-tertiary);
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
