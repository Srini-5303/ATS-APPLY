import { coverageScore, industryVocabulary } from '../../nlp/taxonomy';
import type { AtsProfile, KeywordBreakdown, ResumeAnalysis } from '../../types/scoring';
import { MATCHERS, type MatchOutcome } from '../matching';

/**
 * Keyword match (PRD §7.5, as amended by ADR 0001 §1).
 *
 * Two modes, both of which run the **platform's own matching strategy**:
 *
 * - **Targeted** (a job description was supplied): match the posting's requirement terms.
 * - **General** (no posting): match the resume against its own industry's vocabulary. PRD
 *   §7.5 returned a flat 100 here, which handed Taleo — the platform with the *highest*
 *   keyword weight — the largest free boost and pushed every clean resume to exactly 100 on
 *   all six platforms.
 *
 * Running the strategy in general mode matters as much as in targeted mode: it is the single
 * largest behavioural difference between these systems. Workday's exact matcher will not
 * credit "k8s" for "Kubernetes"; Lever's stemming-based one will. Without it, general mode
 * produced an identical keyword score on all six platforms and the cards barely differed.
 */

/** A synonym match is real but weaker evidence than the literal term. */
export const SYNONYM_CREDIT = 0.8;

/**
 * How much a required term outweighs a preferred one.
 *
 * 2 rather than something larger: a posting's "Nice to have" list is still signal a recruiter
 * screens on, and driving the weight up far enough to make optional terms nearly free would
 * let a resume ignore half the posting and still score in the nineties.
 */
export const REQUIRED_TERM_WEIGHT = 2;

export function scoreKeywords(analysis: ResumeAnalysis, profile: AtsProfile): KeywordBreakdown {
	if (analysis.jdTerms.length > 0) return scoreTargeted(analysis, profile);
	return scoreGeneral(analysis, profile);
}

/** Runs the platform's own strategy over `terms`; the resume side is the same either way. */
function match(analysis: ResumeAnalysis, profile: AtsProfile, terms: string[]): MatchOutcome {
	return MATCHERS[profile.keywordStrategy](
		terms,
		new Set(analysis.resumeTerms),
		analysis.input.resumeText.toLowerCase()
	);
}

/** Credit earned by `terms`, counting a synonym-only match at a discount. */
function credit(
	terms: string[],
	synonymMatched: string[],
	weightOf: (term: string) => number
): number {
	const loose = new Set(synonymMatched);
	return terms.reduce(
		(sum, term) => sum + weightOf(term) * (loose.has(term) ? SYNONYM_CREDIT : 1),
		0
	);
}

/** Every term counts the same. Used in general mode, where nothing marks a term as required. */
const UNWEIGHTED = (): number => 1;

function scoreTargeted(analysis: ResumeAnalysis, profile: AtsProfile): KeywordBreakdown {
	const { matched, synonymMatched, missing } = match(analysis, profile, analysis.jdTerms);

	// A term the posting lists under "Requirements" counts for more than one under "Nice to
	// have". Both the numerator and the denominator are weighted, so a resume matching every
	// required term and no optional one still scores well rather than being capped by the
	// count of things it was never asked for.
	const weightOf = (term: string): number =>
		analysis.jdRequiredTerms.has(term) ? REQUIRED_TERM_WEIGHT : 1;

	const earned = credit(matched, synonymMatched, weightOf);
	const possible = analysis.jdTerms.reduce((sum, term) => sum + weightOf(term), 0);

	const score = possible === 0 ? 0 : Math.min(100, (earned / possible) * 100);

	return {
		score: Math.max(0, Math.round(score)),
		matched,
		missing,
		synonymMatched,
		isIndustryProxy: false
	};
}

function scoreGeneral(analysis: ResumeAnalysis, profile: AtsProfile): KeywordBreakdown {
	const vocabulary = industryVocabulary(analysis.input.resumeText);

	// No identifiable industry. The caller treats this as inactive and redistributes the
	// weight rather than scoring an unfixable zero.
	if (!vocabulary) {
		return { score: 0, matched: [], missing: [], synonymMatched: [], isIndustryProxy: true };
	}

	const { matched, synonymMatched, missing } = match(analysis, profile, vocabulary.skills);

	return {
		score: coverageScore(credit(matched, synonymMatched, UNWEIGHTED), vocabulary.skills.length),
		matched,
		// Only the most useful absent terms; the full list runs to dozens and helps nobody.
		missing: missing.slice(0, 12),
		synonymMatched,
		isIndustryProxy: true
	};
}

/**
 * Whether the keyword dimension carries usable signal for this resume.
 *
 * False only when there is no posting *and* no industry could be identified — the one case
 * where scoring the slot at all would be inventing a number.
 */
export function keywordsActive(analysis: ResumeAnalysis): boolean {
	if (analysis.jdTerms.length > 0) return true;
	return industryVocabulary(analysis.input.resumeText) !== null;
}
