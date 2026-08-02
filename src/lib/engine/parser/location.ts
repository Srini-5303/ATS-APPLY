/**
 * Place detection.
 *
 * "City, ST" is structurally identical to plenty of things that are not places —
 * "Databricks, Agent orchestration" and "Senior Engineer, Stripe" among them. Three
 * constraints separate them: the match may not span a line break, the tail must be a
 * two-letter code or sit at the end of the line, and leading acronyms are trimmed off the
 * city.
 */

/**
 * Note `[ \t]` rather than `\s`: a place never spans a newline, but without that restriction
 * "Srinivasan Raghavan\nBoston, MA" matches as one span and the name leaks into the location.
 */
const CANDIDATE = new RegExp(
	String.raw`\b(\p{Lu}[\p{L}.'-]+(?:[ \t]+\p{Lu}[\p{L}.'-]+){0,2}),[ \t]*([A-Z]{2}|\p{Lu}\p{Ll}+(?:[ \t]+\p{Lu}\p{Ll}+)?)\b`,
	'gu'
);

/**
 * Real US state, DC, territory and Canadian province codes.
 *
 * Checked against a list rather than `/^[A-Z]{2}$/`, because plenty of two-letter uppercase
 * tokens are not places: "B.S. Computer Science, UC Berkeley" was matching as a location on
 * the strength of "UC" alone.
 */
const REGION_CODES: ReadonlySet<string> = new Set([
	'AL',
	'AK',
	'AZ',
	'AR',
	'CA',
	'CO',
	'CT',
	'DE',
	'FL',
	'GA',
	'HI',
	'ID',
	'IL',
	'IN',
	'IA',
	'KS',
	'KY',
	'LA',
	'ME',
	'MD',
	'MA',
	'MI',
	'MN',
	'MS',
	'MO',
	'MT',
	'NE',
	'NV',
	'NH',
	'NJ',
	'NM',
	'NY',
	'NC',
	'ND',
	'OH',
	'OK',
	'OR',
	'PA',
	'RI',
	'SC',
	'SD',
	'TN',
	'TX',
	'UT',
	'VT',
	'VA',
	'WA',
	'WV',
	'WI',
	'WY',
	'DC',
	'PR',
	'VI',
	'GU',
	'AS',
	'MP',
	'AB',
	'BC',
	'MB',
	'NB',
	'NL',
	'NS',
	'NT',
	'NU',
	'ON',
	'QC',
	'SK',
	'YT',
	'UK'
]);

function isCode(tail: string): boolean {
	return REGION_CODES.has(tail);
}

/**
 * Drops leading all-caps acronyms from the city.
 *
 * A header like "… RAG Providence, RI" matches from "RAG", because the regex takes the
 * leftmost start. "RAG" is a technology, not part of the city name.
 */
function trimAcronyms(city: string): string {
	const words = city.split(/[ \t]+/);
	while (words.length > 1 && /^[A-Z]{2,}$/.test(words[0] ?? '')) words.shift();
	return words.join(' ');
}

/**
 * The best place-like span in a line, or null.
 *
 * A coded tail wins outright. A spelled-out tail is only accepted at the end of the line,
 * where resumes actually put locations — mid-line it is far more likely to be a list.
 */
export function findPlace(text: string, reject?: (candidate: string) => boolean): string | null {
	CANDIDATE.lastIndex = 0;

	let trailing: string | null = null;

	let match: RegExpExecArray | null;
	while ((match = CANDIDATE.exec(text)) !== null) {
		const whole = match[0];
		const city = trimAcronyms(match[1] ?? '');
		const tail = match[2] ?? '';

		if (reject?.(whole) === true) continue;

		const cleaned = `${city}, ${tail}`;
		if (isCode(tail)) return cleaned;

		const rest = text.slice(match.index + whole.length);
		if (/^[\s.,;|]*$/.test(rest)) trailing = cleaned;
	}

	return trailing;
}
