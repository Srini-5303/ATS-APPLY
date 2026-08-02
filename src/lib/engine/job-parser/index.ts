import { canonicalize, DOMAINS, type Domain } from '../nlp/synonyms';
import { detectIndustry, getIndustrySkills, getSkillDomain } from '../nlp/taxonomy';
import { uniqueTerms } from '../nlp/tokenizer';

/**
 * Job description parsing.
 *
 * Extracts the terms a resume is actually scored against. The key decision is *which* terms:
 * PRD §7.5 divides by `totalJdTerms` without ever defining it, and taking every token would
 * mean a 700-word posting yields ~350 terms that no resume matches a meaningful fraction of,
 * collapsing every score into the teens.
 *
 * So the denominator is the set of recognised skill and technology terms — the things a
 * recruiter would actually screen on.
 */

export interface ParsedJobDescription {
	requiredSkills: string[];
	preferredSkills: string[];
	experienceLevel: string | null;
	educationRequirement: string | null;
	industry: Domain | null;
	rawTermCount: number;
}

const REQUIRED_MARKER =
	/\b(?:required|requirements|must have|must-have|essential|minimum|qualifications)\b/i;
const PREFERRED_MARKER = /\b(?:preferred|nice to have|nice-to-have|bonus|a plus|desirable)\b/i;

const EXPERIENCE_LEVEL =
	/\b\d{1,2}\+?\s*(?:-\s*\d{1,2}\s*)?years?\b[^.\n]{0,40}?\bexperience\b|\b(?:entry[- ]level|junior|mid[- ]level|senior|staff|principal|lead|director|executive)\b/i;

const EDUCATION_REQUIREMENT =
	/\b(?:bachelor(?:'s)?|master(?:'s)?|ph\.?d|doctorate|associate(?:'s)?|b\.?sc?|m\.?sc?|m\.?b\.?a)\b[^.\n]{0,60}/i;

/**
 * Canonical terms containing a space, derived from the taxonomy so the list cannot drift.
 * These never survive tokenisation and have to be matched against raw text.
 */
const MULTI_WORD_TERMS: readonly string[] = (() => {
	const terms = new Set<string>();
	for (const domain of Object.keys(DOMAINS) as Domain[]) {
		for (const skill of getIndustrySkills(domain)) {
			if (skill.includes(' ')) terms.add(skill);
		}
	}
	return [...terms];
})();

/** Recognised skill terms in a span of text. */
function skillTermsIn(text: string): string[] {
	const found = new Set<string>();

	for (const term of uniqueTerms(text)) {
		const canonical = canonicalize(term);
		if (getSkillDomain(canonical)) found.add(canonical);
	}

	const lower = text.toLowerCase();
	for (const canonical of MULTI_WORD_TERMS) {
		if (lower.includes(canonical)) found.add(canonical);
	}

	return [...found];
}

export function parseJobDescription(text: string): ParsedJobDescription {
	const required = new Set<string>();
	const preferred = new Set<string>();

	// Skills inherit the most recent required/preferred heading above them.
	let inPreferredSection = false;

	for (const line of text.split('\n')) {
		if (REQUIRED_MARKER.test(line)) inPreferredSection = false;
		else if (PREFERRED_MARKER.test(line)) inPreferredSection = true;

		const target = inPreferredSection ? preferred : required;
		for (const skill of skillTermsIn(line)) target.add(skill);
	}

	// A term appearing in both sections is required.
	for (const skill of required) preferred.delete(skill);

	return {
		requiredSkills: [...required],
		preferredSkills: [...preferred],
		experienceLevel: EXPERIENCE_LEVEL.exec(text)?.[0].trim() ?? null,
		educationRequirement: EDUCATION_REQUIREMENT.exec(text)?.[0].trim() ?? null,
		industry: detectIndustry(text)[0]?.industry ?? null,
		rawTermCount: uniqueTerms(text).length
	};
}

/** The scoring denominator: everything the posting asks for, required first. */
export function scoringTerms(parsed: ParsedJobDescription): string[] {
	return [...parsed.requiredSkills, ...parsed.preferredSkills];
}
