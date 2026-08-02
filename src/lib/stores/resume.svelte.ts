import type { ParseIssue, ParsedResume, ParseResult } from '$engine/types/parser';
import { parsedResumeFromDocx, parsedResumeFromGeometry, parseResumeText } from '$engine/parser';
import { extractInWorker, ParseFailure } from '$engine/parser/worker/client';
import type { ParseKind } from '$engine/parser/worker/protocol';
import { log } from '$lib/log';

/** 10 MB, matching the uploader's documented limit (PRD §12.2). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type ResumeStatus = 'idle' | 'parsing' | 'ready' | 'error';

/**
 * Identifies the file from its leading bytes.
 *
 * The browser-reported MIME type is attacker-controlled and frequently wrong anyway, so the
 * extension and type are only hints — the magic number decides. `.docx` is a ZIP container,
 * hence `PK\x03\x04`.
 */
async function sniffKind(file: File): Promise<ParseKind | null> {
	const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());

	if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf';
	if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'docx';

	return null;
}

class ResumeStore {
	file = $state<File | null>(null);
	status = $state<ResumeStatus>('idle');
	parseResult = $state<ParseResult | null>(null);
	error = $state<ParseIssue | null>(null);

	get resume(): ParsedResume | null {
		return this.parseResult?.resume ?? null;
	}

	get isReady(): boolean {
		return this.status === 'ready' && this.resume !== null;
	}

	get warnings(): ParseIssue[] {
		return this.parseResult?.warnings ?? [];
	}

	reset(): void {
		this.file = null;
		this.status = 'idle';
		this.parseResult = null;
		this.error = null;
	}

	private fail(code: ParseIssue['code'], message: string, hint?: string): void {
		this.error = hint === undefined ? { code, message } : { code, message, hint };
		this.status = 'error';
		this.parseResult = null;
	}

	async loadFile(file: File): Promise<void> {
		this.reset();
		this.file = file;
		this.status = 'parsing';

		if (file.size > MAX_FILE_BYTES) {
			this.fail('TOO_LARGE', 'That file is larger than 10 MB.', 'Export a smaller PDF.');
			return;
		}

		const kind = await sniffKind(file);
		if (kind === null) {
			this.fail(
				'UNSUPPORTED_TYPE',
				'That does not look like a PDF or Word document.',
				'Upload a .pdf or .docx file, or paste your resume as text.'
			);
			return;
		}

		try {
			const result = await extractInWorker(kind, await file.arrayBuffer());

			this.parseResult =
				result.kind === 'pdf'
					? parsedResumeFromGeometry(result.geometry)
					: parsedResumeFromDocx(result.extraction);
			this.status = 'ready';

			log.info('resume parsed', {
				kind,
				pages: this.resume?.metadata.pageCount ?? 0,
				sections: this.resume?.sections.length ?? 0,
				skills: this.resume?.skills.length ?? 0
			});
		} catch (err) {
			if (err instanceof ParseFailure) {
				this.fail(err.code, err.message);
			} else {
				log.error('unexpected parse failure', {
					err: err instanceof Error ? err.message : String(err)
				});
				this.fail('CORRUPT', 'That PDF could not be read.');
			}
		}
	}

	loadText(text: string): void {
		this.reset();
		this.status = 'parsing';

		const result = parseResumeText(text);
		if (!result.success) {
			const first = result.errors[0];
			this.fail(first?.code ?? 'EMPTY', first?.message ?? 'No text was found.');
			return;
		}

		this.parseResult = result;
		this.status = 'ready';
	}
}

export const resumeStore = new ResumeStore();
