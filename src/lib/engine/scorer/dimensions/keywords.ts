import { industryCoverage } from '../../nlp/taxonomy';
import type { AtsProfile, KeywordBreakdown, ResumeAnalysis } from '../../types/scoring';
import { MATCHERS } from '../matching';

/**
 * Keyword match (PRD §7.5, as amended by ADR 0001 §1).
 *
 * Two modes:
 *
 * - **Targeted** (a job description was supplied): match the JD's requirement terms using the
 *   platform's strategy. Synonym hits count at 80% of an exact hit.
 * - **General** (no JD): score how completely the resume covers its own industry's
 *   vocabulary. PRD §7.5 returned a flat 100 here, which handed Taleo — the platform with the
 *   *highest* keyword weight — the largest free boost and pushed every clean resume to exactly
 *   100 on all six platforms. If no industry can be identified the caller drops the term and
 *   redistributes its weight instead.
 */

/** A synonym match is real but weaker evidence than the literal term. */
export const SYNONYM_CREDIT = 0.8;

export function scoreKeywords(analysis: ResumeAnalysis, profile: AtsProfile): KeywordBreakdown {
	if (analysis.jdTerms.length > 0) return scoreTargeted(analysis, profile);
	return scoreGeneral(analysis);
}

function scoreTargeted(analysis: ResumeAnalysis, profile: AtsProfile): KeywordBreakdown {
	const matcher = MATCHERS[profile.keywordStrategy];
	const resumeTerms = new Set(analysis.resumeTerms);

	const { matched, synonymMatched, missing } = matcher(
		analysis.jdTerms,
		resumeTerms,
		analysis.input.resumeText.toLowerCase()
	);

	const exactCount = matched.length - synonymMatched.length;
	const credited = exactCount + synonymMatched.length * SYNONYM_CREDIT;

	const score = Math.min(100, (credited / analysis.jdTerms.length) * 100);

	return {
		score: Math.max(0, Math.round(score)),
		matched,
		missing,
		synonymMatched,
		isIndustryProxy: false
	};
}

function scoreGeneral(analysis: ResumeAnalysis): KeywordBreakdown {
	const coverage = industryCoverage(analysis.input.resumeText);

	// No identifiable industry. The caller treats a proxy score of 0 with no matches as
	// "inactive" and renormalises the remaining weights rather than scoring this as a failure.
	if (!coverage) {
		return { score: 0, matched: [], missing: [], synonymMatched: [], isIndustryProxy: true };
	}

	return {
		score: coverage.score,
		matched: coverage.matched,
		// Only the most useful absent terms; the full list is dozens long and unhelpful.
		missing: coverage.missing.slice(0, 12),
		synonymMatched: [],
		isIndustryProxy: true
	};
}

/**
 * Whether the keyword dimension carries usable signal for this resume.
 *
 * False only when there is no JD *and* no industry could be identified — the one case where
 * scoring the slot at all would be inventing a number.
 */
export function keywordsActive(analysis: ResumeAnalysis): boolean {
	if (analysis.jdTerms.length > 0) return true;
	return industryCoverage(analysis.input.resumeText) !== null;
}
