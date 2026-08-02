import { describe, expect, it } from 'vitest';
import { ALL_PROFILES, PROFILES, validateProfiles } from '$engine/scorer/profiles';
import { DIMENSIONS, PLATFORM_IDS } from '$engine/types/scoring';

describe('platform profile registry', () => {
	it('satisfies every structural invariant', () => {
		expect(validateProfiles()).toEqual([]);
	});

	it('covers exactly the six known platforms', () => {
		expect(Object.keys(PROFILES).sort()).toEqual([...PLATFORM_IDS].sort());
		expect(ALL_PROFILES).toHaveLength(6);
	});

	it.each([...PLATFORM_IDS])('%s weights sum to 1.0', (id) => {
		const sum = DIMENSIONS.reduce((acc, d) => acc + PROFILES[id].weights[d], 0);
		expect(sum).toBeCloseTo(1, 9);
	});

	it('preserves the relative strictness ordering the product depends on', () => {
		// If these invert, the six platforms stop telling the user anything different and
		// the core premise breaks.
		const { workday, taleo, icims, greenhouse, lever } = PROFILES;
		expect(workday.parsingStrictness).toBeGreaterThan(icims.parsingStrictness);
		expect(taleo.parsingStrictness).toBeGreaterThan(icims.parsingStrictness);
		expect(icims.parsingStrictness).toBeGreaterThan(greenhouse.parsingStrictness);
		expect(greenhouse.parsingStrictness).toBeGreaterThan(lever.parsingStrictness);
	});

	it('gives Taleo the highest keyword weight', () => {
		// PRD §8.2 asserts Taleo scores notably lower on keyword gaps; that only holds if it
		// also carries the heaviest keyword weight.
		const max = Math.max(...ALL_PROFILES.map((p) => p.weights.keywordMatch));
		expect(PROFILES.taleo.weights.keywordMatch).toBe(max);
	});

	it('excludes contact from required sections', () => {
		// PRD §5.5 assigns all pre-header content to `contact`, so it is present for every
		// non-empty resume and carries no signal (ADR 0001 §7).
		for (const profile of ALL_PROFILES) {
			expect(profile.requiredSections).not.toContain('contact');
		}
	});
});
