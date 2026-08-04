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

/**
 * Quirks used to sum into one scalar added after the weighted sum, so a platform-specific
 * penalty on experience left the experience bar untouched and moved only the total. Six
 * identical bars sat above six differing overalls, and the user could not see where the
 * difference came from.
 */
describe('quirk routing', () => {
	const ABBREVIATED = makeInput({
		...DECENT_RESUME,
		resumeSections: ['contact', 'experience', 'education', 'skills'],
		education: [
			{
				degree: 'M.S.',
				field: 'Computer Science',
				institution: 'State University',
				dates: { start: '2022-09', end: '2024-05', isCurrent: false },
				gpa: '3.8',
				honors: ['Dean’s List']
			}
		]
	});

	it('moves the bar a quirk names, not just the total', () => {
		const results = scoreResume(ABBREVIATED);
		const education = new Map(results.map((r) => [r.platformId, r.breakdown.education.score]));

		// Taleo indexes credential strings literally, SuccessFactors resolves them partially,
		// and the LLM-based parsers do not care at all.
		expect(education.get('taleo')!).toBeLessThan(education.get('successfactors')!);
		expect(education.get('successfactors')!).toBeLessThan(education.get('greenhouse')!);
		expect(education.get('greenhouse')).toBe(education.get('lever'));
	});

	it('differentiates several bars on a resume with weaknesses to differentiate on', () => {
		// The complaint that started this: four of six bars identical on every platform, so
		// the card could not show where the overall difference came from.
		//
		// Three is what this input can honestly support — formatting, sections and experience.
		// Keywords and education are legitimately flat here because there is no job
		// description and no education section at all, and a platform cannot disagree about
		// content that is absent.
		const weak = makeInput({
			resumeText: 'EXPERIENCE\n- Did some work\n- Helped the team',
			resumeSections: ['experience'],
			hasMultipleColumns: true,
			pageCount: 3
		});

		const results = scoreResume(weak);
		const varying = DIMENSIONS.filter(
			(d) => new Set(results.map((r) => r.breakdown[d].score)).size > 1
		);

		expect(varying).toEqual(expect.arrayContaining(['formatting', 'sections', 'experience']));
	});

	it('still counts a penalty the bar is too low to absorb', () => {
		// A resume with no sections sits at 0 on that bar, so Taleo's -8 per missing section
		// would land on the floor and vanish — leaving the platform that punishes this hardest
		// scoring above the one that barely cares.
		const noSections = makeInput({
			resumeText: 'Go Kubernetes PostgreSQL AWS Docker Terraform',
			jobDescription: 'Requirements: Go, Kubernetes, PostgreSQL'
		});

		const scores = byPlatform(noSections);
		expect(scores.get('taleo')!).toBeLessThan(scores.get('lever')!);
	});

	it('keeps a quirk alive when its dimension is dropped for want of signal', () => {
		// No JD and no identifiable industry drops the keyword slot to zero weight. Taleo's
		// skill-density rule is routed there and must fall back to the overall rather than
		// silently disappear.
		const noSkills = makeInput({
			resumeText: 'EXPERIENCE\n- Did some work',
			resumeSections: ['experience']
		});

		const scores = byPlatform(noSkills);
		expect(scores.get('taleo')!).toBeLessThan(scores.get('icims')!);
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
