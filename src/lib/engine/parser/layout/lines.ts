import type { PositionedItem, RawLine } from '../../types/parser';
import { normalizeText } from '../text';

/**
 * Reconstructs text lines from positioned PDF items.
 *
 * Pure over `PositionedItem[]`, so it is testable against hand-built synthetic arrays rather
 * than requiring a PDF round-trip for every threshold tweak (ADR 0001 §11).
 */

export const LAYOUT_THRESHOLDS = {
	/**
	 * Fraction of median glyph height within which two items count as the same line.
	 *
	 * PRD §5.3 specified a flat 3px. That works for 10pt body text and breaks on the 8pt
	 * tight-leading resumes in the fixture corpus, so it is derived from the text itself.
	 * Justified by `small-font-tight-leading.pdf`.
	 */
	Y_TOLERANCE_RATIO: 0.4,
	Y_TOLERANCE_MIN: 1.5,

	/**
	 * A vertical gap larger than this multiple of the median leading counts as a blank line.
	 * Feeds `RawLine.blankBefore`, which PRD §5.5's section heuristics need and which the
	 * original extraction pipeline destroyed (ADR 0001 §10).
	 */
	BLANK_LINE_RATIO: 1.6,

	/** Percentile of line-gap distances taken as the document's normal leading. */
	LEADING_PERCENTILE: 0.25,

	/**
	 * Horizontal gap, as a fraction of page width, above which two items on the same line are
	 * treated as separated by whitespace rather than a single space. ~30 units on US Letter.
	 */
	WIDE_GAP_RATIO: 0.05
} as const;

function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
	return sorted[index] ?? 0;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
	return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Median glyph height across all items, used to scale the y-tolerance. */
export function medianItemHeight(items: PositionedItem[]): number {
	return median(items.map((i) => i.height).filter((h) => h > 0));
}

interface LineGroup {
	page: number;
	column: number;
	y: number;
	items: PositionedItem[];
}

function groupIntoLines(items: PositionedItem[], yTolerance: number): LineGroup[] {
	const groups: LineGroup[] = [];

	// Page, then column, then y descending — PDF origin is bottom-left, so larger y is higher
	// on the page. Sorting by column before y is what makes a two-column page read one column
	// at a time instead of interleaving across the gutter.
	const sorted = [...items].sort((a, b) => {
		if (a.page !== b.page) return a.page - b.page;
		const columnA = a.column ?? 0;
		const columnB = b.column ?? 0;
		if (columnA !== columnB) return columnA - columnB;
		return b.y - a.y;
	});

	for (const item of sorted) {
		const last = groups.at(-1);

		if (
			last?.page === item.page &&
			last.column === (item.column ?? 0) &&
			Math.abs(last.y - item.y) <= yTolerance
		) {
			last.items.push(item);
			continue;
		}

		groups.push({ page: item.page, column: item.column ?? 0, y: item.y, items: [item] });
	}

	return groups;
}

/**
 * Joins the items of one line, inserting a single space where the glyphs are adjacent and
 * preserving a wider separation where they are not — so `Acme Corp .... Jan 2023` does not
 * collapse into `Acme CorpJan 2023`.
 */
function joinLineItems(items: PositionedItem[], wideGap: number): string {
	const ordered = [...items].sort((a, b) => a.x - b.x);
	let text = '';
	let prevEnd: number | null = null;

	for (const item of ordered) {
		if (prevEnd !== null) {
			const gap = item.x - prevEnd;
			if (gap > wideGap) text += '   ';
			else if (gap > 0.5 || !text.endsWith(' ')) text += ' ';
		}
		text += item.str;
		prevEnd = item.x + item.width;
	}

	return text.replace(/\s+/g, ' ').trim();
}

export function reconstructLines(items: PositionedItem[], pageWidth: number): RawLine[] {
	if (items.length === 0) return [];

	const heightBasis = medianItemHeight(items);
	const yTolerance = Math.max(
		LAYOUT_THRESHOLDS.Y_TOLERANCE_MIN,
		heightBasis * LAYOUT_THRESHOLDS.Y_TOLERANCE_RATIO
	);
	const wideGap = pageWidth * LAYOUT_THRESHOLDS.WIDE_GAP_RATIO;

	const groups = groupIntoLines(items, yTolerance);

	// Baseline line-to-line distance, used to decide what counts as a blank line.
	//
	// A low percentile rather than the median: the gaps we are trying to *detect* are part of
	// this same distribution, so a median is dragged upward by them and a paragraph break
	// stops registering. Normal leading dominates the bottom of the distribution, so the 25th
	// percentile tracks it and stays stable on short documents.
	const deltas: number[] = [];
	for (let i = 1; i < groups.length; i++) {
		const prev = groups[i - 1];
		const curr = groups[i];
		if (curr && prev?.page === curr.page) deltas.push(prev.y - curr.y);
	}
	const leading = percentile(
		deltas.filter((d) => d > 0),
		LAYOUT_THRESHOLDS.LEADING_PERCENTILE
	);

	return groups.map((group, index) => {
		const prev = index > 0 ? groups[index - 1] : undefined;

		let blankBefore = false;
		if (!prev) {
			blankBefore = true;
		} else if (prev.page !== group.page || prev.column !== group.column) {
			blankBefore = true;
		} else if (leading > 0) {
			blankBefore = prev.y - group.y > leading * LAYOUT_THRESHOLDS.BLANK_LINE_RATIO;
		}

		const xs = group.items.map((i) => i.x);
		const ends = group.items.map((i) => i.x + i.width);

		return {
			text: normalizeText(joinLineItems(group.items, wideGap)),
			page: group.page,
			y: group.y,
			xStart: Math.min(...xs),
			xEnd: Math.max(...ends),
			blankBefore
		};
	});
}
