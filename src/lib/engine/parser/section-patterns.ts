import type { SectionType } from '../types/parser';

/**
 * Header vocabulary per section type (PRD §5.5).
 *
 * Pure data: adding a synonym is a one-line edit here, never a code change. Patterns are
 * matched against a header candidate that has already been lowercased and stripped of
 * trailing punctuation, and they are anchored so "Experience" matches but "My experience
 * includes" does not.
 */
export const SECTION_PATTERNS: Readonly<Record<Exclude<SectionType, 'unknown'>, RegExp>> = {
	contact:
		/^(?:contact(?:\s+(?:info(?:rmation)?|details))?|personal\s+(?:info(?:rmation)?|details))$/,

	summary:
		/^(?:(?:professional\s+|career\s+|executive\s+)?summary|profile|about(?:\s+me)?|objective|career\s+objective|professional\s+profile|overview)$/,

	experience:
		/^(?:(?:work|professional|relevant|industry)\s+experience|experience|employment(?:\s+history)?|work\s+history|career\s+history|professional\s+background|positions?(?:\s+held)?)$/,

	education:
		/^(?:education(?:al\s+background)?|academic(?:\s+background|\s+history|s)?|qualifications?|academic\s+qualifications?|degrees?)$/,

	skills:
		/^(?:(?:technical|core|key|professional|relevant)\s+(?:skills|competencies)|skills(?:\s+(?:&|and)\s+\w+)?|competencies|proficiencies|expertise|areas?\s+of\s+expertise|technologies|technical\s+proficiencies|tech\s+stack)$/,

	projects:
		/^(?:(?:personal|side|selected|key|notable|academic)\s+projects|projects?|portfolio|project\s+experience)$/,

	certifications:
		/^(?:certifications?|certificates?|licen[cs]es?(?:\s+(?:&|and)\s+certifications?)?|credentials|professional\s+certifications?)$/,

	awards:
		/^(?:awards?(?:\s+(?:&|and)\s+\w+)?|honors?(?:\s+(?:&|and)\s+awards?)?|achievements?|recognitions?|accomplishments?)$/,

	publications: /^(?:publications?|papers?|research(?:\s+publications?)?|articles?|patents?)$/,

	volunteer:
		/^(?:volunteer(?:ing|\s+(?:experience|work))?|community(?:\s+(?:service|involvement))?|extracurriculars?|activities)$/,

	languages: /^(?:languages?(?:\s+spoken)?|language\s+proficiency)$/,

	interests: /^(?:interests?|hobbies(?:\s+(?:&|and)\s+interests?)?|personal\s+interests?)$/
};

/** Longest header we will consider; real headers are short. */
export const MAX_HEADER_WORDS = 5;

/**
 * Reduces a line to a comparable header candidate: trailing separators removed, collapsed
 * whitespace, lowercased.
 */
export function headerCandidate(line: string): string {
	return line
		.trim()
		.replace(/[:\-_|.]+$/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

export function matchSectionType(line: string): SectionType | null {
	const candidate = headerCandidate(line);
	if (candidate === '') return null;
	if (candidate.split(' ').length > MAX_HEADER_WORDS) return null;

	for (const [type, pattern] of Object.entries(SECTION_PATTERNS)) {
		if (pattern.test(candidate)) return type as SectionType;
	}

	return null;
}

/**
 * Looks like a person's name rather than a section header: 2–5 capitalised words, no digits.
 *
 * PRD §5.5's heuristic C says 2–3 words while §5.6's name extractor says 2–5; unified on 2–5
 * (ADR 0001 §12) so "Zoe Fitzgerald O'Brien Smith" is not read as a section heading.
 */
export function looksLikePersonName(line: string): boolean {
	const trimmed = line.trim();
	const words = trimmed.split(/\s+/);
	if (words.length < 2 || words.length > 5) return false;

	// Plenty of resumes set the candidate's name in full caps. Callers only apply this near
	// the top of the document, where an all-caps line is far more likely to be the name than
	// a section heading — and any real heading there is caught by the dictionary first.
	if (trimmed === trimmed.toUpperCase() && /^\p{Lu}[\p{Lu}\s.'’-]*$/u.test(trimmed)) return true;

	// Unicode classes rather than [A-Za-z]: names carry accents and non-Latin scripts, and
	// "Zoe Fitzgerald-O'Brien" must not be excluded just because of the diaeresis.
	// A capital after an apostrophe or hyphen is allowed so O'Brien reads as one word.
	const word = /^\p{Lu}[\p{Ll}'’]*(?:[-'’]\p{Lu}[\p{Ll}]*)*\.?$/u;
	return words.every((w) => word.test(w) || /^\p{Lu}\.$/u.test(w));
}

/** ALL-CAPS with no long digit runs — the most common resume header convention. */
export function looksLikeAllCapsHeader(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length < 3) return false;
	if (trimmed.split(/\s+/).length > MAX_HEADER_WORDS) return false;
	if (/\d{3,}/.test(trimmed)) return false;
	if (!/[A-Z]{2,}/.test(trimmed)) return false;
	return trimmed === trimmed.toUpperCase();
}

/** Ends with a colon, e.g. "Technical Skills:". */
export function looksLikeColonHeader(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.endsWith(':')) return false;
	const body = trimmed.slice(0, -1).trim();
	if (body === '' || body.split(/\s+/).length > MAX_HEADER_WORDS) return false;
	return /[a-z]/i.test(body);
}

/** Short, alphabetic, title-like — the weakest signal, so it needs the most corroboration. */
export function looksLikeTitleCaseHeader(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed === '' || trimmed.split(/\s+/).length > MAX_HEADER_WORDS) return false;
	if (!/^[A-Za-z][A-Za-z\s&/'-]*$/.test(trimmed)) return false;
	return /^[A-Z]/.test(trimmed);
}
