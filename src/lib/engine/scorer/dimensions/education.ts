import { degreeLevel } from '../../parser/entries';
import type { EducationBreakdown, ResumeAnalysis } from '../../types/scoring';

/**
 * Education (PRD §7.8).
 *
 * A component table rather than branching logic: each field present earns its points, and the
 * best single entry decides the score — a candidate is not penalised for listing a high
 * school alongside a doctorate.
 */

export const EDUCATION_COMPONENTS = [
	{ id: 'degree', points: 30 },
	{ id: 'institution', points: 20 },
	{ id: 'dates', points: 15 },
	{ id: 'field', points: 15 },
	{ id: 'gpa', points: 10 },
	{ id: 'honors', points: 10 }
] as const;

/** Below this a GPA is better left off the resume than stated. */
export const GPA_WEAK = 3.0;
/** At or above this a GPA is worth calling out. */
export const GPA_STRONG = 3.5;

export function scoreEducation(analysis: ResumeAnalysis): EducationBreakdown {
	const entries = analysis.input.education;
	const notes: string[] = [];

	if (entries.length === 0) {
		// Distinguish "no Education section at all" from "a section we could not parse" — the
		// fixes are different.
		notes.push(
			analysis.sectionSet.has('education')
				? 'An education section was found, but no degree or institution could be read from it.'
				: 'No education section was detected.'
		);
		return { score: 0, notes };
	}

	let best = 0;
	let bestEntry = entries[0];

	for (const entry of entries) {
		let points = 0;
		if (entry.degree) points += 30;
		if (entry.institution) points += 20;
		if (entry.dates?.start) points += 15;
		if (entry.field) points += 15;
		if (entry.gpa) points += 10;
		if (entry.honors.length > 0) points += 10;

		if (points > best) {
			best = points;
			bestEntry = entry;
		}
	}

	if (bestEntry) {
		if (!bestEntry.degree)
			notes.push('State the degree explicitly, e.g. "B.S." or "Bachelor of Science".');
		if (!bestEntry.institution) notes.push('Name the institution on the same line as the degree.');
		if (!bestEntry.dates?.start) notes.push('Add a graduation year.');
		if (!bestEntry.field) notes.push('Name the field of study.');

		const gpa = bestEntry.gpa ? Number.parseFloat(bestEntry.gpa) : null;
		if (gpa !== null && Number.isFinite(gpa)) {
			if (gpa >= GPA_STRONG) notes.push(`GPA of ${bestEntry.gpa ?? ''} is worth keeping.`);
			else if (gpa < GPA_WEAK) notes.push('A GPA below 3.0 is usually better omitted.');
		}

		if (degreeLevel(bestEntry.degree) >= 4) {
			notes.push('An advanced degree is a differentiator; keep it near the top of the section.');
		}
	}

	return { score: Math.max(0, Math.min(100, best)), notes };
}
