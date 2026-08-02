import type { Dimension, EducationBreakdown, KeywordBreakdown } from '../../types/scoring';

/**
 * Dimensions not yet implemented in the walking skeleton.
 *
 * They return a sentinel 0 rather than a plausible-looking 75. A placeholder that looks like
 * a real score hides integration bugs behind cards that appear correct; a visible zero plus
 * the `STUBBED_DIMENSIONS` marker below forces the UI to say so out loud.
 *
 * Delete this file in Phase 3 — the type checker will point at every call site.
 */
export const STUBBED_DIMENSIONS: ReadonlySet<Dimension> = new Set<Dimension>([
	'keywordMatch',
	'education'
]);

/** Phase 3: JD matching plus the industry-coverage proxy for general mode (ADR 0001 §1). */
export function scoreKeywordsStub(): KeywordBreakdown {
	return {
		score: 0,
		matched: [],
		missing: [],
		synonymMatched: [],
		isIndustryProxy: false
	};
}

/** Phase 2 populates EducationEntry[]; Phase 3 scores it against PRD §7.8's component table. */
export function scoreEducationStub(): EducationBreakdown {
	return { score: 0, notes: [] };
}
