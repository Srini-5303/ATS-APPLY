import { degreeLevel } from '../../parser/entries';
import type { EducationEntry } from '../../types/parser';
import type { EducationBreakdown, ResumeAnalysis } from '../../types/scoring';

/**
 * Education (PRD §7.8).
 *
 * A component table rather than branching logic: each field present earns its points, and the
 * best single entry decides the score — a candidate is not penalised for listing a high
 * school alongside a doctorate.
 */

export const EDUCATION_COMPONENTS: readonly {
	readonly id: string;
	readonly points: number;
	readonly present: (entry: EducationEntry) => boolean;
}[] = [
	{ id: 'degree', points: 30, present: (e) => Boolean(e.degree) },
	{ id: 'institution', points: 20, present: (e) => Boolean(e.institution) },
	{ id: 'dates', points: 15, present: (e) => Boolean(e.dates?.start) },
	{ id: 'field', points: 15, present: (e) => Boolean(e.field) },
	{ id: 'gpa', points: 10, present: (e) => Boolean(e.gpa) },
	{ id: 'honors', points: 10, present: (e) => e.honors.length > 0 }
];

function pointsFor(entry: EducationEntry): number {
	return EDUCATION_COMPONENTS.reduce((sum, c) => sum + (c.present(entry) ? c.points : 0), 0);
}

/** Below this a GPA is better left off the resume than stated. */
export const GPA_WEAK = 3.0;
/** At or above this a GPA is worth calling out. */
export const GPA_STRONG = 3.5;

/** A degree written out in words rather than as an initialism. */
const SPELLED_OUT_DEGREE = /\b(?:bachelor|master|doctor|doctorate|associate|diploma)\b/i;

/**
 * True when the degree is given only as an initialism — "M.S." rather than "Master of Science".
 *
 * Literal and OCR-based parsers index the string they read. "M.S." with periods is a different
 * token from "MS", which is a different token from "Master of Science", and a requisition
 * asking for the last of those matches none of the others. Platforms declare how much they
 * care via a quirk rather than this scorer branching on the platform.
 */
export function isAbbreviatedDegree(degree: string | null | undefined): boolean {
	if (!degree) return false;
	return !SPELLED_OUT_DEGREE.test(degree);
}

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

	// Ties go to the earliest entry, which is conventionally the most recent degree.
	const best = entries.reduce((a, b) => (pointsFor(b) > pointsFor(a) ? b : a));

	if (!best.degree)
		notes.push('State the degree explicitly, e.g. "B.S." or "Bachelor of Science".');
	if (!best.institution) notes.push('Name the institution on the same line as the degree.');
	if (!best.dates?.start) notes.push('Add a graduation year.');
	if (!best.field) notes.push('Name the field of study.');

	const gpa = best.gpa ? Number.parseFloat(best.gpa) : null;
	if (gpa !== null && Number.isFinite(gpa)) {
		if (gpa >= GPA_STRONG) notes.push(`GPA of ${best.gpa ?? ''} is worth keeping.`);
		else if (gpa < GPA_WEAK) notes.push('A GPA below 3.0 is usually better omitted.');
	} else {
		notes.push('No GPA was found. Worth stating if it is 3.5 or above — 10 points here.');
	}

	// The two components a complete entry usually lacks had no note at all, so a 90 arrived
	// with nothing explaining the missing 10.
	if (best.honors.length === 0) {
		notes.push(
			'No honors were found. If you have one — Dean’s List, cum laude, a named scholarship ' +
				'or fellowship — list it; it is the last 10 points of this dimension.'
		);
	}

	if (degreeLevel(best.degree) >= 4) {
		notes.push('An advanced degree is a differentiator; keep it near the top of the section.');
	}

	return { score: Math.max(0, Math.min(100, pointsFor(best))), notes };
}
