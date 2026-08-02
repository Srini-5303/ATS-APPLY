import { env } from '$env/dynamic/private';
import { log } from '$lib/log';
import { DEFAULT_BUDGET_MS } from './llm/chain';

/**
 * Validated server configuration, read once.
 *
 * Nothing else touches `process.env`, so a missing or malformed variable surfaces here with a
 * clear message rather than as an undefined threaded three layers deep.
 */

/** Treats an unset variable and an empty one the same, which `??` alone cannot express. */
function stringFrom(raw: string | undefined, fallback: string): string {
	const trimmed = raw?.trim();
	return trimmed === undefined || trimmed === '' ? fallback : trimmed;
}

function intFrom(raw: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(raw ?? '', 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ServerConfig {
	gemini: { apiKey: string; model: string } | null;
	groq: { apiKey: string; model: string } | null;
	llmBudgetMs: number;
	adminToken: string | null;
	hasAnyProvider: boolean;
}

let cached: ServerConfig | null = null;

export function serverConfig(): ServerConfig {
	if (cached) return cached;

	const geminiKey = env.GEMINI_API_KEY?.trim();
	const groqKey = env.GROQ_API_KEY?.trim();

	cached = {
		gemini: geminiKey
			? { apiKey: geminiKey, model: stringFrom(env.GEMINI_MODEL, 'gemini-2.0-flash-lite') }
			: null,
		groq: groqKey
			? { apiKey: groqKey, model: stringFrom(env.GROQ_MODEL, 'llama-3.3-70b-versatile') }
			: null,
		llmBudgetMs: intFrom(env.LLM_BUDGET_MS, DEFAULT_BUDGET_MS),
		adminToken: stringFrom(env.ADMIN_TOKEN, '') === '' ? null : stringFrom(env.ADMIN_TOKEN, ''),
		hasAnyProvider: Boolean(geminiKey ?? groqKey)
	};

	if (!cached.hasAnyProvider) {
		// Not fatal: the deterministic engine runs client-side and is the product's floor, so
		// the app is fully usable without any key (ADR 0001 §9).
		log.warn('no LLM provider configured; scoring will not be refined');
	}

	return cached;
}

/** Test seam. */
export function resetServerConfig(): void {
	cached = null;
}
