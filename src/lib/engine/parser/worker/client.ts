import { extractPdfGeometry, PdfExtractionError, type PdfGeometry } from '../pdf';
import type { ParseErrorCode } from '../../types/parser';
import type { ParseRequest, ParseResponse } from './protocol';

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

function workersSupported(): boolean {
	return typeof Worker !== 'undefined' && typeof window !== 'undefined';
}

function createWorker(): Worker {
	return new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
}

async function parseInline(buffer: ArrayBuffer): Promise<PdfGeometry> {
	try {
		return await extractPdfGeometry(buffer);
	} catch (err) {
		if (err instanceof PdfExtractionError) throw new ParseFailure(err.code, err.message);
		throw new ParseFailure('CORRUPT', err instanceof Error ? err.message : 'Parse failed');
	}
}

export async function extractPdfInWorker(buffer: ArrayBuffer): Promise<PdfGeometry> {
	if (!workersSupported()) return parseInline(buffer);

	let worker: Worker;
	try {
		worker = createWorker();
	} catch {
		// Some environments expose Worker but reject module workers; inline is still correct.
		return parseInline(buffer);
	}

	const id = crypto.randomUUID();

	return new Promise<PdfGeometry>((resolve, reject) => {
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
			if (data.ok) resolve(data.geometry);
			else reject(new ParseFailure(data.code, data.message));
		});

		worker.addEventListener('error', (event) => {
			cleanup();
			reject(new ParseFailure('CORRUPT', event.message || 'Worker failed'));
		});

		const request: ParseRequest = { id, kind: 'pdf', buffer };
		worker.postMessage(request, [buffer]);
	});
}
