import { DocxExtractionError, extractDocx, type DocxExtraction } from '../docx';
import { extractPdfGeometry, PdfExtractionError, type PdfGeometry } from '../pdf';
import type { ParseErrorCode } from '../../types/parser';
import type { ParseKind, ParseRequest, ParseResponse } from './protocol';

/**
 * Main-thread side of the parse worker.
 *
 * Falls back to parsing inline when workers are unavailable. That path matters for
 * correctness, not just convenience: it keeps the module usable under SSR and in test
 * environments that have no Worker constructor.
 */

const WORKER_TIMEOUT_MS = 30_000;

export class ParseFailure extends Error {
	readonly code: ParseErrorCode;

	constructor(code: ParseErrorCode, message: string) {
		super(message);
		this.name = 'ParseFailure';
		this.code = code;
	}
}

export type ExtractionResult =
	{ kind: 'pdf'; geometry: PdfGeometry } | { kind: 'docx'; extraction: DocxExtraction };

function workersSupported(): boolean {
	return typeof Worker !== 'undefined' && typeof window !== 'undefined';
}

function toFailure(err: unknown): ParseFailure {
	if (err instanceof PdfExtractionError || err instanceof DocxExtractionError) {
		return new ParseFailure(err.code, err.message);
	}
	return new ParseFailure('CORRUPT', err instanceof Error ? err.message : 'Parse failed');
}

async function parseInline(kind: ParseKind, buffer: ArrayBuffer): Promise<ExtractionResult> {
	try {
		if (kind === 'pdf') return { kind: 'pdf', geometry: await extractPdfGeometry(buffer) };
		return { kind: 'docx', extraction: await extractDocx(buffer) };
	} catch (err) {
		throw toFailure(err);
	}
}

export async function extractInWorker(
	kind: ParseKind,
	buffer: ArrayBuffer
): Promise<ExtractionResult> {
	if (!workersSupported()) return parseInline(kind, buffer);

	let worker: Worker;
	try {
		worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
	} catch {
		// Some environments expose Worker but reject module workers; inline is still correct.
		return parseInline(kind, buffer);
	}

	const id = crypto.randomUUID();

	return new Promise<ExtractionResult>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new ParseFailure('WORKER_TIMEOUT', 'Parsing took too long and was cancelled.'));
		}, WORKER_TIMEOUT_MS);

		function cleanup(): void {
			clearTimeout(timer);
			worker.terminate();
		}

		worker.addEventListener('message', (event: MessageEvent<ParseResponse>) => {
			const data = event.data;
			if (data.id !== id) return;

			cleanup();

			if (!data.ok) {
				reject(new ParseFailure(data.code, data.message));
				return;
			}

			resolve(
				data.kind === 'pdf'
					? { kind: 'pdf', geometry: data.geometry }
					: { kind: 'docx', extraction: data.extraction }
			);
		});

		worker.addEventListener('error', (event) => {
			cleanup();
			reject(new ParseFailure('CORRUPT', event.message || 'Worker failed'));
		});

		const request: ParseRequest = { id, kind, buffer };
		worker.postMessage(request, [buffer]);
	});
}

/** Kept for the Phase 0 spike route, which only ever handles PDFs. */
export async function extractPdfInWorker(buffer: ArrayBuffer): Promise<PdfGeometry> {
	const result = await extractInWorker('pdf', buffer);
	if (result.kind !== 'pdf') throw new ParseFailure('CORRUPT', 'Unexpected extraction kind');
	return result.geometry;
}
