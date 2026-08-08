import type { Dimension, ScoreResult } from '$engine/types/scoring';

/**
 * The evidence behind one dimension score, in plain sentences.
 *
 * Shared by the on-screen detail view and the PDF export. It started inside the Svelte
 * component, which meant the report a user downloads and the panel they read on screen would
 * have drifted the first time either was edited — the screen saying "matched 14 of 21
 * requirements" while the printout said only "68".
 *
 * Facts only. Anything prescriptive belongs in a suggestion, so the two never say the same
 * thing twice in one panel.
 */

export const DIMENSION_LABELS: Record<Dimension, string> = {
	formatting: 'Formatting',
	keywordMatch: 'Keywords',
	sections: 'Sections',
	experience: 'Experience',
	education: 'Education',
	quantification: 'Quantification'
};

/** At or above this a score reads as healthy. One threshold across the whole report. */
export const STRONG_SCORE = 75;

/** At most this many terms before a list stops being readable. */
const SAMPLE = 12;

function sample(terms: string[]): string {
	const rest = terms.length - SAMPLE;
	const head = terms.slice(0, SAMPLE).join(', ');
	return rest > 0 ? `${head} + ${String(rest)} more` : head;
}

/**
 * What to call a dimension for this result.
 *
 * With no job description the keyword slot measures industry-vocabulary coverage rather than
 * JD matching, so it is labelled for what it actually shows (ADR 0001 §1).
 */
export function labelFor(result: ScoreResult, dimension: Dimension): string {
	if (dimension === 'keywordMatch' && result.breakdown.keywordMatch.isIndustryProxy) {
		return 'Industry terms';
	}
	return DIMENSION_LABELS[dimension];
}

export function dimensionEvidence(result: ScoreResult, dimension: Dimension): string[] {
	const b = result.breakdown;

	switch (dimension) {
		case 'formatting':
			return b.formatting.issues.length === 0
				? ['Nothing in the layout tripped this parser.']
				: b.formatting.details;

		case 'keywordMatch': {
			const noun = b.keywordMatch.isIndustryProxy ? 'industry terms' : 'requirements';
			const lines = [
				`Matched ${String(b.keywordMatch.matched.length)} of ${String(
					b.keywordMatch.matched.length + b.keywordMatch.missing.length
				)} ${noun}.`
			];
			if (b.keywordMatch.matched.length > 0) {
				lines.push(`Found: ${sample(b.keywordMatch.matched)}.`);
			}
			if (b.keywordMatch.missing.length > 0) {
				lines.push(`Absent: ${sample(b.keywordMatch.missing)}.`);
			}
			if (b.keywordMatch.synonymMatched.length > 0) {
				lines.push(
					`Credited at a discount because the wording differs: ${sample(b.keywordMatch.synonymMatched)}.`
				);
			}
			return lines;
		}

		case 'sections': {
			const lines = [`Found: ${b.sections.present.join(', ') || 'none'}.`];
			if (b.sections.missing.length > 0) {
				lines.push(`This platform also expects: ${b.sections.missing.join(', ')}.`);
			}
			return lines;
		}

		case 'experience':
			if (b.experience.totalBullets === 0) return ['No bullet points were found under your roles.'];
			return [
				`${String(b.experience.actionVerbCount)} of ${String(b.experience.totalBullets)} bullets open with a strong action verb.`,
				// Label once, then quote. Repeating "Strongest:" on every line reads as a stutter.
				...(b.experience.highlights.length > 0
					? ['Your strongest bullets:', ...b.experience.highlights.map((h) => `“${h}”`)]
					: [])
			];

		case 'education':
			return b.education.notes.length > 0 ? b.education.notes : ['Nothing missing here.'];

		case 'quantification': {
			if (b.quantification.totalBullets === 0) return ['No bullet points to measure.'];

			// A bullet that both opens with an action verb and carries a figure qualifies as an
			// experience highlight *and* a quantification example, so the two rows were quoting the
			// same lines a few centimetres apart. Show only what the row above did not.
			const alreadyShown = new Set(b.experience.highlights);
			const fresh = b.quantification.examples.filter((e) => !alreadyShown.has(e));

			return [
				`${String(b.quantification.quantifiedBullets)} of ${String(b.quantification.totalBullets)} bullets carry a concrete figure.`,
				...(fresh.length > 0 ? ['Counted here:', ...fresh.map((e) => `“${e}”`)] : [])
			];
		}
	}
}
