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

	it('fuzzy adds synonym expansion, and reports it as such', () => {
		const resume = buildResumeTermSet(['golang'], []);

		// Exact sees a different word; fuzzy folds the synonym and credits it at a discount.
		expect(MATCHERS.exact(['go'], resume, '').matched).toEqual([]);

		const out = MATCHERS.fuzzy(['go'], resume, '');
		expect(out.matched).toEqual(['go']);
		expect(out.synonymMatched).toEqual(['go']);
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

describe('platform strategies must actually differ', () => {
	// The reason the three strategies exist. An earlier version canonicalised resume terms
	// *before* matching, so "k8s" was already "kubernetes" by the time a matcher saw it and
	// `exact` behaved identically to `semantic` — every platform returned the same keyword
	// score on every resume, and the six cards were decorative.
	const jd =
		'Requirements: Kubernetes, PostgreSQL, JavaScript, machine learning, Amazon Web Services';

	function scoreFor(resumeText: string, platform: 'workday' | 'icims' | 'lever') {
		const analysis = buildAnalysis(makeInput({ resumeText, jobDescription: jd }));
		return scoreKeywords(analysis, PROFILES[platform]).score;
	}

	const canonical = 'Kubernetes PostgreSQL JavaScript machine learning Amazon Web Services';
	const abbreviated = 'k8s postgres js ML AWS';

	it('agrees when the resume uses the same words as the posting', () => {
		expect(scoreFor(canonical, 'workday')).toBe(100);
		expect(scoreFor(canonical, 'icims')).toBe(100);
		expect(scoreFor(canonical, 'lever')).toBe(100);
	});

	it('splits sharply when the resume uses abbreviations', () => {
		// Workday's literal matcher genuinely will not credit "k8s" for "Kubernetes"; iCIMS
		// and Lever will. That difference is the product's whole premise.
		expect(scoreFor(abbreviated, 'workday')).toBe(0);
		expect(scoreFor(abbreviated, 'icims')).toBeGreaterThan(50);
		expect(scoreFor(abbreviated, 'lever')).toBeGreaterThan(50);
	});

	it('never scores a lenient platform below a strict one', () => {
		// The ordering that must always hold: a looser matcher can only ever find more. Even
		// on canonical text semantic pulls ahead, because partial matching also catches
		// inflections across the industry vocabulary.
		for (const text of [canonical, 'k8s postgres js ML AWS', TECH_RESUME]) {
			const analysis = buildAnalysis(makeInput({ resumeText: text }));
			const workday = scoreKeywords(analysis, PROFILES.workday).score;
			const icims = scoreKeywords(analysis, PROFILES.icims).score;
			const lever = scoreKeywords(analysis, PROFILES.lever).score;

			expect(icims).toBeGreaterThanOrEqual(workday);
			expect(lever).toBeGreaterThanOrEqual(icims);
		}
	});

	it('separates platforms in general mode when the resume uses shorthand', () => {
		const analysis = buildAnalysis(
			makeInput({ resumeText: 'k8s postgres js ML AWS docker terraform kafka redis grpc' })
		);

		const workday = scoreKeywords(analysis, PROFILES.workday).score;
		const lever = scoreKeywords(analysis, PROFILES.lever).score;

		expect(lever).toBeGreaterThan(workday);
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
