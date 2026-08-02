import type { ExperienceBreakdown, ResumeAnalysis } from '../../types/scoring';
import {
	ACTION_VERB_MAX_POINTS,
	ACTION_VERB_SATURATION_RATIO,
	BULLET_COUNT_TIERS
} from '../constants/bullets';

/**
 * Experience quality (PRD §7.7, rebalanced by ADR 0001 §5).
 *
 * Quantification used to take 40 of these 100 points *and* carry its own weight in §7.3,
 * double-counting the same signal. It is now a standalone dimension, so the 100 points here
 * split evenly between action verbs and bullet volume.
 */
export function scoreExperience(analysis: ResumeAnalysis): ExperienceBreakdown {
	const total = analysis.bullets.length;

	// Zero-guard. A resume with no bullets is the exact input that produced NaN under the
	// PRD's unguarded ratio (ADR 0001 §4).
	const actionVerbPoints =
		total === 0
			? 0
			: Math.min(1, analysis.actionVerbBulletCount / total / ACTION_VERB_SATURATION_RATIO) *
				ACTION_VERB_MAX_POINTS;

	const tier = BULLET_COUNT_TIERS.find((t) => total >= t.min);
	const bulletPoints = total === 0 ? 0 : (tier?.points ?? 0);

	const highlights = analysis.bullets
		.filter((b) => b.startsWithActionVerb && b.isQuantified)
		.slice(0, 3)
		.map((b) => b.text);

	return {
		score: Math.max(0, Math.min(100, Math.round(actionVerbPoints + bulletPoints))),
		totalBullets: total,
		actionVerbCount: analysis.actionVerbBulletCount,
		highlights
	};
}
