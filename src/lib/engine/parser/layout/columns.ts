import type { PositionedItem } from '../../types/parser';

/**
 * Column detection by whitespace gutter (projection profile).
 *
 * PRD §5.3 clustered x-positions and required a ">150px gap". Those are PDF user-space
 * units, so 150 is 2.08 inches — a real resume gutter is 0.2–0.4in, and the rule detects
 * almost nothing. Worse, a single-column resume with right-aligned dates produces exactly
 * two clusters with a wide gap, so it misfires in the other direction (ADR 0001 §11).
 *
 * Instead: find a vertical band that no text crosses, then require both sides to look like
 * real columns — a substantial share of the content, spread over many lines. That is what
 * separates a genuine two-column layout from a right-hand date rail.
 */

export const COLUMN_THRESHOLDS = {
	/** Gutter width, as a fraction of page width. ~0.18in on US Letter. */
	MIN_GUTTER_RATIO: 0.02,

	/**
	 * Minimum share of items on the *smaller* side.
	 *
	 * Justified by the fixtures: `two-column-true.pdf` splits ~48/52, while
	 * `right-aligned-dates.pdf` puts only ~19% in its right-hand rail. 0.25 separates them
	 * with margin.
	 */
	MIN_MINORITY_ITEM_RATIO: 0.25,

	/**
	 * Minimum distinct text rows on the smaller side. A date rail has a handful; a real
	 * column has many. Guards the ratio test on short documents.
	 */
	MIN_MINORITY_ROWS: 4,

	/** Both sides must cover at least this fraction of the content's vertical extent. */
	MIN_VERTICAL_COVERAGE: 0.5,

	/** Rows within this many units are the same row for counting purposes. */
	ROW_TOLERANCE: 3
} as const;

export interface ColumnSplit {
	/** x coordinate of the gutter's centre. */
	x: number;
	left: PositionedItem[];
	right: PositionedItem[];
}

function distinctRows(items: PositionedItem[]): number {
	const rows: number[] = [];
	for (const item of [...items].sort((a, b) => b.y - a.y)) {
		const last = rows.at(-1);
		if (last === undefined || Math.abs(last - item.y) > COLUMN_THRESHOLDS.ROW_TOLERANCE) {
			rows.push(item.y);
		}
	}
	return rows.length;
}

function verticalSpan(items: PositionedItem[]): number {
	if (items.length === 0) return 0;
	const ys = items.map((i) => i.y);
	return Math.max(...ys) - Math.min(...ys);
}

/**
 * Finds the gutter for one page, or null if the page is single-column.
 *
 * Exported so the thresholds can be exercised at their boundaries against synthetic input.
 */
export function findColumnSplit(items: PositionedItem[], pageWidth: number): ColumnSplit | null {
	if (items.length < 8) return null;

	const minGutter = pageWidth * COLUMN_THRESHOLDS.MIN_GUTTER_RATIO;

	// Sweep x in 1-unit buckets and mark every bucket any item covers. The unmarked runs
	// between the leftmost and rightmost text are the candidate gutters.
	const width = Math.ceil(pageWidth);
	const covered = new Uint8Array(width + 1);

	let minX = Number.POSITIVE_INFINITY;
	let maxX = 0;

	for (const item of items) {
		const start = Math.max(0, Math.floor(item.x));
		const end = Math.min(width, Math.ceil(item.x + item.width));
		for (let x = start; x <= end; x++) covered[x] = 1;
		minX = Math.min(minX, start);
		maxX = Math.max(maxX, end);
	}

	const contentHeight = verticalSpan(items);
	let best: ColumnSplit | null = null;
	let bestBalance = Number.POSITIVE_INFINITY;

	let runStart: number | null = null;

	for (let x = Math.floor(minX); x <= maxX + 1; x++) {
		const isGap = x <= maxX && covered[x] === 0;

		if (isGap) {
			runStart ??= x;
			continue;
		}

		if (runStart === null) continue;

		const gapStart = runStart;
		const runEnd = x - 1;
		const gutterWidth = runEnd - gapStart + 1;
		runStart = null;

		if (gutterWidth < minGutter) continue;

		const centre = gapStart + gutterWidth / 2;
		const splitX = centre;

		const left = items.filter((i) => i.x + i.width <= splitX);
		const right = items.filter((i) => i.x > splitX);
		if (left.length === 0 || right.length === 0) continue;

		const minoritySize = Math.min(left.length, right.length) / items.length;
		if (minoritySize < COLUMN_THRESHOLDS.MIN_MINORITY_ITEM_RATIO) continue;

		const minority = left.length <= right.length ? left : right;
		if (distinctRows(minority) < COLUMN_THRESHOLDS.MIN_MINORITY_ROWS) continue;

		// Both sides must run down the page. A header spanning the full width sitting above
		// two short blocks is not a two-column layout.
		if (contentHeight > 0) {
			const leftCoverage = verticalSpan(left) / contentHeight;
			const rightCoverage = verticalSpan(right) / contentHeight;
			if (
				leftCoverage < COLUMN_THRESHOLDS.MIN_VERTICAL_COVERAGE ||
				rightCoverage < COLUMN_THRESHOLDS.MIN_VERTICAL_COVERAGE
			) {
				continue;
			}
		}

		// Prefer the most balanced split when a page has several candidate gutters.
		const balance = Math.abs(left.length - right.length);
		if (balance < bestBalance) {
			bestBalance = balance;
			best = { x: centre, left, right };
		}
	}

	return best;
}

export interface ColumnAnalysis {
	hasMultipleColumns: boolean;
	/**
	 * Items in reading order: each column top-to-bottom, columns left-to-right.
	 *
	 * This is what keeps our own parse correct on a two-column resume. Without it, line
	 * reconstruction merges the two columns row by row — "CONTACT   EXPERIENCE" — and no
	 * section header matches anything.
	 */
	ordered: PositionedItem[];
}

export function analyzeColumns(items: PositionedItem[], pageWidth: number): ColumnAnalysis {
	const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);

	let hasMultipleColumns = false;
	const ordered: PositionedItem[] = [];

	for (const page of pages) {
		const pageItems = items.filter((i) => i.page === page);
		const split = findColumnSplit(pageItems, pageWidth);

		if (!split) {
			ordered.push(...pageItems);
			continue;
		}

		hasMultipleColumns = true;
		// Tag the column so line reconstruction reads the left one fully before the right,
		// rather than interleaving them row by row across the gutter.
		ordered.push(
			...split.left.map((i) => ({ ...i, column: 0 })),
			...split.right.map((i) => ({ ...i, column: 1 }))
		);
	}

	return { hasMultipleColumns, ordered };
}
