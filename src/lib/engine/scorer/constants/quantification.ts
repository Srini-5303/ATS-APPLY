/** Quantification detection — PRD §7.7, promoted to a standalone dimension by ADR 0001 §5. */

/** The nine patterns from PRD §7.7 that mark a bullet as carrying a concrete result. */
export const QUANT_PATTERNS: readonly RegExp[] = [
	/\d+\s*%/, // percentages
	/\$\s?[\d,]+/, // dollar amounts
	/\d+\s*(?:x\b|times\b)/i, // multipliers
	/\d+\s*(?:users?|customers?|clients?|employees?|members?|people|teams?)\b/i,
	/\d+\s*(?:projects?|products?|applications?|systems?|services?|features?)\b/i,
	/(?:top|first|#)\s*\d+/i, // rankings
	/\d+\s*(?:hours?|days?|weeks?|months?|years?)\b/i, // durations
	/\d{1,3}(?:,\d{3})+/, // large comma-grouped numbers
	/\d+\s*(?:million|billion|thousand|[kmb])\b/i // scaled numbers
];

/**
 * Ratio of quantified bullets at which the dimension reaches 100.
 *
 * PRD §7.7 implied 0.4, which saturates too early — a resume with every bullet quantified
 * would score the same as one with 40%, flattening the top of the range. Tuned against the
 * fixture corpus in Phase 3; kept as a named constant so tuning is a one-line change.
 */
export const QUANT_SATURATION_RATIO = 0.5;

/** Threshold for Greenhouse's quantification bonus (PRD §7.9). */
export const QUANT_BONUS_RATIO = 0.4;
