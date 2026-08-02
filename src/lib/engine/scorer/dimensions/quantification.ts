import type { QuantificationBreakdown, ResumeAnalysis } from '../../types/scoring';
import { QUANT_SATURATION_RATIO } from '../constants/quantification';

/**
 * Quantification as a first-class dimension (ADR 0001 §5).
 *
 * PRD §7.3 gave it a weight of up to 0.20 but §7.2 left it out of the breakdown entirely and
 * §12.2's card drew only five bars — so the signal driving ~30% of Greenhouse's score was
 * invisible to the user. It has its own field and its own bar now.
 */
export function scoreQuantification(analysis: ResumeAnalysis): QuantificationBreakdown {
	const total = analysis.bullets.length;
	const quantified = analysis.quantifiedBulletCount;

	// Zero-guard (ADR 0001 §4).
	const ratio = total === 0 ? 0 : quantified / total;
	const score = Math.min(100, (ratio / QUANT_SATURATION_RATIO) * 100);

	return {
		score: Math.max(0, Math.min(100, Math.round(score))),
		quantifiedBullets: quantified,
		totalBullets: total,
		examples: analysis.bullets
			.filter((b) => b.isQuantified)
			.slice(0, 3)
			.map((b) => b.text)
	};
}
