import type { AtsProfile, ResumeAnalysis, SectionsBreakdown } from '../../types/scoring';

/**
 * Section completeness (PRD §7.6).
 *
 * `present` is the intersection of required and detected, not every detected section — the
 * literal reading of §7.6 lets a resume with 8 sections score 800 against Lever's single
 * requirement (ADR 0001 §7).
 */
export function scoreSections(analysis: ResumeAnalysis, profile: AtsProfile): SectionsBreakdown {
	const required = profile.requiredSections;

	const present = required.filter((type) => analysis.sectionSet.has(type));
	const missing = required.filter((type) => !analysis.sectionSet.has(type));

	// A profile with no required sections is vacuously satisfied.
	const score = required.length === 0 ? 100 : (present.length / required.length) * 100;

	return {
		score: Math.max(0, Math.min(100, Math.round(score))),
		present: [...present],
		missing: [...missing]
	};
}
