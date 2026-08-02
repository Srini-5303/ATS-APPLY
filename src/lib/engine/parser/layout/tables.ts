import type { PositionedItem } from '../../types/parser';

/**
 * Table detection by repeated column-like gaps.
 *
 * PRD §5.3 flagged a table on any line with 3+ items and 2+ wide gaps, with no minimum line
 * count — so a single three-column skills list ("Go   Python   Kubernetes") triggered a
 * 12-point penalty. A table is a *repeated* structure, so require several consecutive rows
 * of it (ADR 0001 §11).
 */

export const TABLE_THRESHOLDS = {
	/** Minimum cells in a row for it to look tabular. */
	MIN_CELLS: 3,
	/** Minimum wide gaps between those cells. */
	MIN_GAPS: 2,
	/** Gap width as a fraction of page width. ~30 units on US Letter. */
	GAP_RATIO: 0.05,
	/**
	 * Consecutive tabular rows required. Justified by `skills-three-column-list.pdf`, which
	 * has exactly one such row and must not be flagged.
	 */
	MIN_CONSECUTIVE_ROWS: 3,
	ROW_TOLERANCE: 3
} as const;

function groupRows(items: PositionedItem[]): PositionedItem[][] {
	const sorted = [...items].sort((a, b) => (a.page !== b.page ? a.page - b.page : b.y - a.y));

	const rows: PositionedItem[][] = [];

	// Track the open row and its anchor directly rather than reaching back into `rows`, so
	// only one value is nullable and the narrowing stays straightforward.
	let currentRow: PositionedItem[] = [];
	let anchor: PositionedItem | null = null;

	for (const item of sorted) {
		if (
			anchor?.page === item.page &&
			Math.abs(anchor.y - item.y) <= TABLE_THRESHOLDS.ROW_TOLERANCE
		) {
			currentRow.push(item);
			continue;
		}

		currentRow = [item];
		anchor = item;
		rows.push(currentRow);
	}

	return rows;
}

function isTabularRow(row: PositionedItem[], minGap: number): boolean {
	if (row.length < TABLE_THRESHOLDS.MIN_CELLS) return false;

	const ordered = [...row].sort((a, b) => a.x - b.x);
	let wideGaps = 0;

	for (let i = 1; i < ordered.length; i++) {
		const prev = ordered[i - 1];
		const curr = ordered[i];
		if (!prev || !curr) continue;
		if (curr.x - (prev.x + prev.width) > minGap) wideGaps++;
	}

	return wideGaps >= TABLE_THRESHOLDS.MIN_GAPS;
}

export function detectTables(items: PositionedItem[], pageWidth: number): boolean {
	const minGap = pageWidth * TABLE_THRESHOLDS.GAP_RATIO;
	const rows = groupRows(items);

	let consecutive = 0;
	for (const row of rows) {
		if (isTabularRow(row, minGap)) {
			consecutive++;
			if (consecutive >= TABLE_THRESHOLDS.MIN_CONSECUTIVE_ROWS) return true;
		} else {
			consecutive = 0;
		}
	}

	return false;
}
