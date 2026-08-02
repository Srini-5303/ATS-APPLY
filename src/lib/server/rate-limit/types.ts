/**
 * Rate limiter contract.
 *
 * An interface rather than a bare Map because the in-memory implementation is **not correct
 * on Vercel Edge**: instances are ephemeral and unshared, so a "10 per minute" limit is really
 * 10 × the number of live isolates, and a cold start resets the counter. That is fine for a
 * self-hosted adapter-node deployment and fine for local development; it is not real abuse
 * protection on serverless.
 *
 * Keeping the route behind this interface means swapping in a KV-backed implementation is a
 * one-line change rather than a refactor. Until that lands the limit is not claimed in
 * user-facing documentation (ADR 0001, non-blocking issues).
 */

export interface RateLimitVerdict {
	allowed: boolean;
	/** Seconds until the caller may retry. Only meaningful when `allowed` is false. */
	retryAfterSec: number;
	/** Which window rejected the request, for logging. */
	scope?: 'minute' | 'day';
}

export interface RateLimiter {
	check(key: string): RateLimitVerdict;
	stats(): { trackedKeys: number; minuteEntries: number; dayEntries: number };
}

export const MAX_REQUESTS_PER_MINUTE = 10;
export const MAX_REQUESTS_PER_DAY = 200;
