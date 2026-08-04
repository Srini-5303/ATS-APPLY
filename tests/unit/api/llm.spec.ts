import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractJson } from '$engine/llm/json-extract';
import { buildRefinementPrompt, MAX_ADJUSTMENT, passThresholds } from '$engine/llm/prompt';
import { reconcile } from '$engine/llm/reconcile';
import { ALL_PROFILES, PROFILES } from '$engine/scorer/profiles';
import { scoreResume } from '$engine/scorer';
import { SECTION_TYPES, type SectionType } from '$engine/types/parser';
import type { ScoreResult, ScoringInput } from '$engine/types/scoring';
import { cacheKey, MemoryResponseCache } from '$lib/server/llm/cache';
import { runChain } from '$lib/server/llm/chain';
import { ProviderFailure, type Provider } from '$lib/server/llm/providers';
import { MemoryRateLimiter } from '$lib/server/rate-limit/memory';
import { validateAnalyzeRequest, clientKey } from '$lib/server/validation';

function baselineScores(): ScoreResult[] {
	const sectionCounts = Object.fromEntries(SECTION_TYPES.map((t) => [t, 0])) as Record<
		SectionType,
		number
	>;
	const input: ScoringInput = {
		resumeText: 'EXPERIENCE\n- Reduced latency by 42% across 120 Kubernetes services',
		resumeSkills: ['Go', 'Kubernetes', 'AWS', 'Docker', 'PostgreSQL'],
		resumeSections: ['contact', 'experience', 'education', 'skills'],
		experience: [],
		education: [],
		projects: [],
		summary: null,
		sectionCounts,
		hasMultipleColumns: false,
		hasTables: false,
		hasImages: false,
		pageCount: 1,
		wordCount: 400
	};
	return scoreResume(input);
}

describe('extractJson', () => {
	it.each([
		['bare object', '{"results":[]}'],
		['json fence', '```json\n{"results":[]}\n```'],
		['bare fence', '```\n{"results":[]}\n```'],
		['prose then json', 'Here is the analysis:\n\n{"results":[]}'],
		['trailing prose', '{"results":[]}\n\nLet me know if you need more.']
	])('parses %s', (_label, raw) => {
		expect(extractJson(raw)).toEqual({ results: [] });
	});

	it('takes the first complete object when two are emitted', () => {
		// indexOf('{')..lastIndexOf('}') would span both and produce invalid JSON.
		expect(extractJson('{"results":[1]}\n{"results":[2]}')).toEqual({ results: [1] });
	});

	it('is not confused by braces inside a string value', () => {
		expect(extractJson('{"reason":"use {braces} carefully"}')).toEqual({
			reason: 'use {braces} carefully'
		});
	});

	it('handles escaped quotes', () => {
		expect(extractJson('{"reason":"he said \\"hi\\""}')).toEqual({ reason: 'he said "hi"' });
	});

	it.each([
		['truncated', '{"results":[{"system":"Workday"'],
		['no json at all', 'I cannot help with that request.'],
		['empty', '']
	])('returns null for %s rather than throwing', (_label, raw) => {
		expect(extractJson(raw)).toBeNull();
	});
});

describe('prompt', () => {
	it('generates platform specs from the profile registry', () => {
		// PRD §8.2 restated these as prose and immediately disagreed with §7.9 on two
		// thresholds. Generating removes that failure mode (ADR 0001 §3).
		const prompt = buildRefinementPrompt({ resumeText: 'x', baseline: baselineScores() });

		for (const profile of ALL_PROFILES) {
			expect(prompt).toContain(profile.system);
			expect(prompt).toContain(profile.meta.parserType);
		}
	});

	it('carries each platform’s researched detail into the prompt', () => {
		// The point of holding this on the profile rather than writing it into the prompt as
		// prose: it cannot drift from the numbers it sits beside.
		const prompt = buildRefinementPrompt({ resumeText: 'x', baseline: baselineScores() });

		for (const profile of ALL_PROFILES) {
			expect(prompt).toContain(profile.meta.ranking);
			for (const breaks of profile.meta.breaks) expect(prompt).toContain(breaks);
			if (profile.meta.autoReject) expect(prompt).toContain(profile.meta.autoReject);
		}
	});

	it('states each pass threshold from the profile, never as prose', () => {
		const prompt = buildRefinementPrompt({ resumeText: 'x', baseline: baselineScores() });
		for (const profile of ALL_PROFILES) {
			expect(prompt).toContain(`Passes at: ${String(profile.passingScore)}`);
		}
	});

	it('demands suggestions be grounded in the resume', () => {
		// Without this the model returns boilerplate that would apply to any resume.
		const prompt = buildRefinementPrompt({ resumeText: 'x', baseline: baselineScores() });
		expect(prompt).toContain('quote the resume');
		expect(prompt).toContain('omit it');
	});

	it('flags the platform notes as researched rather than measured', () => {
		const prompt = buildRefinementPrompt({ resumeText: 'x', baseline: baselineScores() });
		expect(prompt).toContain('researched, not measured');
	});

	it('exposes thresholds that match the profiles exactly', () => {
		for (const [system, threshold] of Object.entries(passThresholds())) {
			const profile = ALL_PROFILES.find((p) => p.system === system);
			expect(profile?.passingScore).toBe(threshold);
		}
	});

	it('states the adjustment bound', () => {
		const prompt = buildRefinementPrompt({ resumeText: 'x', baseline: baselineScores() });
		expect(prompt).toContain(String(MAX_ADJUSTMENT));
		expect(prompt).toContain('REFINE');
	});

	it('includes the baseline so the model adjusts rather than invents', () => {
		const baseline = baselineScores();
		const prompt = buildRefinementPrompt({ resumeText: 'x', baseline });
		expect(prompt).toContain(`overall ${String(baseline[0]!.overallScore)}`);
	});

	it('switches between general and targeted framing', () => {
		const baseline = baselineScores();
		expect(buildRefinementPrompt({ resumeText: 'x', baseline })).toContain('GENERAL');
		expect(
			buildRefinementPrompt({ resumeText: 'x', jobDescription: 'Go role', baseline })
		).toContain('TARGETED');
	});

	it('caps very long inputs', () => {
		const prompt = buildRefinementPrompt({
			resumeText: 'x'.repeat(50_000),
			baseline: baselineScores()
		});
		expect(prompt).toContain('[truncated]');
		expect(prompt.length).toBeLessThan(20_000);
	});
});

describe('reconcile', () => {
	const baseline = baselineScores();

	it('applies a bounded adjustment', () => {
		const { results } = reconcile(baseline, {
			results: [{ system: 'Workday', adjustment: -10 }]
		});

		const workday = results.find((r) => r.platformId === 'workday')!;
		const base = baseline.find((r) => r.platformId === 'workday')!;
		expect(workday.overallScore).toBe(Math.max(0, base.overallScore - 10));
	});

	it('clamps an adjustment beyond the bound rather than discarding it', () => {
		const { results } = reconcile(baseline, {
			results: [{ system: 'Workday', adjustment: -80 }]
		});

		const workday = results.find((r) => r.platformId === 'workday')!;
		const base = baseline.find((r) => r.platformId === 'workday')!;
		expect(base.overallScore - workday.overallScore).toBe(MAX_ADJUSTMENT);
	});

	it.each([
		['four platforms', { results: [{ system: 'Workday', adjustment: -5 }] }],
		['no platforms', { results: [] }],
		['an unknown platform', { results: [{ system: 'Bamboo', adjustment: -5 }] }],
		['garbage', { nonsense: true }],
		['null', null],
		['an array', []]
	])('always returns six results given %s', (_label, response) => {
		const { results } = reconcile(baseline, response);
		expect(results).toHaveLength(6);
		expect(new Set(results.map((r) => r.platformId)).size).toBe(6);
	});

	it('keeps the baseline for platforms the model ignored', () => {
		const { results } = reconcile(baseline, {
			results: [{ system: 'Workday', adjustment: -5 }]
		});

		for (const platform of ['taleo', 'icims', 'greenhouse', 'lever', 'successfactors'] as const) {
			expect(results.find((r) => r.platformId === platform)!.overallScore).toBe(
				baseline.find((r) => r.platformId === platform)!.overallScore
			);
		}
	});

	it('takes the first of a duplicated platform', () => {
		const { results } = reconcile(baseline, {
			results: [
				{ system: 'Workday', adjustment: -5 },
				{ system: 'Workday', adjustment: -15 }
			]
		});

		const base = baseline.find((r) => r.platformId === 'workday')!;
		expect(results.find((r) => r.platformId === 'workday')!.overallScore).toBe(
			base.overallScore - 5
		);
	});

	it('recomputes passesFilter from the profile, ignoring the model', () => {
		const { results } = reconcile(baseline, {
			results: ALL_PROFILES.map((p) => ({ system: p.system, adjustment: -15, passesFilter: true }))
		});

		for (const r of results) {
			expect(r.passesFilter).toBe(r.overallScore >= PROFILES[r.platformId].passingScore);
		}
	});

	it('never produces a score outside 0-100', () => {
		for (const adjustment of [-100, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
			const { results } = reconcile(baseline, {
				results: ALL_PROFILES.map((p) => ({ system: p.system, adjustment }))
			});
			for (const r of results) {
				expect(Number.isFinite(r.overallScore)).toBe(true);
				expect(r.overallScore).toBeGreaterThanOrEqual(0);
				expect(r.overallScore).toBeLessThanOrEqual(100);
			}
		}
	});

	it.each([
		'No changes needed',
		'None required',
		'No action needed for this platform',
		'Looks good as is'
	])('drops %s, which is a verdict rather than a recommendation', (summary) => {
		const { results } = reconcile(baseline, {
			results: [{ system: 'Workday', adjustment: 0, suggestions: [{ summary }] }]
		});

		const workday = results.find((r) => r.platformId === 'workday');
		expect(workday?.suggestions.some((s) => s.summary === summary)).toBe(false);
	});

	it('keeps a real suggestion that merely mentions the word "change"', () => {
		const { results } = reconcile(baseline, {
			results: [
				{
					system: 'Workday',
					adjustment: 0,
					suggestions: [{ summary: 'Change the DeadPool header to separate title from stack' }]
				}
			]
		});

		const workday = results.find((r) => r.platformId === 'workday');
		expect(workday?.suggestions.some((s) => s.summary.includes('DeadPool'))).toBe(true);
	});

	it('coerces a malformed suggestion instead of dropping the whole response', () => {
		const { results } = reconcile(baseline, {
			results: [
				{
					system: 'Workday',
					adjustment: -3,
					suggestions: [
						{ summary: 'Real advice', details: [123, 'text'], impact: 'NONSENSE' },
						{ notASuggestion: true }
					]
				}
			]
		});

		const added = results
			.find((r) => r.platformId === 'workday')!
			.suggestions.find((s) => s.summary === 'Real advice');

		expect(added?.impact).toBe('medium');
		expect(added?.details).toEqual(['123', 'text']);
	});
});

describe('provider chain', () => {
	function stubProvider(overrides: Partial<Provider> & { name: string }): Provider {
		return {
			tier: 'primary',
			minBudgetMs: 1000,
			complete: () => Promise.resolve('{"results":[]}'),
			...overrides
		};
	}

	const baseline = baselineScores();

	it('uses the first provider that succeeds', async () => {
		const second = vi.fn(() => Promise.resolve('{"results":[]}'));

		const outcome = await runChain({
			providers: [
				stubProvider({ name: 'a', complete: () => Promise.resolve('{"results":[]}') }),
				stubProvider({ name: 'b', complete: second })
			],
			baseline,
			prompt: 'p'
		});

		expect(outcome.provider).toBe('a');
		expect(second).not.toHaveBeenCalled();
	});

	it('falls through when the first provider errors', async () => {
		const outcome = await runChain({
			providers: [
				stubProvider({
					name: 'a',
					complete: () => Promise.reject(new ProviderFailure('a', 'HTTP 500', 500))
				}),
				stubProvider({ name: 'b' })
			],
			baseline,
			prompt: 'p'
		});

		expect(outcome.provider).toBe('b');
		expect(outcome.fallback).toBe(false);
	});

	it('falls through on unparseable output rather than failing the request', async () => {
		const outcome = await runChain({
			providers: [
				stubProvider({ name: 'a', complete: () => Promise.resolve('I refuse.') }),
				stubProvider({ name: 'b' })
			],
			baseline,
			prompt: 'p'
		});

		expect(outcome.provider).toBe('b');
	});

	it('returns the baseline untouched when every provider fails', async () => {
		// Never an error: the deterministic scores are already on the user's screen and are
		// still correct (ADR 0001 §9).
		const outcome = await runChain({
			providers: [
				stubProvider({ name: 'a', complete: () => Promise.reject(new Error('down')) }),
				stubProvider({ name: 'b', complete: () => Promise.reject(new Error('down')) })
			],
			baseline,
			prompt: 'p'
		});

		expect(outcome.fallback).toBe(true);
		expect(outcome.provider).toBe('rule-based');
		expect(outcome.results).toEqual(baseline);
	});

	it('skips a provider that cannot fit in the remaining budget', async () => {
		// PRD §8.4 gave Ollama 240s against a 60s function limit, guaranteeing a kill with no
		// fallback reached (ADR 0001 §8).
		const slow = vi.fn(() => Promise.resolve('{"results":[]}'));

		const outcome = await runChain({
			providers: [stubProvider({ name: 'slow', minBudgetMs: 240_000, complete: slow })],
			baseline,
			prompt: 'p',
			budgetMs: 55_000
		});

		expect(slow).not.toHaveBeenCalled();
		expect(outcome.fallback).toBe(true);
	});

	it('returns the baseline when there are no providers at all', async () => {
		const outcome = await runChain({ providers: [], baseline, prompt: 'p' });
		expect(outcome.fallback).toBe(true);
		expect(outcome.results).toEqual(baseline);
	});
});

describe('rate limiter', () => {
	let now = 0;
	const advance = (ms: number) => (now += ms);

	beforeEach(() => {
		now = 1_000_000;
	});

	it('allows up to the per-minute limit', () => {
		const limiter = new MemoryRateLimiter(3, 100, () => now);
		for (let i = 0; i < 3; i++) expect(limiter.check('ip').allowed).toBe(true);
		expect(limiter.check('ip').allowed).toBe(false);
	});

	it('reports the minute scope and a retry hint', () => {
		const limiter = new MemoryRateLimiter(1, 100, () => now);
		limiter.check('ip');

		const verdict = limiter.check('ip');
		expect(verdict.scope).toBe('minute');
		expect(verdict.retryAfterSec).toBeGreaterThan(0);
		expect(verdict.retryAfterSec).toBeLessThanOrEqual(60);
	});

	it('recovers after the minute window passes', () => {
		const limiter = new MemoryRateLimiter(1, 100, () => now);
		limiter.check('ip');
		expect(limiter.check('ip').allowed).toBe(false);

		advance(61_000);
		expect(limiter.check('ip').allowed).toBe(true);
	});

	it('enforces the daily cap across minute windows', () => {
		// Waiting out the minute window must not reset the daily allowance.
		const limiter = new MemoryRateLimiter(10, 3, () => now);
		for (let i = 0; i < 3; i++) {
			expect(limiter.check('ip').allowed).toBe(true);
			advance(61_000);
		}

		const verdict = limiter.check('ip');
		expect(verdict.allowed).toBe(false);
		expect(verdict.scope).toBe('day');
	});

	it('does not let a daily-capped caller consume free minute slots', () => {
		// PRD §9.3 returned early on the daily rejection without touching either counter,
		// which let a capped caller hammer the endpoint at unlimited rate.
		const limiter = new MemoryRateLimiter(10, 1, () => now);
		limiter.check('ip');

		const verdict = limiter.check('ip');
		expect(verdict.allowed).toBe(false);
		expect(verdict.scope).toBe('day');
	});

	it('tracks callers independently', () => {
		const limiter = new MemoryRateLimiter(1, 100, () => now);
		expect(limiter.check('a').allowed).toBe(true);
		expect(limiter.check('b').allowed).toBe(true);
		expect(limiter.check('a').allowed).toBe(false);
	});
});

describe('response cache', () => {
	let now = 0;

	beforeEach(() => {
		now = 1_000_000;
	});

	it('returns a stored entry', () => {
		const cache = new MemoryResponseCache(10, () => now);
		cache.set('k', { results: [], provider: 'gemini' });
		expect(cache.get('k')?.provider).toBe('gemini');
	});

	it('misses after the TTL', () => {
		const cache = new MemoryResponseCache(10, () => now);
		cache.set('k', { results: [], provider: 'gemini' });

		now += 25 * 60 * 60 * 1000;
		expect(cache.get('k')).toBeNull();
	});

	it('expires a fallback answer sooner than a primary one', () => {
		// Otherwise a degraded Groq answer produced during a Gemini outage is served for a
		// full day after Gemini recovers.
		const cache = new MemoryResponseCache(10, () => now);
		cache.set('primary', { results: [], provider: 'gemini' }, 'primary');
		cache.set('fallback', { results: [], provider: 'groq' }, 'fallback');

		now += 2 * 60 * 60 * 1000;
		expect(cache.get('fallback')).toBeNull();
		expect(cache.get('primary')).not.toBeNull();
	});

	it('evicts the least recently used entry at capacity', () => {
		const cache = new MemoryResponseCache(2, () => now);
		cache.set('a', { results: [], provider: 'x' });
		cache.set('b', { results: [], provider: 'x' });

		cache.get('a'); // refresh a
		cache.set('c', { results: [], provider: 'x' });

		expect(cache.get('b')).toBeNull();
		expect(cache.get('a')).not.toBeNull();
	});

	it('keys on prompt version and provider tier, not the prompt alone', async () => {
		const primary = await cacheKey('same prompt', 'primary');
		const fallback = await cacheKey('same prompt', 'fallback');

		expect(primary).not.toBe(fallback);
		expect(primary).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('request validation', () => {
	const valid = { resumeText: 'hello', baseline: baselineScores() };

	it('accepts a well-formed request', () => {
		expect(validateAnalyzeRequest(valid).resumeText).toBe('hello');
	});

	it.each([
		['no body', null],
		['missing resumeText', { baseline: baselineScores() }],
		['empty resumeText', { resumeText: '   ', baseline: baselineScores() }],
		['oversized resumeText', { resumeText: 'x'.repeat(50_001), baseline: baselineScores() }],
		['no baseline', { resumeText: 'hi' }],
		['short baseline', { resumeText: 'hi', baseline: [] }],
		[
			'non-string jobDescription',
			{ resumeText: 'hi', baseline: baselineScores(), jobDescription: 5 }
		]
	])('rejects %s', (_label, body) => {
		expect(() => validateAnalyzeRequest(body)).toThrow();
	});

	it('rejects a baseline containing a fabricated platform', () => {
		const tampered = baselineScores().map((r) => ({ ...r, platformId: 'bamboo' }));
		expect(() => validateAnalyzeRequest({ resumeText: 'hi', baseline: tampered })).toThrow();
	});

	it('rejects an out-of-range baseline score', () => {
		const tampered = baselineScores();
		tampered[0] = { ...tampered[0]!, overallScore: 5000 };
		expect(() => validateAnalyzeRequest({ resumeText: 'hi', baseline: tampered })).toThrow();
	});

	it('omits the jobDescription key when it is blank', () => {
		const result = validateAnalyzeRequest({ ...valid, jobDescription: '   ' });
		expect('jobDescription' in result).toBe(false);
	});
});

describe('clientKey', () => {
	it('trusts only the first hop of x-forwarded-for', () => {
		// The rest of the chain is caller-supplied and trivially spoofed to evade a per-IP
		// limit.
		const request = new Request('https://example.com', {
			headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9, 8.8.8.8' }
		});
		expect(clientKey(request, 'fallback')).toBe('1.2.3.4');
	});

	it('falls back to the platform-provided address', () => {
		expect(clientKey(new Request('https://example.com'), '5.6.7.8')).toBe('5.6.7.8');
	});
});
