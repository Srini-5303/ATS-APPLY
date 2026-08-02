/** Quantification detection — PRD §7.7, promoted to a standalone dimension by ADR 0001 §5. */

/** The nine patterns from PRD §7.7 that mark a bullet as carrying a concrete result. */
export const QUANT_PATTERNS: readonly RegExp[] = [
	/\d+\s*%/, // percentages
	/\$\s?[\d,]+/, // dollar amounts
	/\d+\s*(?:x\b|times\b)/i, // multipliers
	// Headcount. Deliberately broad: "engineers", "developers" and "reports" are at least as
	// common on a resume as the PRD's original "users/customers/employees".
	/\d+\s*(?:users?|customers?|clients?|employees?|members?|people|teams?|engineers?|developers?|designers?|analysts?|contractors?|staff|reports?|students?|patients?)\b/i,
	/\d+\s*(?:projects?|products?|applications?|systems?|services?|features?)\b/i,
	/(?:top|first|#)\s*\d+/i, // rankings
	/\d+\s*(?:hours?|days?|weeks?|months?|years?)\b/i, // durations
	/\d{1,3}(?:,\d{3})+/, // large comma-grouped numbers
	/\d+\s*(?:million|billion|thousand|[kmb])\b/i // scaled numbers
];

/**
 * Ratio of quantified bullets at which the dimension reaches 100.
 *
 * PRD §7.7 implied 0.4, which saturates far too early — a resume with every bullet
 * quantified scored the same as one with 40%, flattening the whole top of the range. 0.5 was
 * still too generous for the same reason.
 *
 * 0.75 means three bullets in four must carry a concrete result for full marks: demanding but
 * achievable, and it keeps the top of the range discriminating. Retuned against the fixture
 * corpus in Phase 3; a named constant so that is a one-line change.
 */
export const QUANT_SATURATION_RATIO = 0.75;

/** Threshold for Greenhouse's quantification bonus (PRD §7.9). */
export const QUANT_BONUS_RATIO = 0.4;
