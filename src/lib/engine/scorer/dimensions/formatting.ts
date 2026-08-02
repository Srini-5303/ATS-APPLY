import type { AtsProfile, FormattingBreakdown, ResumeAnalysis } from '../../types/scoring';
import { FORMATTING_PENALTIES } from '../constants/formatting-penalties';

/**
 * Deduction model (PRD §7.4): start at 100 and subtract, each penalty scaled by the
 * platform's parsing strictness.
 *
 * Note there is no `switch (profile.id)` here and there must never be — strictness alone
 * produces the per-platform spread.
 */
export function scoreFormatting(
	analysis: ResumeAnalysis,
	profile: AtsProfile
): FormattingBreakdown {
	const issues: string[] = [];
	const details: string[] = [];
	let score = 100;

	for (const penalty of FORMATTING_PENALTIES) {
		if (!penalty.test(analysis)) continue;

		const base = typeof penalty.points === 'function' ? penalty.points(analysis) : penalty.points;
		if (base <= 0) continue;

		score -= base * profile.parsingStrictness;
		issues.push(penalty.issue);
		details.push(penalty.detail);
	}

	if (issues.length === 0) {
		details.push('Clean single-column layout with no parsing obstacles detected.');
	}

	return {
		score: Math.max(0, Math.min(100, Math.round(score))),
		issues,
		details
	};
}
