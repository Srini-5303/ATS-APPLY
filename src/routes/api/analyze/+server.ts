import { json } from '@sveltejs/kit';
import { buildRefinementPrompt } from '$engine/llm/prompt';
import { isAppError } from '$lib/errors';
import { log } from '$lib/log';
import { serverConfig } from '$lib/server/env';
import { cacheKey } from '$lib/server/llm/cache';
import { runChain } from '$lib/server/llm/chain';
import { geminiProvider, groqProvider, type Provider } from '$lib/server/llm/providers';
import { rateLimiter, responseCache } from '$lib/server/instances';
import { clientKey, validateAnalyzeRequest } from '$lib/server/validation';
import type { RequestHandler } from './$types';

/**
 * LLM refinement endpoint.
 *
 * Refines the deterministic scores the client has already computed and displayed. It never
 * produces scores from nothing, and it never fails the request: if every provider is down,
 * rate-limited or too slow, the baseline comes back untouched with `_fallback: true`
 * (ADR 0001 §2, §9).
 */

export const config = { runtime: 'edge', maxDuration: 60 };

function buildProviders(): Provider[] {
	const cfg = serverConfig();
	const providers: Provider[] = [];

	if (cfg.gemini) providers.push(geminiProvider(cfg.gemini));
	if (cfg.groq) providers.push(groqProvider(cfg.groq));

	return providers;
}

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const requestId = locals.requestId;
	const logger = log.child({ requestId, route: '/api/analyze' });

	if (!request.headers.get('content-type')?.includes('application/json')) {
		return json({ error: 'Content-Type must be application/json' }, { status: 415 });
	}

	let parsed;
	try {
		parsed = validateAnalyzeRequest(await request.json());
	} catch (err) {
		if (isAppError(err)) return json({ error: err.publicMessage }, { status: err.httpStatus });
		return json({ error: 'Malformed request body' }, { status: 400 });
	}

	const key = clientKey(request, getClientAddress());
	const verdict = rateLimiter.check(key);

	if (!verdict.allowed) {
		logger.info('rate limited', { scope: verdict.scope });
		return json(
			{ error: 'Too many requests. Please wait and try again.', retryAfter: verdict.retryAfterSec },
			{ status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) } }
		);
	}

	const providers = buildProviders();

	// Nothing configured: the deterministic scores are already correct and already rendered,
	// so this is a 200 with the baseline, not a 503.
	if (providers.length === 0) {
		return respond({
			results: parsed.baseline,
			provider: 'rule-based',
			fallback: true,
			cached: false
		});
	}

	const prompt = buildRefinementPrompt({
		resumeText: parsed.resumeText,
		...(parsed.jobDescription === undefined ? {} : { jobDescription: parsed.jobDescription }),
		baseline: parsed.baseline
	});

	const tier = providers[0]?.tier ?? 'primary';
	const hash = await cacheKey(prompt, tier);

	const hit = responseCache.get(hash);
	if (hit) {
		logger.info('cache hit', { provider: hit.provider });
		return respond({ results: hit.results, provider: hit.provider, fallback: false, cached: true });
	}

	const outcome = await runChain({
		providers,
		baseline: parsed.baseline,
		prompt,
		budgetMs: serverConfig().llmBudgetMs
	});

	if (!outcome.fallback) {
		responseCache.set(hash, { results: outcome.results, provider: outcome.provider });
	}

	return respond({
		results: outcome.results,
		provider: outcome.provider,
		fallback: outcome.fallback,
		cached: false
	});
};

function respond(payload: {
	results: unknown;
	provider: string;
	fallback: boolean;
	cached: boolean;
}): Response {
	return json(
		{
			results: payload.results,
			_provider: payload.provider,
			_fallback: payload.fallback,
			_cached: payload.cached
		},
		{
			headers: {
				'X-Content-Type-Options': 'nosniff',
				'Cache-Control': 'no-store'
			}
		}
	);
}
