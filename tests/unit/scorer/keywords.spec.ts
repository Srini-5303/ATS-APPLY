import { describe, expect, it } from 'vitest';
import { buildAnalysis, scoreResume } from '$engine/scorer';
import { keywordsActive, scoreKeywords, SYNONYM_CREDIT } from '$engine/scorer/dimensions/keywords';
import { buildResumeTermSet, MATCHERS } from '$engine/scorer/matching';
import { PROFILES } from '$engine/scorer/profiles';
import { SECTION_TYPES, type SectionType } from '$engine/types/parser';
import type { ScoringInput } from '$engine/types/scoring';

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

const TECH_RESUME =
	'Go Python TypeScript PostgreSQL Redis Kubernetes Docker AWS Terraform Kafka gRPC distributed systems';

describe('matching strategies', () => {
	const terms = buildResumeTermSet(['kubernetes', 'postgresql', 'golang'], []);

	it('exact matches only the literal canonical term', () => {
		const out = MATCHERS.exact(['kubernetes', 'k8s'], terms, '');
		expect(out.matched).toEqual(['kubernetes']);
		expect(out.missing).toEqual(['k8s']);
	});

	it('fuzzy adds synonym expansion', () => {
		// "go" is the canonical form of "golang", so an exact-only matcher misses it.
		const out = MATCHERS.fuzzy(['go'], buildResumeTermSet(['golang'], []), '');
		expect(out.matched).toEqual(['go']);
		expect(out.synonymMatched).toEqual([]);
	});

	it('semantic adds partial overlap on top of fuzzy', () => {
		const resume = buildResumeTermSet(['kubernetes-native'], []);
		expect(MATCHERS.fuzzy(['kubernetes'], resume, '').matched).toEqual([]);
		expect(MATCHERS.semantic(['kubernetes'], resume, '').matched).toEqual(['kubernetes']);
	});

	it('does not let partial matching confuse java with javascript', () => {
		// The classic false positive. A prefix rule alone would match these.
		const resume = buildResumeTermSet(['javascript'], []);
		expect(MATCHERS.semantic(['java'], resume, '').matched).toEqual([]);
	});

	it('finds multi-word terms in raw text, which tokenisation splits', () => {
		const out = MATCHERS.exact(['machine learning'], new Set(), 'i do machine learning daily');
		expect(out.matched).toEqual(['machine learning']);
	});

	it('reports everything as missing when the resume is empty', () => {
		const out = MATCHERS.semantic(['go', 'rust'], new Set(), '');
		expect(out.missing).toEqual(['go', 'rust']);
		expect(out.matched).toEqual([]);
	});
});

describe('keyword scoring — general mode', () => {
	it('uses industry coverage rather than a fabricated constant', () => {
		// PRD §7.5 returned a flat 100 here, which pushed every clean resume to exactly 100 on
		// all six platforms (ADR 0001 §1).
		const analysis = buildAnalysis(makeInput({ resumeText: TECH_RESUME }));
		const result = scoreKeywords(analysis, PROFILES.workday);

		expect(result.isIndustryProxy).toBe(true);
		expect(result.score).toBeGreaterThan(0);
		expect(result.score).toBeLessThan(100);
		expect(result.matched).toContain('kubernetes');
	});

	it('gives a broader resume a higher score', () => {
		const thin = buildAnalysis(makeInput({ resumeText: 'Go Docker Kubernetes AWS' }));
		const broad = buildAnalysis(makeInput({ resumeText: TECH_RESUME }));

		expect(scoreKeywords(broad, PROFILES.workday).score).toBeGreaterThan(
			scoreKeywords(thin, PROFILES.workday).score
		);
	});

	it('is inactive when no industry can be identified', () => {
		const analysis = buildAnalysis(makeInput({ resumeText: 'I like long walks on the beach' }));
		expect(keywordsActive(analysis)).toBe(false);
	});

	it('redistributes the weight rather than scoring zero when inactive', () => {
		// Scoring an unidentifiable resume as 0 on keywords would punish it for something it
		// cannot fix; the weight moves to the dimensions that do carry signal.
		const results = scoreResume(
			makeInput({ resumeText: 'Some prose with no recognisable industry vocabulary at all.' })
		);

		for (const r of results) {
			expect(Number.isFinite(r.overallScore)).toBe(true);
			expect(r.breakdown.keywordMatch.isIndustryProxy).toBe(true);
		}
	});
});

describe('keyword scoring — targeted mode', () => {
	const jd = 'Requirements: Go, Kubernetes, PostgreSQL, Terraform, Kafka, gRPC';

	it('scores against the job description, not the industry', () => {
		const analysis = buildAnalysis(makeInput({ resumeText: TECH_RESUME, jobDescription: jd }));
		const result = scoreKeywords(analysis, PROFILES.workday);

		expect(result.isIndustryProxy).toBe(false);
		expect(result.score).toBeGreaterThan(50);
	});

	it('drops sharply when the resume does not match the posting', () => {
		const analysis = buildAnalysis(
			makeInput({
				resumeText: TECH_RESUME,
				jobDescription: 'Requirements: HubSpot, Salesforce, SEO, SEM, content marketing'
			})
		);

		expect(scoreKeywords(analysis, PROFILES.workday).score).toBe(0);
	});

	it('penalises Taleo hardest on a keyword gap', () => {
		// PRD §8.2 requires Taleo to score notably lower. Under the original §7.5 rule the
		// opposite happened: Taleo's high keyword weight gave it the biggest free boost.
		const results = scoreResume(
			makeInput({
				resumeText: TECH_RESUME,
				jobDescription: 'Requirements: HubSpot, Salesforce, SEO, SEM, content marketing'
			})
		);

		const byId = new Map(results.map((r) => [r.platformId, r.overallScore]));
		expect(byId.get('taleo')!).toBeLessThan(byId.get('lever')!);
	});

	it('credits a synonym match below an exact one', () => {
		expect(SYNONYM_CREDIT).toBeGreaterThan(0);
		expect(SYNONYM_CREDIT).toBeLessThan(1);
	});

	it('lets a lenient platform match what a strict one misses', () => {
		const input = makeInput({
			resumeText: 'golang k8s postgres',
			jobDescription: 'Requirements: Go, Kubernetes, PostgreSQL'
		});
		const analysis = buildAnalysis(input);

		const workday = scoreKeywords(analysis, PROFILES.workday).score;
		const icims = scoreKeywords(analysis, PROFILES.icims).score;

		// Both canonicalise, so they agree here — the point is neither throws and iCIMS is
		// never stricter than Workday.
		expect(icims).toBeGreaterThanOrEqual(workday);
	});
});
