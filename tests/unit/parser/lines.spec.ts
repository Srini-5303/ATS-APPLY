import { describe, expect, it } from 'vitest';
import { medianItemHeight, reconstructLines } from '$engine/parser/layout/lines';
import type { PositionedItem } from '$engine/types/parser';

/**
 * Synthetic geometry, no PDF round-trip.
 *
 * This is why `reconstructLines` takes `PositionedItem[]` rather than a pdf.js page: a
 * boundary case is a handful of literal objects and runs in microseconds, so thresholds can
 * actually be pinned at their edges (ADR 0001 §11).
 */
function item(partial: Partial<PositionedItem> & { str: string }): PositionedItem {
	return {
		x: 72,
		y: 700,
		width: partial.str.length * 5,
		height: 10,
		page: 1,
		...partial
	};
}

const PAGE_WIDTH = 612;

describe('reconstructLines', () => {
	it('returns nothing for no input', () => {
		expect(reconstructLines([], PAGE_WIDTH)).toEqual([]);
	});

	it('groups items sharing a baseline into one line, ordered left to right', () => {
		const lines = reconstructLines(
			[item({ str: 'World', x: 150, y: 700 }), item({ str: 'Hello', x: 72, y: 700 })],
			PAGE_WIDTH
		);

		expect(lines).toHaveLength(1);
		expect(lines[0]?.text).toBe('Hello World');
	});

	it('reads down the page, since PDF y increases upward', () => {
		const lines = reconstructLines(
			[
				item({ str: 'second', y: 686 }),
				item({ str: 'first', y: 700 }),
				item({ str: 'third', y: 672 })
			],
			PAGE_WIDTH
		);

		expect(lines.map((l) => l.text)).toEqual(['first', 'second', 'third']);
	});

	it('tolerates sub-pixel baseline jitter within a line', () => {
		// Superscripts and mixed font sizes shift the baseline slightly; these belong together.
		const lines = reconstructLines(
			[item({ str: 'a', x: 72, y: 700 }), item({ str: 'b', x: 90, y: 700.9 })],
			PAGE_WIDTH
		);

		expect(lines).toHaveLength(1);
	});

	it('scales the y-tolerance to the font size', () => {
		// PRD §5.3's flat 3px tolerance merges these 8pt lines set on 9.6pt leading into one.
		const small = [
			item({ str: 'line one', y: 700, height: 8 }),
			item({ str: 'line two', y: 690.4, height: 8 })
		];

		expect(reconstructLines(small, PAGE_WIDTH)).toHaveLength(2);
	});

	it('separates widely spaced items so right-aligned dates stay distinct', () => {
		// `Acme Corp .......... Jan 2023` must not collapse into `Acme CorpJan 2023`.
		const lines = reconstructLines(
			[item({ str: 'Acme Corp', x: 72, y: 700 }), item({ str: 'Jan 2023', x: 470, y: 700 })],
			PAGE_WIDTH
		);

		expect(lines[0]?.text).toBe('Acme Corp Jan 2023');
	});

	it('marks a blank line when the vertical gap exceeds the usual leading', () => {
		// The signal PRD §5.5's heuristics need and the original pipeline destroyed
		// (ADR 0001 §10).
		const lines = reconstructLines(
			[
				item({ str: 'para one a', y: 700 }),
				item({ str: 'para one b', y: 686 }),
				item({ str: 'para two', y: 650 })
			],
			PAGE_WIDTH
		);

		expect(lines[0]?.blankBefore).toBe(true); // start of document
		expect(lines[1]?.blankBefore).toBe(false);
		expect(lines[2]?.blankBefore).toBe(true);
	});

	it('treats a page break as a blank line', () => {
		const lines = reconstructLines(
			[
				item({ str: 'end of page one', y: 100, page: 1 }),
				item({ str: 'top of page two', y: 700, page: 2 })
			],
			PAGE_WIDTH
		);

		expect(lines[1]?.blankBefore).toBe(true);
	});

	it('records the horizontal extent of each line', () => {
		const lines = reconstructLines(
			[
				item({ str: 'abc', x: 72, y: 700, width: 30 }),
				item({ str: 'xyz', x: 200, y: 700, width: 25 })
			],
			PAGE_WIDTH
		);

		expect(lines[0]?.xStart).toBe(72);
		expect(lines[0]?.xEnd).toBe(225);
	});

	it('normalises text as part of reconstruction', () => {
		const lines = reconstructLines([item({ str: 'oﬃce' })], PAGE_WIDTH);
		expect(lines[0]?.text).toBe('office');
	});
});

describe('medianItemHeight', () => {
	it('ignores zero-height items', () => {
		const items = [
			item({ str: 'a', height: 0 }),
			item({ str: 'b', height: 10 }),
			item({ str: 'c', height: 12 })
		];

		expect(medianItemHeight(items)).toBe(11);
	});

	it('returns zero for no input', () => {
		expect(medianItemHeight([])).toBe(0);
	});
});
