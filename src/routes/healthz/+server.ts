import { json } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/env';
import type { RequestHandler } from './$types';

/**
 * Health check.
 *
 * Reports whether providers are actually configured, not just that the process is up — a
 * health check that cannot fail tells you nothing. Never returns key material.
 */
export const GET: RequestHandler = () => {
	const cfg = serverConfig();

	return json(
		{
			ok: true,
			providers: {
				gemini: cfg.gemini !== null,
				groq: cfg.groq !== null
			},
			// False is not unhealthy: the deterministic engine runs client-side and is the
			// product's floor. It does mean refinement is unavailable.
			refinementAvailable: cfg.hasAnyProvider,
			llmBudgetMs: cfg.llmBudgetMs
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
