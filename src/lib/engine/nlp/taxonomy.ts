import { canonicalize, DOMAINS, type Domain } from './synonyms';
import { uniqueTerms } from './tokenizer';

/**
 * Skills taxonomy (PRD §6.4).
 *
 * Powers the general-mode keyword score: with no job description, the keyword slot is filled
 * by how completely a resume covers its own industry's vocabulary rather than by a fabricated
 * constant (ADR 0001 §1).
 */

export interface IndustryMatch {
	industry: Domain;
	matchCount: number;
	/** Fraction of the industry's canonical vocabulary present in the text. */
	coverage: number;
}

/** Canonical terms belonging to an industry. */
export function getIndustrySkills(industry: Domain): string[] {
	return DOMAINS[industry].map((group) => group[0]).filter((t): t is string => t !== undefined);
}

/**
 * Multi-word terms cannot be found by single-token matching, so industry detection works on
 * the raw text for those and on tokens for the rest.
 */
function containsTerm(text: string, tokens: ReadonlySet<string>, term: string): boolean {
	if (term.includes(' ')) return text.includes(term);
	return tokens.has(term);
}

/** Industries ranked by how much of their vocabulary appears, strongest first. */
export function detectIndustry(text: string): IndustryMatch[] {
	const lower = text.toLowerCase();
	const tokens = new Set(uniqueTerms(text).map((t) => canonicalize(t)));

	const matches: IndustryMatch[] = [];

	for (const domain of Object.keys(DOMAINS) as Domain[]) {
		const skills = getIndustrySkills(domain);
		const present = skills.filter((skill) => containsTerm(lower, tokens, skill));

		if (present.length === 0) continue;

		matches.push({
			industry: domain,
			matchCount: present.length,
			coverage: present.length / skills.length
		});
	}

	return matches.sort((a, b) => b.matchCount - a.matchCount);
}

/** Which industry vocabulary a single term belongs to. */
export function getSkillDomain(skill: string): Domain | null {
	const canonical = canonicalize(skill);

	for (const domain of Object.keys(DOMAINS) as Domain[]) {
		if (getIndustrySkills(domain).includes(canonical)) return domain;
	}

	return null;
}

/**
 * Minimum matched terms before an industry is considered identified.
 *
 * Below this the signal is noise — one stray "sql" should not classify a nurse's resume as
 * technology. When nothing clears the bar the keyword term is dropped and its weight
 * redistributed instead (ADR 0001 §1).
 */
export const INDUSTRY_CONFIDENCE_MIN = 4;

/**
 * The industry a resume belongs to, plus that industry's full vocabulary.
 *
 * Deliberately does **not** decide what counts as a match: which terms a resume "has" depends
 * on the platform's keyword strategy, and Workday's exact matcher genuinely will not credit
 * "k8s" for "Kubernetes" where Lever's stemmer will. Returning the vocabulary lets the scorer
 * apply each platform's own matcher, keeping this module free of scoring concerns.
 */
export interface IndustryVocabulary {
	industry: Domain;
	skills: string[];
}

/**
 * Coverage ratio at which the dimension reaches 100.
 *
 * Nobody lists every term in their field, so requiring full coverage would put the ceiling
 * out of reach. But set too low and the opposite happens: at 0.25 a dense technical resume
 * saturated on all six platforms, hiding the difference between a strict matcher finding
 * 30 terms and a lenient one finding 35. 0.40 keeps a strong resume inside the range where
 * the strategies still separate.
 */
export const FULL_COVERAGE_RATIO = 0.4;

export function industryVocabulary(text: string): IndustryVocabulary | null {
	const top = detectIndustry(text)[0];
	if (!top || top.matchCount < INDUSTRY_CONFIDENCE_MIN) return null;

	return { industry: top.industry, skills: getIndustrySkills(top.industry) };
}

/** Turns a matched-term count into a 0-100 score. */
export function coverageScore(matchedCount: number, totalSkills: number): number {
	if (totalSkills === 0) return 0;
	const ratio = matchedCount / totalSkills;
	return Math.max(0, Math.min(100, Math.round((ratio / FULL_COVERAGE_RATIO) * 100)));
}
