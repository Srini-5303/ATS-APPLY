import { describe, expect, it } from 'vitest';
import { buildAnalysis } from '$engine/scorer';
import { scoreEducation } from '$engine/scorer/dimensions/education';
import { SECTION_TYPES, type EducationEntry, type SectionType } from '$engine/types/parser';
import type { ScoringInput } from '$engine/types/scoring';

function entry(overrides: Partial<EducationEntry> = {}): EducationEntry {
	return {
		degree: null,
		field: null,
		institution: null,
		dates: null,
		gpa: null,
		honors: [],
		...overrides
	};
}

function analyse(education: EducationEntry[], sections: SectionType[] = ['education']) {
	const sectionCounts = Object.fromEntries(SECTION_TYPES.map((t) => [t, 0])) as Record<
		SectionType,
		number
	>;
	const input: ScoringInput = {
		resumeText: '',
		resumeSkills: [],
		resumeSections: sections,
		experience: [],
		education,
		projects: [],
		summary: null,
		sectionCounts,
		hasMultipleColumns: false,
		hasTables: false,
		hasImages: false,
		pageCount: 1,
		wordCount: 400
	};
	return buildAnalysis(input);
}

const COMPLETE = entry({
	degree: 'B.S.',
	field: 'Computer Science',
	institution: 'UC Berkeley',
	dates: { start: '2018', end: null, isCurrent: false },
	gpa: '3.8',
	honors: ["dean's list"]
});

describe('education scoring', () => {
	it('awards full marks for a complete entry', () => {
		expect(scoreEducation(analyse([COMPLETE])).score).toBe(100);
	});

	it.each([
		['degree', 30],
		['institution', 20],
		['dates', 15],
		['field', 15],
		['gpa', 10],
		['honors', 10]
	])('deducts %i points when %s is missing', (field, points) => {
		const partial = { ...COMPLETE, [field]: field === 'honors' ? [] : null };
		expect(scoreEducation(analyse([partial])).score).toBe(100 - points);
	});

	it('scores zero and says why when no entry parsed', () => {
		const result = scoreEducation(analyse([], []));
		expect(result.score).toBe(0);
		expect(result.notes[0]).toContain('No education section');
	});

	it('distinguishes an unparseable section from an absent one', () => {
		// Different problems, different fixes: one means "add a section", the other means
		// "reformat the one you have".
		const result = scoreEducation(analyse([], ['education']));
		expect(result.notes[0]).toContain('could be read');
	});

	it('takes the best entry, not the last', () => {
		// A candidate is not penalised for listing a high school under a doctorate.
		const weak = entry({ institution: 'Some High School' });
		expect(scoreEducation(analyse([COMPLETE, weak])).score).toBe(100);
		expect(scoreEducation(analyse([weak, COMPLETE])).score).toBe(100);
	});

	it('advises omitting a weak GPA', () => {
		const notes = scoreEducation(analyse([{ ...COMPLETE, gpa: '2.4' }])).notes;
		expect(notes.join(' ')).toContain('below 3.0');
	});

	it('endorses a strong GPA', () => {
		expect(scoreEducation(analyse([COMPLETE])).notes.join(' ')).toContain('worth keeping');
	});

	it('calls out an advanced degree', () => {
		const phd = { ...COMPLETE, degree: 'PhD' };
		expect(scoreEducation(analyse([phd])).notes.join(' ')).toContain('advanced degree');
	});

	it('never returns a score outside 0-100', () => {
		for (const e of [COMPLETE, entry(), entry({ degree: 'B.S.' })]) {
			const score = scoreEducation(analyse([e])).score;
			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(100);
		}
	});
});
