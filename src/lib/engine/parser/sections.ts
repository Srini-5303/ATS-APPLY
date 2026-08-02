import { SECTION_TYPES, type RawLine, type ResumeSection, type SectionType } from '../types/parser';
import { hasDate } from './dates';
import {
	looksLikeAllCapsHeader,
	looksLikeColonHeader,
	looksLikePersonName,
	looksLikeTitleCaseHeader,
	matchSectionType
} from './section-patterns';

/**
 * Two-pass section detection (PRD §5.5).
 *
 * Pass 1 locates headers, pass 2 assigns the content between them.
 *
 * Four strategies, in strict precedence order — the PRD never stated one, which leaves the
 * result undefined when a line matches several (ADR 0001 §10):
 *
 *   1. dictionary  — a known header word, always wins
 *   2. heuristic A — ALL CAPS, short, preceded by a blank line
 *   3. heuristic B — ends with a colon, short
 *   4. heuristic C — short title-case line, blank line before, content after, not a name
 *
 * Anything matched by 2–4 but not 1 is a real section with an unrecognised name, so it is
 * typed `unknown` — which is exactly what Workday's non-standard-header quirk counts.
 */

interface HeaderHit {
	index: number;
	type: SectionType;
	heading: string;
}

/** Lines from the top within which a name-shaped line is treated as the candidate's name. */
const NAME_ZONE_LINES = 5;

function hasContentAfter(lines: RawLine[], index: number): boolean {
	const next = lines[index + 1];
	return next !== undefined && next.text.trim() !== '';
}

/** Words that make a short title-case line a job title rather than a section heading. */
const JOB_TITLE_WORD =
	/\b(?:engineer|developer|manager|director|analyst|designer|scientist|consultant|architect|administrator|specialist|coordinator|lead|officer|president|intern|associate|assistant|advisor|strategist|researcher|technician|accountant|attorney|nurse|teacher|professor)\b/i;

/** A following line carrying a date is the employer line of a role, not section content. */
function nextLineLooksLikeEmployer(lines: RawLine[], index: number): boolean {
	const next = lines[index + 1];
	return next !== undefined && hasDate(next.text);
}

function detectHeaders(lines: RawLine[]): HeaderHit[] {
	const headers: HeaderHit[] = [];

	for (const [index, line] of lines.entries()) {
		const text = line.text.trim();
		if (text === '') continue;

		// 1. Dictionary.
		const known = matchSectionType(text);
		if (known) {
			headers.push({ index, type: known, heading: text });
			continue;
		}

		// A name is not a section header — but only exclude near the top, where names actually
		// appear. Applied document-wide this also swallows legitimate two-word headings like
		// "Key Achievements", which match the same shape.
		if (index < NAME_ZONE_LINES && looksLikePersonName(text)) continue;

		// 2. ALL CAPS after a break.
		if (line.blankBefore && looksLikeAllCapsHeader(text) && hasContentAfter(lines, index)) {
			headers.push({ index, type: 'unknown', heading: text });
			continue;
		}

		// 3. Trailing colon. No blank line required — "Skills:" mid-document is still a header.
		if (looksLikeColonHeader(text) && hasContentAfter(lines, index)) {
			headers.push({ index, type: 'unknown', heading: text });
			continue;
		}

		// 4. Weakest signal, so it needs every corroborating condition — including two
		//    negative ones that keep it off role headers.
		//
		//    A job title sitting above its employer and dates ("Software Engineer" /
		//    "Twilio | 2018 - 2020") is title-case, short, and preceded by a blank line, so
		//    it satisfies every positive condition and would split one Experience section
		//    into several unnamed ones.
		if (
			line.blankBefore &&
			index > 0 &&
			looksLikeTitleCaseHeader(text) &&
			hasContentAfter(lines, index) &&
			!JOB_TITLE_WORD.test(text) &&
			!nextLineLooksLikeEmployer(lines, index)
		) {
			headers.push({ index, type: 'unknown', heading: text });
		}
	}

	return headers;
}

export function detectSections(lines: RawLine[]): ResumeSection[] {
	const headers = detectHeaders(lines);

	const sections: ResumeSection[] = [];

	// Content before the first header is contact material (PRD §5.5). Note this makes
	// `contact` present for essentially every resume, which is exactly why it was dropped
	// from every profile's requiredSections (ADR 0001 §7).
	const firstHeaderIndex = headers[0]?.index ?? lines.length;
	if (firstHeaderIndex > 0) {
		sections.push({
			type: 'contact',
			heading: null,
			content: lines.slice(0, firstHeaderIndex).map((l) => l.text),
			startLine: 0,
			endLine: firstHeaderIndex - 1
		});
	}

	for (const [i, header] of headers.entries()) {
		const nextIndex = headers[i + 1]?.index ?? lines.length;
		const content = lines.slice(header.index + 1, nextIndex).map((l) => l.text);

		sections.push({
			type: header.type,
			heading: header.heading,
			content,
			startLine: header.index,
			endLine: nextIndex - 1
		});
	}

	return sections;
}

/** Counts per section type, including duplicates — Workday's quirk needs the count, not a set. */
export function countSections(sections: ResumeSection[]): Record<SectionType, number> {
	const counts = Object.fromEntries(SECTION_TYPES.map((t) => [t, 0])) as Record<
		SectionType,
		number
	>;

	for (const section of sections) counts[section.type] += 1;

	return counts;
}

export function sectionText(sections: ResumeSection[], type: SectionType): string {
	return sections
		.filter((s) => s.type === type)
		.flatMap((s) => s.content)
		.join('\n');
}
