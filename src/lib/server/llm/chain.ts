import { extractJson } from '$engine/llm/json-extract';
import { reconcile } from '$engine/llm/reconcile';
import type { ScoreResult } from '$engine/types/scoring';
import { log } from '$lib/log';
import type { Provider } from './providers';

/**
 * Provider chain with a single shared deadline.
 *
 * PRD §8.4 gave each provider its own independent timeout — 240s + 30s + 15s — against a 60s
 * platform limit, so an Ollama-enabled request was guaranteed to be killed mid-flight with the
 * fallback never reached. One budget is computed at request entry and every provider gets
 * whatever remains; a provider that cannot fit is skipped rather than started and killed
 * (ADR 0001 §8).
 */

/** Below the platform's 60s function limit, with room to serialise the response. */
export const DEFAULT_BUDGET_MS = 55_000;

/** Reserved for reconciling and serialising after the last provider returns. */
const WRAP_UP_RESERVE_MS = 1500;

export interface ChainOutcome {
	results: ScoreResult[];
	provider: string;
	/** True when no provider contributed and the baseline is being returned as-is. */
	fallback: boolean;
	adjustedCount: number;
}

export interface ChainOptions {
	providers: Provider[];
	baseline: ScoreResult[];
	prompt: string;
	budgetMs?: number;
	now?: () => number;
}

export async function runChain({
	providers,
	baseline,
	prompt,
	budgetMs = DEFAULT_BUDGET_MS,
	now = Date.now
}: ChainOptions): Promise<ChainOutcome> {
	const deadline = now() + budgetMs;

	for (const provider of providers) {
		const remaining = deadline - now() - WRAP_UP_RESERVE_MS;

		if (remaining < provider.minBudgetMs) {
			log.info('skipping provider, insufficient budget', {
				provider: provider.name,
				remainingMs: remaining,
				needsMs: provider.minBudgetMs
			});
			continue;
		}

		const controller = new AbortController();
		const timer = setTimeout(() => {
			controller.abort();
		}, remaining);
		const startedAt = now();

		try {
			const raw = await provider.complete(prompt, controller.signal);
			const parsed = extractJson(raw);

			if (parsed === null) {
				// Malformed or truncated JSON is a provider failure, not a fatal error — fall
				// through to the next one.
				log.warn('provider returned unparseable json', { provider: provider.name });
				continue;
			}

			const { results, adjustedCount } = reconcile(baseline, parsed);

			log.info('llm refinement applied', {
				provider: provider.name,
				durationMs: now() - startedAt,
				adjustedCount
			});

			return { results, provider: provider.name, fallback: false, adjustedCount };
		} catch (err) {
			log.warn('provider failed', {
				provider: provider.name,
				durationMs: now() - startedAt,
				err: err instanceof Error ? err.message : String(err)
			});
		} finally {
			clearTimeout(timer);
		}
	}

	// Every provider failed or was skipped. The deterministic scores are already correct and
	// already on the user's screen, so this is a degraded refinement — never an error
	// (ADR 0001 §9).
	log.info('llm unavailable, returning deterministic baseline', {
		providerCount: providers.length
	});

	return { results: baseline, provider: 'rule-based', fallback: true, adjustedCount: 0 };
}
