import { describe, expect, it } from 'vitest';
import { extractContact, extractPhone } from '$engine/parser/contact';
import type { RawLine } from '$engine/types/parser';

function lines(...texts: string[]): RawLine[] {
	return texts.map((text, i) => ({
		text,
		page: 1,
		y: 700 - i * 14,
		xStart: 72,
		xEnd: 400,
		blankBefore: false
	}));
}

describe('extractPhone', () => {
	it.each([
		'(415) 555-0142',
		'415-555-0142',
		'415.555.0142',
		'4155550142',
		'+1 415 555 0142',
		'+1 (415) 555-0142'
	])('accepts %s', (input) => {
		expect(extractPhone(`Call me at ${input} anytime`)).not.toBeNull();
	});

	it.each([
		['2015 2019', 'a bare year range'],
		['2015 - 2019', 'a hyphenated year range'],
		['Jan 2015 Dec 2019', 'a month-year range']
	])('rejects %s (%s)', (input) => {
		// PRD §5.6's regex matched "2015 2019" as 015 + space + 2019 (ADR 0001 §12). A date
		// range extracted as a phone number is worse than no phone number at all.
		expect(extractPhone(input)).toBeNull();
	});

	it('does not pull a phone number out of a ZIP+4', () => {
		expect(extractPhone('Boston, MA 02115-1234')).toBeNull();
	});

	it('rejects a number with too few digits', () => {
		expect(extractPhone('Room 555-0142')).toBeNull();
	});

	it('keeps an extension when present', () => {
		expect(extractPhone('(415) 555-0142 x123')).toContain('x123');
	});
});

describe('extractContact', () => {
	const header = lines(
		'ALEX MORGAN',
		'alex.morgan@example.com | (415) 555-0142 | San Francisco, CA',
		'linkedin.com/in/alexmorgan | github.com/alexmorgan | https://alexmorgan.dev'
	);

	it('pulls out every field from a conventional header', () => {
		const contact = extractContact(header);

		expect(contact.name).toBe('ALEX MORGAN');
		expect(contact.email).toBe('alex.morgan@example.com');
		expect(contact.phone).toContain('555-0142');
		expect(contact.linkedin).toBe('linkedin.com/in/alexmorgan');
		expect(contact.github).toBe('github.com/alexmorgan');
		expect(contact.website).toBe('https://alexmorgan.dev');
		expect(contact.location).toBe('San Francisco, CA');
	});

	it('reads a title-case name', () => {
		expect(extractContact(lines('Alex Morgan', 'alex@example.com')).name).toBe('Alex Morgan');
	});

	it('does not mistake the email line for the name', () => {
		expect(extractContact(lines('alex@example.com', 'Alex Morgan')).name).toBe('Alex Morgan');
	});

	it('handles apostrophes and hyphens in names', () => {
		expect(extractContact(lines("Zoe Fitzgerald-O'Brien", 'z@example.com')).name).toBe(
			"Zoe Fitzgerald-O'Brien"
		);
	});

	it('does not treat the profile URL as the website', () => {
		const contact = extractContact(lines('Alex Morgan', 'linkedin.com/in/alexmorgan'));
		expect(contact.website).toBeNull();
	});

	it('returns nulls rather than throwing on an empty document', () => {
		const contact = extractContact([]);
		expect(contact.name).toBeNull();
		expect(contact.email).toBeNull();
		expect(contact.phone).toBeNull();
	});

	it('ignores contact details buried deep in the document', () => {
		// Scoped to the first 15 lines; a reference's email at the bottom is not the
		// candidate's.
		const long = lines(...Array.from({ length: 30 }, (_, i) => `line ${String(i)}`));
		long[25] = { ...long[25]!, text: 'referee@example.com' };

		expect(extractContact(long).email).toBeNull();
	});
});
