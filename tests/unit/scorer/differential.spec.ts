import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scoreResume } from '$engine/scorer';
import { PROFILES } from '$engine/scorer/profiles';
import { DIMENSIONS, type PlatformId, type ScoringInput } from '$engine/types/scoring';
import { SECTION_TYPES, type SectionType } from '$engine/types/parser';

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
		projects: [],
		education: [],
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

function byPlatform(input: ScoringInput): Map<PlatformId, number> {
	return new Map(scoreResume(input).map((r) => [r.platformId, r.overallScore]));
}

const DECENT_RESUME = makeInput({
	resumeText: [
		'EXPERIENCE',
		'- Reduced p99 latency by 42% across 120 Kubernetes services',
		'- Built a Go pipeline processing 1,200,000 events per minute',
		'- Migrated PostgreSQL and Redis workloads to AWS with Terraform',
		'- Mentored 5 engineers on distributed systems design'
	].join('\n'),
	resumeSkills: ['Go', 'Kubernetes', 'PostgreSQL', 'Redis', 'AWS', 'Terraform', 'Docker'],
	resumeSections: ['contact', 'experience', 'education', 'skills']
});

/**
 * Relationships the golden snapshots cannot protect.
 *
 * A snapshot pins today's numbers; these pin the *orderings* the product's premise depends
 * on. If Lever ever starts punishing formatting harder than Workday, the six platforms have
 * stopped meaning anything, and no single-fixture snapshot would say so.
 */
describe('cross-platform differentials', () => {
	it('ranks formatting leniency Lever > Greenhouse > iCIMS > Workday', () => {
		const messy = makeInput({
			...DECENT_RESUME,
			hasMultipleColumns: true,
			hasTables: true,
			hasImages: true
		});

		const results = new Map(
			scoreResume(messy).map((r) => [r.platformId, r.breakdown.formatting.score])
		);

		expect(results.get('lever')!).toBeGreaterThan(results.get('greenhouse')!);
		expect(results.get('greenhouse')!).toBeGreaterThan(results.get('icims')!);
		expect(results.get('icims')!).toBeGreaterThan(results.get('workday')!);
	});

	it('costs Taleo more than Lever when the job description does not match', () => {
		// PRD §8.2 requires Taleo to be notably harsher. Under §7.5 as written the opposite
		// happened — its heavy keyword weight became the largest free bonus (ADR 0001 §1).
		const targeted = makeInput({
			...DECENT_RESUME,
			jobDescription: 'Requirements: HubSpot, Salesforce, SEO, SEM, content marketing, CRM'
		});

		const matched = byPlatform(DECENT_RESUME);
		const mismatched = byPlatform(targeted);

		const taleoLoss = matched.get('taleo')! - mismatched.get('taleo')!;
		const leverLoss = matched.get('lever')! - mismatched.get('lever')!;

		expect(taleoLoss).toBeGreaterThan(leverLoss);
	});

	it('produces a meaningful spread on a resume with real weaknesses', () => {
		// Differentiation is the entire product claim. A literal reading of PRD §7.5 gave
		// every platform exactly the same score.
		const weak = makeInput({
			resumeText: 'EXPERIENCE\n- Did some work\n- Helped the team',
			resumeSections: ['experience'],
			hasMultipleColumns: true,
			pageCount: 3
		});

		const scores = [...byPlatform(weak).values()];
		expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThanOrEqual(10);
	});

	it('keeps every platform ordering stable between two identical runs', () => {
		expect(scoreResume(DECENT_RESUME)).toEqual(scoreResume(DECENT_RESUME));
	});
});

describe('scoring properties', () => {
	const arbitraryInput = fc.record({
		resumeText: fc.string({ maxLength: 400 }),
		resumeSkills: fc.array(fc.string({ maxLength: 20 }), { maxLength: 10 }),
		resumeSections: fc.array(fc.constantFrom(...SECTION_TYPES), { maxLength: 8 }),
		hasMultipleColumns: fc.boolean(),
		hasTables: fc.boolean(),
		hasImages: fc.boolean(),
		pageCount: fc.integer({ min: 0, max: 12 }),
		wordCount: fc.integer({ min: 0, max: 5000 })
	});

	it('always returns a finite score in 0-100 for every dimension', () => {
		// Guards the whole degenerate-input class at once, rather than the one zero-bullet
		// case that produced NaN in PRD §7.7 (ADR 0001 §4).
		fc.assert(
			fc.property(arbitraryInput, (partial) => {
				for (const result of scoreResume(makeInput(partial))) {
					expect(Number.isFinite(result.overallScore)).toBe(true);
					expect(result.overallScore).toBeGreaterThanOrEqual(0);
					expect(result.overallScore).toBeLessThanOrEqual(100);

					for (const dimension of DIMENSIONS) {
						const score = result.breakdown[dimension].score;
						expect(Number.isFinite(score)).toBe(true);
						expect(score).toBeGreaterThanOrEqual(0);
						expect(score).toBeLessThanOrEqual(100);
					}
				}
			}),
			{ numRuns: 200 }
		);
	});

	it('is unaffected by the order of the skills list', () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom('Go', 'Python', 'AWS', 'Docker', 'React'), { maxLength: 5 }),
				(skills) => {
					const forward = scoreResume(makeInput({ resumeSkills: skills }));
					const reversed = scoreResume(makeInput({ resumeSkills: [...skills].reverse() }));
					expect(forward.map((r) => r.overallScore)).toEqual(reversed.map((r) => r.overallScore));
				}
			),
			{ numRuns: 50 }
		);
	});

	it('never lowers the experience score when a bullet is added', () => {
		const base = 'EXPERIENCE\n- Reduced latency by 42%';
		const more = `${base}\n- Built a service handling 1,000,000 requests`;

		const scoreOf = (text: string) =>
			scoreResume(makeInput({ resumeText: text }))[0]!.breakdown.experience.score;

		expect(scoreOf(more)).toBeGreaterThanOrEqual(scoreOf(base));
	});

	it('never raises the section score when a required section is removed', () => {
		const withAll = makeInput({ resumeSections: ['experience', 'education', 'skills'] });
		const without = makeInput({ resumeSections: ['experience', 'education'] });

		for (const [i, full] of scoreResume(withAll).entries()) {
			const reduced = scoreResume(without)[i]!;
			expect(reduced.breakdown.sections.score).toBeLessThanOrEqual(full.breakdown.sections.score);
		}
	});

	it('derives passesFilter from the profile threshold, never from anything else', () => {
		// The model's own boolean is discarded in the LLM path for this reason; the rule has
		// exactly one source of truth (ADR 0001 §3).
		fc.assert(
			fc.property(arbitraryInput, (partial) => {
				for (const result of scoreResume(makeInput(partial))) {
					const threshold = PROFILES[result.platformId].passingScore;
					expect(result.passesFilter).toBe(result.overallScore >= threshold);
				}
			}),
			{ numRuns: 50 }
		);
	});
});
