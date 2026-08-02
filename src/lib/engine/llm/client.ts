import type { ScoreResult } from '../types/scoring';

/**
 * Browser-side client for the refinement endpoint.
 *
 * The caller already has deterministic scores on screen; every failure mode here resolves to
 * "keep what you have" rather than an error state (ADR 0001 §2).
 */

/**
 * Below the server's 55s budget so the server always answers first.
 *
 * PRD §8.6 had the client wait 65s against a 60s function limit, which meant the platform
 * killed the request before the client gave up and the user saw a network error instead of a
 * clean fallback (ADR 0001 §8).
 */
export const CLIENT_TIMEOUT_MS = 50_000;

export type RefineResult =
	| { status: 'ok'; results: ScoreResult[]; provider: string; fallback: boolean; cached: boolean }
	| { status: 'rate_limited'; retryAfterSec: number }
	| { status: 'cancelled' }
	| { status: 'error' };

export interface RefineOptions {
	resumeText: string;
	jobDescription?: string;
	baseline: ScoreResult[];
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}

export async function refineScores(options: RefineOptions): Promise<RefineResult> {
	const doFetch = options.fetchImpl ?? fetch;
	const controller = new AbortController();

	const timer = setTimeout(() => {
		controller.abort();
	}, CLIENT_TIMEOUT_MS);

	// Honour a caller-supplied cancellation (user reset) alongside our own timeout.
	const onExternalAbort = () => {
		controller.abort();
	};
	options.signal?.addEventListener('abort', onExternalAbort);

	try {
		const response = await doFetch('/api/analyze', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				resumeText: options.resumeText,
				jobDescription: options.jobDescription,
				baseline: options.baseline
			}),
			signal: controller.signal
		});

		if (response.status === 429) {
			const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '60', 10);
			return {
				status: 'rate_limited',
				retryAfterSec: Number.isFinite(retryAfter) ? retryAfter : 60
			};
		}

		if (!response.ok) return { status: 'error' };

		const body = (await response.json()) as {
			results?: ScoreResult[];
			_provider?: string;
			_fallback?: boolean;
			_cached?: boolean;
		};

		if (!Array.isArray(body.results) || body.results.length === 0) return { status: 'error' };

		return {
			status: 'ok',
			results: body.results,
			provider: body._provider ?? 'unknown',
			fallback: body._fallback ?? false,
			cached: body._cached ?? false
		};
	} catch (err) {
		if (options.signal?.aborted) return { status: 'cancelled' };
		if (err instanceof Error && err.name === 'AbortError') return { status: 'cancelled' };
		return { status: 'error' };
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener('abort', onExternalAbort);
	}
}
