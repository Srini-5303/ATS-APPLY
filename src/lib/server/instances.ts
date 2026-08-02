import { MemoryResponseCache } from './llm/cache';
import { MemoryRateLimiter } from './rate-limit/memory';

/**
 * Shared server-side singletons.
 *
 * They live here rather than in the route module for two reasons: SvelteKit rejects any
 * non-handler export from a `+server.ts`, and the admin stats endpoint needs to read the same
 * limiter the analyze endpoint writes to.
 *
 * Module scope means "per isolate", which on Edge is weaker than it looks — see
 * rate-limit/types.ts.
 */

export const rateLimiter = new MemoryRateLimiter();
export const responseCache = new MemoryResponseCache();
