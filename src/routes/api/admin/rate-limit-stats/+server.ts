import { json } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/env';
import { rateLimiter, responseCache } from '$lib/server/instances';
import type { RequestHandler } from './$types';

/**
 * Rate-limit statistics (PRD §9.4).
 *
 * Returns 404 rather than 401 when no ADMIN_TOKEN is set: an unconfigured admin surface
 * should not advertise that it exists.
 */

/**
 * Constant-time comparison.
 *
 * `node:crypto.timingSafeEqual` is unavailable on Edge, and `a === b` on secrets leaks length
 * and prefix through timing. Compares every byte regardless of where the first mismatch is.
 */
function safeEqual(a: string, b: string): boolean {
	const left = new TextEncoder().encode(a);
	const right = new TextEncoder().encode(b);

	// Length itself is not secret enough to branch on, but the loop must still be fixed-length.
	let mismatch = left.length ^ right.length;
	const max = Math.max(left.length, right.length);

	for (let i = 0; i < max; i++) {
		mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
	}

	return mismatch === 0;
}

export const GET: RequestHandler = ({ request }) => {
	const expected = serverConfig().adminToken;
	if (expected === null) return new Response('Not found', { status: 404 });

	const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	if (!safeEqual(supplied, expected)) {
		return new Response('Not found', { status: 404 });
	}

	return json(
		{
			rateLimit: rateLimiter.stats(),
			cache: { entries: responseCache.size },
			// Instance-local. On Edge these numbers describe whichever isolate answered, not
			// the deployment — see rate-limit/types.ts.
			scope: 'isolate'
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
