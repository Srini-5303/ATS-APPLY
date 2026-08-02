import type { RawLine } from '../types/parser';
import { normalizeText } from './text';

/**
 * DOCX extraction via mammoth (PRD §5.4).
 *
 * mammoth flattens layout, so there is no geometry here and therefore no column detection —
 * a genuine limitation, reported honestly rather than guessed at.
 *
 * Blank lines are captured *before* empty lines are filtered. PRD §5.4 step 5 filtered them
 * outright, which destroyed the `blankBefore` signal that §5.5's section heuristics depend on
 * (ADR 0001 §10).
 */

export interface DocxExtraction {
	lines: RawLine[];
	hasTables: boolean;
	hasImages: boolean;
}

export class DocxExtractionError extends Error {
	readonly code: 'CORRUPT' | 'EMPTY';

	constructor(code: 'CORRUPT' | 'EMPTY', message: string) {
		super(message);
		this.name = 'DocxExtractionError';
		this.code = code;
	}
}

/**
 * mammoth swaps its unzip implementation via package.json `browser`: the browser build reads
 * `options.arrayBuffer`, the Node build reads `options.path | buffer | file` and rejects with
 * "Could not find file in options" otherwise.
 *
 * Supplying both keys satisfies whichever build is loaded, which keeps this module free of
 * environment sniffing — the same code runs in the worker and in Vitest node.
 */
interface MammothInput {
	arrayBuffer: ArrayBuffer;
	buffer: ArrayBuffer;
}

interface MammothModule {
	extractRawText(input: MammothInput): Promise<{ value: string }>;
	convertToHtml(input: MammothInput): Promise<{ value: string }>;
}

export async function extractDocx(data: ArrayBuffer): Promise<DocxExtraction> {
	const mammoth = (await import('mammoth')) as unknown as MammothModule;

	let text: string;
	let html: string;

	try {
		// Text carries the content; HTML is only inspected for structural features that the
		// plain-text conversion discards.
		const input: MammothInput = { arrayBuffer: data, buffer: data };
		const [rawText, converted] = await Promise.all([
			mammoth.extractRawText(input),
			mammoth.convertToHtml(input)
		]);
		text = rawText.value;
		html = converted.value;
	} catch (err) {
		throw new DocxExtractionError(
			'CORRUPT',
			err instanceof Error && /zip|end of central directory/i.test(err.message)
				? 'That file is not a valid .docx. If it is an older .doc, re-save it as .docx.'
				: 'That Word document could not be read.'
		);
	}

	const normalized = normalizeText(text);
	const lines: RawLine[] = [];
	let previousWasBlank = true;

	for (const raw of normalized.split('\n')) {
		const trimmed = raw.trim();
		if (trimmed === '') {
			previousWasBlank = true;
			continue;
		}

		lines.push({
			text: trimmed,
			page: 1,
			y: 0,
			xStart: 0,
			xEnd: trimmed.length,
			blankBefore: previousWasBlank
		});
		previousWasBlank = false;
	}

	if (lines.length === 0) {
		throw new DocxExtractionError(
			'EMPTY',
			'That document appears to be empty. Note that text inside text boxes is not extractable.'
		);
	}

	return {
		lines,
		hasTables: /<table[\s>]/i.test(html),
		hasImages: /<img[\s>]/i.test(html)
	};
}
