import type { ContactInfo, RawLine } from '../types/parser';
import { looksLikePersonName } from './section-patterns';

/**
 * Contact extraction (PRD §5.6). Scoped to the head of the document, where contact details
 * live on essentially every resume.
 */

const SEARCH_LINES = 15;
const NAME_SEARCH_LINES = 5;

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * PRD §5.6's pattern made every group optional, leaving `\d{3}[-.\s]?\d{4}` as the effective
 * minimum. That matches "2015 2019" — an ordinary date range — as `015` + space + `2019`, and
 * matches inside a ZIP+4 like `02115-1234`. So: anchor on a word boundary, and verify the
 * digit count afterwards (ADR 0001 §12).
 */
const PHONE_CANDIDATE = new RegExp(
	[
		// North American: optional +1, then 3-3-4 in any common punctuation.
		String.raw`\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d{1,5})?`,
		// International: a leading + then 2–4 space/dash-separated groups, e.g.
		// "+44 20 7946 0958". Without this branch every non-US number is missed.
		String.raw`\+\d{1,3}(?:[\s.-]\d{2,5}){2,4}`
	].join('|'),
	'gi'
);

const URL = /https?:\/\/[^\s,;]+|(?:www\.)[^\s,;]+/gi;
const LINKEDIN = /(?:linkedin\.com|linked\s?in)[/\s]*(?:in[/\s]*)?([A-Za-z0-9_-]{3,})/i;
const GITHUB = /github\.com[/\s]*([A-Za-z0-9_-]{2,})/i;

const LOCATION =
	/\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2}),\s*([A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+\d{5}(?:-\d{4})?)?\b/;

/** Years look like phone fragments; a plausible number has 10 digits, or 11 with a country code. */
function isPlausiblePhone(raw: string): boolean {
	// Count the number itself, not the extension — "x123" would otherwise push a valid
	// 10-digit number to 13 and get it rejected.
	const digits = raw.replace(/\s*(?:x|ext\.?)\s*\d{1,5}$/i, '').replace(/\D/g, '');
	if (digits.length === 10) return true;
	if (digits.length === 11) return digits.startsWith('1');
	// International numbers vary; require a leading + to accept anything else.
	return raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15;
}

/** "2015 2019", "2015 - 2019" and similar are date ranges, not phone numbers. */
function looksLikeYearRange(raw: string): boolean {
	const digits = raw.replace(/\D/g, '');
	if (digits.length !== 8) return false;

	const first = Number(digits.slice(0, 4));
	const second = Number(digits.slice(4));
	const plausibleYear = (y: number) => y >= 1900 && y <= 2100;

	return plausibleYear(first) && plausibleYear(second);
}

export function extractPhone(text: string): string | null {
	for (const match of text.matchAll(PHONE_CANDIDATE)) {
		const raw = match[0].trim();
		if (looksLikeYearRange(raw)) continue;
		if (isPlausiblePhone(raw)) return raw;
	}
	return null;
}

function extractName(lines: RawLine[]): string | null {
	for (const line of lines.slice(0, NAME_SEARCH_LINES)) {
		const text = line.text.trim();
		if (text === '') continue;
		if (EMAIL.test(text) || URL.test(text)) continue;
		if (extractPhone(text)) continue;

		if (looksLikePersonName(text)) return text;

		// Many resumes set the name in full caps.
		if (
			text === text.toUpperCase() &&
			/^[A-Z][A-Z\s.'-]{2,60}$/.test(text) &&
			text.split(/\s+/).length >= 2 &&
			text.split(/\s+/).length <= 5
		) {
			return text;
		}
	}
	return null;
}

export function extractContact(lines: RawLine[]): ContactInfo {
	const head = lines.slice(0, SEARCH_LINES);
	const text = head.map((l) => l.text).join('\n');

	const linkedinMatch = LINKEDIN.exec(text);
	const githubMatch = GITHUB.exec(text);

	// A generic URL that is not one of the recognised profile hosts.
	const website =
		[...text.matchAll(URL)]
			.map((m) => m[0].replace(/[.,;]$/, ''))
			.find((u) => !/linkedin\.com|github\.com/i.test(u)) ?? null;

	const locationMatch = LOCATION.exec(text);

	return {
		name: extractName(head),
		email: EMAIL.exec(text)?.[0] ?? null,
		phone: extractPhone(text),
		linkedin: linkedinMatch?.[1] ? `linkedin.com/in/${linkedinMatch[1]}` : null,
		github: githubMatch?.[1] ? `github.com/${githubMatch[1]}` : null,
		website,
		location: locationMatch?.[0] ?? null
	};
}
