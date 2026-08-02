import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeColumns, findColumnSplit } from '$engine/parser/layout/columns';
import { extractPdfGeometry, type PdfjsRuntime } from '$engine/parser/pdf';
import type { PositionedItem } from '$engine/types/parser';
import { nodePdfjsRuntime } from '../../helpers/pdfjs-node';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'pdf');
const PAGE_WIDTH = 612;

let runtime: PdfjsRuntime;
beforeAll(async () => {
	runtime = await nodePdfjsRuntime();
});

async function geometryOf(name: string) {
	const buf = readFileSync(join(FIXTURES, `${name}.pdf`));
	const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	return extractPdfGeometry(data, runtime);
}

function item(x: number, y: number, str = 'text', width = 60): PositionedItem {
	return { str, x, y, width, height: 10, page: 1 };
}

/** A block of `rows` lines stacked downward at x. */
function block(x: number, rows: number, startY = 700, width = 60): PositionedItem[] {
	return Array.from({ length: rows }, (_, i) => item(x, startY - i * 14, `r${String(i)}`, width));
}

describe('findColumnSplit — real fixtures', () => {
	it('detects a genuine two-column layout', async () => {
		// A 0.3in (~22 unit) gutter. PRD §5.3's literal ">150px" rule misses this entirely.
		const geo = await geometryOf('two-column-true');
		const split = findColumnSplit(geo.items, geo.pageWidth);

		expect(split).not.toBeNull();
		expect(split?.left.length).toBeGreaterThan(4);
		expect(split?.right.length).toBeGreaterThan(4);
	});

	it('does not flag a single column with right-aligned dates', async () => {
		// The false positive that costs a correctly-formatted resume up to 13.5 formatting
		// points plus a top-ranked suggestion to fix a layout that is already fine.
		const geo = await geometryOf('right-aligned-dates');
		expect(findColumnSplit(geo.items, geo.pageWidth)).toBeNull();
	});

	it.each(['single-column-clean', 'three-line-stub', 'all-caps-headers', 'unicode-punctuation'])(
		'does not flag %s',
		async (name) => {
			const geo = await geometryOf(name);
			expect(analyzeColumns(geo.items, geo.pageWidth).hasMultipleColumns).toBe(false);
		}
	);

	it('orders a two-column page one column at a time', async () => {
		// Reading order is what keeps our own parse correct: interleaving the columns row by
		// row produces "CONTACT   EXPERIENCE" and no section header matches.
		const geo = await geometryOf('two-column-true');
		const { ordered } = analyzeColumns(geo.items, geo.pageWidth);

		const split = findColumnSplit(geo.items, geo.pageWidth);
		const leftCount = split?.left.length ?? 0;

		const firstHalfXs = ordered.slice(0, leftCount).map((i) => i.x);
		const secondHalfXs = ordered.slice(leftCount).map((i) => i.x);

		expect(Math.max(...firstHalfXs)).toBeLessThan(Math.min(...secondHalfXs));
	});
});

describe('findColumnSplit — thresholds', () => {
	it('ignores a page with too little content to judge', () => {
		expect(findColumnSplit(block(72, 3), PAGE_WIDTH)).toBeNull();
	});

	it('requires the smaller side to hold a real share of the content', () => {
		// 12 left, 2 right — a rail, not a column.
		const items = [...block(72, 12), ...block(400, 2)];
		expect(findColumnSplit(items, PAGE_WIDTH)).toBeNull();
	});

	it('requires the smaller side to span several rows', () => {
		// Balanced by item count, but the right side is one dense row.
		const items = [
			...block(72, 6),
			item(400, 700, 'a', 20),
			item(430, 700, 'b', 20),
			item(460, 700, 'c', 20),
			item(490, 700, 'd', 20),
			item(520, 700, 'e', 20),
			item(550, 700, 'f', 20)
		];
		expect(findColumnSplit(items, PAGE_WIDTH)).toBeNull();
	});

	it('requires both sides to run down the page', () => {
		// Right block sits only at the top; not a column running alongside.
		const items = [...block(72, 14, 700), ...block(400, 5, 700)];
		const split = findColumnSplit(items, PAGE_WIDTH);
		expect(split).toBeNull();
	});

	it('accepts two balanced full-height columns', () => {
		const items = [...block(72, 12, 700), ...block(340, 12, 700)];
		const split = findColumnSplit(items, PAGE_WIDTH);

		expect(split).not.toBeNull();
		expect(split?.left).toHaveLength(12);
		expect(split?.right).toHaveLength(12);
	});

	it('needs the gutter to be wide enough to be deliberate', () => {
		// Items 4 units apart are adjacent words, not separate columns.
		const items = [...block(72, 12, 700, 60), ...block(136, 12, 700, 60)];
		expect(findColumnSplit(items, PAGE_WIDTH)).toBeNull();
	});
});
