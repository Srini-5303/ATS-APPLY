import { describe, expect, it } from 'vitest';
import { scoreResume } from '$engine/scorer';
import { DIMENSIONS, type ScoreResult, type ScoringInput } from '$engine/types/scoring';
import { SECTION_TYPES, type SectionType } from '$engine/types/parser';
import { dimensionEvidence, labelFor } from '$utils/evidence';

function makeInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
	const sectionCounts = Object.fromEntries(SECTION_TYPES.map((t) => [t, 0])) as Record<
		SectionType,
		number
	>;
	return {
		resumeText: '',
		resumeSkills: [],
		resumeSections: [],
		experience: [],
		education: [],
		projects: [],
		summary: null,
		sectionCounts,
		hasMultipleColumns: false,
		hasTables: false,
		hasImages: false,
		pageCount: 1,
		wordCount: 400,
		...overrides
	};
}

const STRONG = makeInput({
	resumeText: [
		'EXPERIENCE',
		'- Reduced p99 latency by 42% across 120 Kubernetes services',
		'- Built a Go pipeline processing 1,200,000 events per minute',
		'- Migrated PostgreSQL and Redis workloads to AWS with Terraform'
	].join('\n'),
	resumeSkills: ['Go', 'Kubernetes', 'PostgreSQL', 'Redis', 'AWS', 'Terraform'],
	resumeSections: ['contact', 'experience', 'education', 'skills']
});

function first(input: ScoringInput): ScoreResult {
	const [result] = scoreResume(input);
	if (!result) throw new Error('scoreResume returned nothing');
	return result;
}

/**
 * The evidence module is shared by the on-screen detail view and the PDF export, so a change
 * here moves both at once. That is the point of it living outside the component — and the
 * reason it is worth pinning.
 */
describe('dimensionEvidence', () => {
	it('never returns an empty list for any dimension', () => {
		// A dimension row that renders no evidence is a blank block on screen and a stranded
		// heading in the PDF. Every branch has to say something, including the empty cases.
		for (const input of [STRONG, makeInput()]) {
			const result = first(input);
			for (const dimension of DIMENSIONS) {
				const lines = dimensionEvidence(result, dimension);
				expect(lines.length, `${dimension} produced nothing`).toBeGreaterThan(0);
				for (const line of lines) expect(line.trim()).not.toBe('');
			}
		}
	});

	it('reports the counts behind the experience score', () => {
		const lines = dimensionEvidence(first(STRONG), 'experience').join(' ');
		expect(lines).toMatch(/\d+ of \d+ bullets open with a strong action verb/);
	});

	it('does not re-quote a bullet the experience row already showed', () => {
		// A bullet that both opens with an action verb and carries a figure qualifies as an
		// experience highlight and a quantification example, so the two rows quoted the same
		// lines centimetres apart.
		const result = first(STRONG);
		const highlights = new Set(result.breakdown.experience.highlights);
		expect(highlights.size).toBeGreaterThan(0);

		for (const line of dimensionEvidence(result, 'quantification')) {
			for (const highlight of highlights) expect(line).not.toContain(highlight);
		}
	});

	it('names the sections this platform expects but did not find', () => {
		const result = first(makeInput({ resumeText: 'EXPERIENCE\n- Did work', resumeSections: [] }));
		const lines = dimensionEvidence(result, 'sections').join(' ');
		expect(lines).toContain('also expects');
	});

	it('says the layout is clean rather than listing nothing', () => {
		const lines = dimensionEvidence(first(STRONG), 'formatting');
		expect(lines.join(' ')).toContain('Nothing in the layout');
	});
});

describe('labelFor', () => {
	it('calls the keyword slot what it actually measures', () => {
		// With no posting the slot scores industry-vocabulary coverage, not JD matching
		// (ADR 0001 §1), and labelling it "Keywords" would misrepresent the number.
		const general = first(STRONG);
		expect(general.breakdown.keywordMatch.isIndustryProxy).toBe(true);
		expect(labelFor(general, 'keywordMatch')).toBe('Industry terms');

		const targeted = first(
			makeInput({ ...STRONG, jobDescription: 'Requirements: Go, Kubernetes, PostgreSQL' })
		);
		expect(targeted.breakdown.keywordMatch.isIndustryProxy).toBe(false);
		expect(labelFor(targeted, 'keywordMatch')).toBe('Keywords');
	});
});
