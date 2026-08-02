import { describe, expect, it } from 'vitest';
import { buildAnalysis, scoreResume } from '$engine/scorer';
import { scoreExperience } from '$engine/scorer/dimensions/experience';
import { scoreFormatting } from '$engine/scorer/dimensions/formatting';
import { scoreQuantification } from '$engine/scorer/dimensions/quantification';
import { scoreSections } from '$engine/scorer/dimensions/sections';
import { ACTION_VERBS, startsWithActionVerb } from '$engine/scorer/constants/action-verbs';
import { QUANT_PATTERNS } from '$engine/scorer/constants/quantification';
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

function analyse(overrides: Partial<ScoringInput> = {}) {
	return buildAnalysis(makeInput(overrides));
}

describe('formatting', () => {
	it('gives a clean resume full marks', () => {
		expect(scoreFormatting(analyse(), PROFILES.workday).score).toBe(100);
	});

	it.each([
		['hasMultipleColumns', 'Multi-column layout detected'],
		['hasTables', 'Tables detected'],
		['hasImages', 'Images or graphics detected']
	] as const)('flags %s', (flag, issue) => {
		const result = scoreFormatting(analyse({ [flag]: true }), PROFILES.workday);
		expect(result.issues).toContain(issue);
		expect(result.score).toBeLessThan(100);
	});

	it('scales the same defect by the platform strictness', () => {
		// This is the only mechanism producing per-platform formatting spread; there is no
		// per-platform branching anywhere in the scorer.
		const analysis = analyse({ hasMultipleColumns: true, hasTables: true });

		const workday = scoreFormatting(analysis, PROFILES.workday).score;
		const icims = scoreFormatting(analysis, PROFILES.icims).score;
		const lever = scoreFormatting(analysis, PROFILES.lever).score;

		expect(workday).toBeLessThan(icims);
		expect(icims).toBeLessThan(lever);
	});

	it('caps the all-caps penalty so conventional headers are not punished without limit', () => {
		// PRD §7.4 charges 3 points per line with no ceiling, which penalises the ALL-CAPS
		// section headers that §5.5's own heuristics rely on (ADR 0001 §10).
		const manyHeaders = analyse({
			resumeText: Array.from({ length: 20 }, (_, i) => `SECTION ${String(i)}`).join('\n')
		});

		const result = scoreFormatting(manyHeaders, PROFILES.workday);
		expect(result.score).toBeGreaterThanOrEqual(90);
	});

	it('never drops below zero', () => {
		const awful = analyse({
			hasMultipleColumns: true,
			hasTables: true,
			hasImages: true,
			pageCount: 9,
			wordCount: 10,
			resumeText: Array.from({ length: 60 }, () => 'SHOUTING LINE').join('\n')
		});

		expect(scoreFormatting(awful, PROFILES.workday).score).toBeGreaterThanOrEqual(0);
	});
});

describe('sections', () => {
	it('scores the intersection of required and detected, never above 100', () => {
		// A literal reading of PRD §7.6 returns 800 here: 8 detected sections over Lever's
		// single requirement (ADR 0001 §7).
		const everything = analyse({
			resumeSections: [
				'contact',
				'summary',
				'experience',
				'education',
				'skills',
				'projects',
				'awards',
				'languages'
			]
		});

		expect(scoreSections(everything, PROFILES.lever).score).toBe(100);
	});

	it('reports exactly which required sections are missing', () => {
		const result = scoreSections(analyse({ resumeSections: ['experience'] }), PROFILES.workday);

		expect(result.present).toEqual(['experience']);
		expect(result.missing).toEqual(['education', 'skills']);
		expect(result.score).toBe(33);
	});

	it('scores zero when nothing required is present', () => {
		expect(scoreSections(analyse({ resumeSections: ['interests'] }), PROFILES.taleo).score).toBe(0);
	});
});

describe('experience', () => {
	const bullets = (lines: string[]) =>
		analyse({ resumeText: lines.map((l) => `- ${l}`).join('\n') });

	it('returns zero for a resume with no bullets, not NaN', () => {
		const result = scoreExperience(analyse());

		expect(result.score).toBe(0);
		expect(Number.isFinite(result.score)).toBe(true);
		expect(result.totalBullets).toBe(0);
	});

	it('rewards action verbs', () => {
		const strong = bullets(['Reduced latency', 'Built a service', 'Led a team']);
		const weak = bullets([
			'Was responsible for latency',
			'Helped with a service',
			'Part of a team'
		]);

		expect(scoreExperience(strong).score).toBeGreaterThan(scoreExperience(weak).score);
	});

	it('rewards more substantive bullet counts', () => {
		const few = bullets(['Reduced latency']);
		const many = bullets(Array.from({ length: 8 }, (_, i) => `Reduced latency ${String(i)}`));

		expect(scoreExperience(many).score).toBeGreaterThan(scoreExperience(few).score);
	});

	it('no longer double-counts quantification', () => {
		// Quantification is a standalone dimension now (ADR 0001 §5), so adding a number to a
		// bullet must not move the experience score.
		const plain = bullets(['Reduced checkout latency']);
		const quantified = bullets(['Reduced checkout latency by 42%']);

		expect(scoreExperience(quantified).score).toBe(scoreExperience(plain).score);
	});
});

describe('quantification', () => {
	it.each([
		['42%', 'percentage'],
		['$2.4 billion', 'currency'],
		['3x faster', 'multiplier'],
		['1,200,000 requests', 'comma-grouped number'],
		['5 engineers', 'people count'],
		['20 hours', 'duration'],
		['top 3', 'ranking'],
		['14 applications', 'thing count']
	])('detects %s (%s)', (fragment) => {
		expect(QUANT_PATTERNS.some((p) => p.test(`Improved things by ${fragment}`))).toBe(true);
	});

	it('returns zero rather than NaN when there are no bullets', () => {
		const result = scoreQuantification(analyse());
		expect(result.score).toBe(0);
		expect(Number.isFinite(result.score)).toBe(true);
	});

	it('scales with the proportion of quantified bullets', () => {
		const none = analyse({ resumeText: '- Did a thing\n- Did another thing' });
		const half = analyse({ resumeText: '- Cut costs by 30%\n- Did another thing' });
		const all = analyse({ resumeText: '- Cut costs by 30%\n- Grew revenue by $2M' });

		expect(scoreQuantification(none).score).toBe(0);
		expect(scoreQuantification(half).score).toBeGreaterThan(0);
		expect(scoreQuantification(all).score).toBeGreaterThan(scoreQuantification(half).score);
	});
});

describe('action verbs', () => {
	it('contains 100 verbs, all lowercase and unique', () => {
		expect(ACTION_VERBS.size).toBe(100);
		for (const verb of ACTION_VERBS) expect(verb).toBe(verb.toLowerCase());
	});

	it('matches only at the start of a bullet', () => {
		expect(startsWithActionVerb('Reduced latency by 42%')).toBe(true);
		expect(startsWithActionVerb('Was reduced by someone else')).toBe(false);
	});

	it('handles an empty bullet without throwing', () => {
		expect(startsWithActionVerb('')).toBe(false);
		expect(startsWithActionVerb('   ')).toBe(false);
	});
});

describe('scoreResume invariants', () => {
	it('produces a finite in-range score for degenerate input', () => {
		const degenerate = [
			makeInput(),
			makeInput({ resumeText: '', wordCount: 0 }),
			makeInput({ wordCount: 0, pageCount: 0 }),
			makeInput({ resumeText: '\n\n\n', resumeSections: [] })
		];

		for (const input of degenerate) {
			for (const result of scoreResume(input)) {
				expect(Number.isFinite(result.overallScore)).toBe(true);
				expect(result.overallScore).toBeGreaterThanOrEqual(0);
				expect(result.overallScore).toBeLessThanOrEqual(100);
			}
		}
	});

	it('is unaffected by the order of the skills list', () => {
		const a = scoreResume(makeInput({ resumeSkills: ['Go', 'Python', 'AWS'] }));
		const b = scoreResume(makeInput({ resumeSkills: ['AWS', 'Go', 'Python'] }));

		expect(a.map((r) => r.overallScore)).toEqual(b.map((r) => r.overallScore));
	});

	it('honours a platform subset', () => {
		const results = scoreResume(makeInput(), { systems: ['workday', 'lever'] });
		expect(results.map((r) => r.platformId)).toEqual(['workday', 'lever']);
	});

	it('derives passesFilter from the profile threshold, never from anything else', () => {
		for (const result of scoreResume(makeInput({ resumeSections: ['experience'] }))) {
			const threshold = PROFILES[result.platformId].passingScore;
			expect(result.passesFilter).toBe(result.overallScore >= threshold);
		}
	});
});
