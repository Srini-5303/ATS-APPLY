import type { DateRange } from '../types/parser';

/**
 * Date extraction (PRD §5.7).
 *
 * Patterns are applied **most-specific first** with span tracking, so an earlier, longer
 * match blocks a later, shorter one from consuming part of it. The PRD listed the patterns
 * but never fixed an order, which leaves the result undefined: applied naively, the
 * standalone `Month Year` rule shreds `Jan 2023 - Dec 2024` into two unrelated dates.
 */

const MONTHS: Readonly<Record<string, string>> = {
	jan: '01',
	january: '01',
	feb: '02',
	february: '02',
	mar: '03',
	march: '03',
	apr: '04',
	april: '04',
	may: '05',
	jun: '06',
	june: '06',
	jul: '07',
	july: '07',
	aug: '08',
	august: '08',
	sep: '09',
	sept: '09',
	september: '09',
	oct: '10',
	october: '10',
	nov: '11',
	november: '11',
	dec: '12',
	december: '12'
};

/** Northern-hemisphere convention; documented because academic usage differs. */
const SEASONS: Readonly<Record<string, string>> = {
	spring: '03',
	summer: '06',
	fall: '09',
	autumn: '09',
	winter: '12'
};

const CURRENT = /\b(?:present|current|now|ongoing|today|to\s+date)\b/i;

const MONTH_NAMES = Object.keys(MONTHS).join('|');
const SEASON_NAMES = Object.keys(SEASONS).join('|');
const SEP = String.raw`\s*(?:-|–|—|to|until|through)\s*`;
// Non-capturing: this is interpolated inside other patterns, and a capture here would shift
// every downstream group index.
const YEAR = String.raw`(?:19|20)\d{2}`;

interface Span {
	start: number;
	end: number;
}

function overlaps(spans: Span[], start: number, end: number): boolean {
	return spans.some((s) => start < s.end && end > s.start);
}

function monthYear(month: string, year: string): string {
	return `${year}-${MONTHS[month.toLowerCase()] ?? '01'}`;
}

function seasonYear(season: string, year: string): string {
	return `${year}-${SEASONS[season.toLowerCase()] ?? '01'}`;
}

function normalizeNumeric(month: string, year: string): string {
	return `${year}-${month.padStart(2, '0')}`;
}

/**
 * Ordered most-specific to least. Order is the contract here, not an implementation detail:
 * a range pattern must claim its text before any standalone pattern can.
 */
const PATTERNS: {
	id: string;
	regex: RegExp;
	build: (m: RegExpExecArray) => DateRange;
}[] = [
	{
		id: 'month-year-range',
		regex: new RegExp(
			String.raw`\b(${MONTH_NAMES})\.?\s+(${YEAR})${SEP}(?:(${MONTH_NAMES})\.?\s+(${YEAR})|(present|current|now|ongoing|today))\b`,
			'gi'
		),
		build: (m) => ({
			start: monthYear(m[1] ?? '', m[2] ?? ''),
			end: m[5] ? null : monthYear(m[3] ?? '', m[4] ?? ''),
			isCurrent: Boolean(m[5])
		})
	},
	{
		id: 'numeric-range',
		regex: new RegExp(
			String.raw`\b(\d{1,2})/(${YEAR})${SEP}(?:(\d{1,2})/(${YEAR})|(present|current|now))\b`,
			'gi'
		),
		build: (m) => ({
			start: normalizeNumeric(m[1] ?? '', m[2] ?? ''),
			end: m[5] ? null : normalizeNumeric(m[3] ?? '', m[4] ?? ''),
			isCurrent: Boolean(m[5])
		})
	},
	{
		id: 'season-range',
		regex: new RegExp(
			String.raw`\b(${SEASON_NAMES})\s+(${YEAR})${SEP}(?:(${SEASON_NAMES})\s+(${YEAR})|(present|current|now))\b`,
			'gi'
		),
		build: (m) => ({
			start: seasonYear(m[1] ?? '', m[2] ?? ''),
			end: m[5] ? null : seasonYear(m[3] ?? '', m[4] ?? ''),
			isCurrent: Boolean(m[5])
		})
	},
	{
		id: 'year-range',
		regex: new RegExp(
			String.raw`\b(${YEAR})${SEP}(?:(${YEAR})|(present|current|now|ongoing))\b`,
			'gi'
		),
		build: (m) => ({
			start: m[1] ?? null,
			end: m[3] ? null : (m[2] ?? null),
			isCurrent: Boolean(m[3])
		})
	},
	{
		id: 'month-year',
		regex: new RegExp(String.raw`\b(${MONTH_NAMES})\.?\s+(${YEAR})\b`, 'gi'),
		build: (m) => ({ start: monthYear(m[1] ?? '', m[2] ?? ''), end: null, isCurrent: false })
	},
	{
		id: 'season-year',
		regex: new RegExp(String.raw`\b(${SEASON_NAMES})\s+(${YEAR})\b`, 'gi'),
		build: (m) => ({ start: seasonYear(m[1] ?? '', m[2] ?? ''), end: null, isCurrent: false })
	},
	{
		id: 'bare-year',
		regex: new RegExp(String.raw`\b(${YEAR})\b`, 'g'),
		build: (m) => ({ start: m[1] ?? null, end: null, isCurrent: false })
	}
];

/** Every date in the text, in the order the patterns claimed them. */
export function extractDates(text: string): DateRange[] {
	const claimed: Span[] = [];
	const found: { index: number; range: DateRange }[] = [];

	for (const pattern of PATTERNS) {
		pattern.regex.lastIndex = 0;

		let match: RegExpExecArray | null;
		while ((match = pattern.regex.exec(text)) !== null) {
			const start = match.index;
			const end = start + match[0].length;

			// A more specific pattern already owns this text.
			if (overlaps(claimed, start, end)) continue;

			claimed.push({ start, end });
			found.push({ index: start, range: pattern.build(match) });
		}
	}

	return found.sort((a, b) => a.index - b.index).map((f) => f.range);
}

/** The first date range on a line, treating a bare "Present" as an open-ended current role. */
export function extractDateRange(text: string): DateRange | null {
	const dates = extractDates(text);
	const first = dates[0];

	if (!first) {
		return CURRENT.test(text) ? { start: null, end: null, isCurrent: true } : null;
	}

	// "Jan 2023" on a line that also says "Present" is an open range.
	if (!first.isCurrent && first.end === null && CURRENT.test(text)) {
		return { ...first, isCurrent: true };
	}

	return first;
}

export function hasDate(text: string): boolean {
	return extractDates(text).length > 0 || CURRENT.test(text);
}
