<script lang="ts">
	// Phase 0 spike: proves pdf.js resolves and runs inside our own module worker under both
	// `vite dev` and a production build. Deleted once the real uploader lands in Phase 1.
	import { extractPdfInWorker, ParseFailure } from '$engine/parser/worker/client';

	import { onMount } from 'svelte';

	// The file input does nothing until Svelte has hydrated and attached the handler. Expose
	// that explicitly: it drives the disabled state below (so a user cannot pick a file into
	// a void) and gives E2E a reliable signal instead of a sleep.
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});

	let status = $state<'idle' | 'parsing' | 'done' | 'error'>('idle');
	let result = $state<{ pages: number; items: number; width: number; sample: string } | null>(null);
	let errorText = $state('');

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		status = 'parsing';
		result = null;
		errorText = '';

		try {
			const geometry = await extractPdfInWorker(await file.arrayBuffer());
			result = {
				pages: geometry.pageCount,
				items: geometry.items.length,
				width: geometry.pageWidth,
				sample: geometry.items
					.slice(0, 12)
					.map((i) => i.str)
					.join(' ')
			};
			status = 'done';
		} catch (err) {
			errorText = err instanceof ParseFailure ? `${err.code}: ${err.message}` : String(err);
			status = 'error';
		}
	}
</script>

<div class="spike">
	<h1>pdf.js worker spike</h1>
	<p>Upload a PDF. Parsing runs in a module worker; the file never leaves the browser.</p>

	<input
		type="file"
		accept="application/pdf"
		onchange={onFile}
		disabled={!hydrated}
		data-ready={hydrated}
		data-testid="spike-input"
	/>

	{#if status === 'parsing'}
		<p data-testid="spike-status">Parsing…</p>
	{:else if status === 'done' && result}
		<dl data-testid="spike-result">
			<dt>Pages</dt>
			<dd data-testid="spike-pages">{result.pages}</dd>
			<dt>Text items</dt>
			<dd data-testid="spike-items">{result.items}</dd>
			<dt>Page width</dt>
			<dd>{result.width}</dd>
			<dt>First items</dt>
			<dd class="sample">{result.sample}</dd>
		</dl>
	{:else if status === 'error'}
		<p class="err" data-testid="spike-error">{errorText}</p>
	{/if}
</div>

<style>
	.spike {
		max-width: 44rem;
		margin-inline: auto;
		padding: var(--space-12) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-4);
		padding: var(--space-4);
		background: var(--glass-bg);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-md);
	}

	dt {
		color: var(--color-text-tertiary);
	}

	dd {
		margin: 0;
		font-family: var(--font-mono);
	}

	.sample {
		font-size: var(--text-sm);
		color: var(--color-text-secondary);
	}

	.err {
		color: var(--color-red);
		font-family: var(--font-mono);
	}
</style>
