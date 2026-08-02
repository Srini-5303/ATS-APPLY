import { describe, expect, it } from 'vitest';
import { extractDateRange, extractDates, hasDate } from '$engine/parser/dates';

describe('extractDateRange', () => {
	it.each([
		['Jan 2023 - Dec 2024', '2023-01', '2024-12'],
		['January 2023 – December 2024', '2023-01', '2024-12'],
		['Sept 2019 to Mar 2021', '2019-09', '2021-03'],
		['01/2023 - 12/2024', '2023-01', '2024-12'],
		['Spring 2023 - Fall 2024', '2023-03', '2024-09'],
		['2019 - 2024', '2019', '2024']
	])('parses %s', (input, start, end) => {
		const range = extractDateRange(input);
		expect(range?.start).toBe(start);
		expect(range?.end).toBe(end);
		expect(range?.isCurrent).toBe(false);
	});

	it.each(['Jan 2023 - Present', 'Jan 2023 – Current', '2021 - Now', '01/2021 - present'])(
		'marks %s as ongoing',
		(input) => {
			const range = extractDateRange(input);
			expect(range?.isCurrent).toBe(true);
			expect(range?.end).toBeNull();
		}
	);

	it('does not shred a range into two standalone dates', () => {
		// The whole reason patterns run most-specific-first with span tracking. Applied in the
		// PRD's listed order, the standalone Month-Year rule claims "Jan 2023" and "Dec 2024"
		// separately and the range is lost.
		const dates = extractDates('Jan 2023 - Dec 2024');

		expect(dates).toHaveLength(1);
		expect(dates[0]).toEqual({ start: '2023-01', end: '2024-12', isCurrent: false });
	});

	it('does not let the bare-year rule split a year range', () => {
		const dates = extractDates('2019 - 2024');
		expect(dates).toHaveLength(1);
	});

	it('finds several independent ranges in one block', () => {
		const dates = extractDates('Jan 2021 - Dec 2022 and later Mar 2023 - Present');

		expect(dates).toHaveLength(2);
		expect(dates[0]?.start).toBe('2021-01');
		expect(dates[1]?.isCurrent).toBe(true);
	});

	it('returns dates in document order regardless of which pattern claimed them', () => {
		const dates = extractDates('2018 graduated, then Jan 2020 - Dec 2021');

		expect(dates[0]?.start).toBe('2018');
		expect(dates[1]?.start).toBe('2020-01');
	});

	it('zero-pads single-digit numeric months', () => {
		expect(extractDateRange('3/2021 - 7/2022')?.start).toBe('2021-03');
	});

	it('treats a lone "Present" as ongoing with no start', () => {
		const range = extractDateRange('Present');
		expect(range).toEqual({ start: null, end: null, isCurrent: true });
	});

	it('combines a standalone start with a separate "Present"', () => {
		const range = extractDateRange('Started Jan 2023, still there (Present)');
		expect(range?.start).toBe('2023-01');
		expect(range?.isCurrent).toBe(true);
	});

	it('returns null when there is no date', () => {
		expect(extractDateRange('Senior Software Engineer')).toBeNull();
	});

	it('ignores numbers that are not plausible years', () => {
		expect(extractDates('Reduced latency by 1200 ms and served 3000 users')).toHaveLength(0);
	});

	it('reports whether a line carries any date at all', () => {
		expect(hasDate('Engineer | Acme | 2021 - Present')).toBe(true);
		expect(hasDate('Engineer | Acme')).toBe(false);
	});
});
