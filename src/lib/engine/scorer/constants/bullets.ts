/** Bullet-derived constants — PRD §7.7, §7.9. */

/**
 * Experience sub-score tiers by bullet count.
 *
 * PRD §7.7 split experience 40/30/30 across quantification, action verbs and bullet count.
 * Quantification is now its own dimension (ADR 0001 §5), so its 40 points redistribute
 * evenly: action verbs 50, bullet count 50. These tiers are §7.7's 30/25/20/10 rescaled to
 * that 50-point ceiling.
 */
export const BULLET_COUNT_TIERS: readonly { min: number; points: number }[] = [
	{ min: 8, points: 50 },
	{ min: 5, points: 42 },
	{ min: 3, points: 33 },
	{ min: 0, points: 17 }
];

/** Maximum points from the action-verb sub-score. */
export const ACTION_VERB_MAX_POINTS = 50;

/** Ratio of bullets starting with an action verb at which that sub-score saturates. */
export const ACTION_VERB_SATURATION_RATIO = 0.7;

/** Lever's narrative-quality band: long enough to carry context, short enough to scan. */
export const LEVER_BULLET_MIN = 60;
export const LEVER_BULLET_MAX = 150;
