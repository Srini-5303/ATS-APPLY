import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server config resolution.
 *
 * `$env/dynamic/private` is a SvelteKit virtual module, so it is mocked and re-imported per
 * case rather than set through process.env.
 */
const mockEnv: Record<string, string | undefined> = {};

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

/** Replaces the mocked env in place — the module holds a reference to this object. */
function setEnv(values: Record<string, string> = {}) {
	for (const key of Object.keys(mockEnv)) mockEnv[key] = undefined;
	Object.assign(mockEnv, values);
	vi.resetModules();
}

async function load() {
	const module = await import('$lib/server/env');
	module.resetServerConfig();
	return module.serverConfig();
}

beforeEach(() => {
	setEnv();
});

describe('serverConfig', () => {
	it('treats a present-but-empty key as absent', async () => {
		// A `.env` containing `GEMINI_API_KEY=` yields an empty string, not undefined. Left
		// unnormalised, `'' ?? groqKey` evaluates to `''` — /healthz then reported
		// "refinement unavailable" while Groq was working perfectly.
		mockEnv.GEMINI_API_KEY = '';
		mockEnv.GROQ_API_KEY = 'gsk_test_key_value';

		const config = await load();

		expect(config.gemini).toBeNull();
		expect(config.groq).not.toBeNull();
		expect(config.hasAnyProvider).toBe(true);
	});

	it('treats a whitespace-only key as absent', async () => {
		mockEnv.GROQ_API_KEY = '   ';

		const config = await load();
		expect(config.groq).toBeNull();
		expect(config.hasAnyProvider).toBe(false);
	});

	it('reports no providers when nothing is set', async () => {
		const config = await load();

		expect(config.gemini).toBeNull();
		expect(config.groq).toBeNull();
		expect(config.hasAnyProvider).toBe(false);
	});

	it('keeps hasAnyProvider consistent with the individual providers', async () => {
		// The invariant /healthz depends on: it can never say "groq: true,
		// refinementAvailable: false".
		for (const combination of [
			{ GEMINI_API_KEY: 'g', GROQ_API_KEY: '' },
			{ GEMINI_API_KEY: '', GROQ_API_KEY: 'q' },
			{ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
			{ GEMINI_API_KEY: '', GROQ_API_KEY: '' }
		]) {
			setEnv(combination);

			const config = await load();
			expect(config.hasAnyProvider).toBe(config.gemini !== null || config.groq !== null);
		}
	});

	it('falls back to a default model when the name is unset or blank', async () => {
		mockEnv.GROQ_API_KEY = 'gsk_test';
		mockEnv.GROQ_MODEL = '';

		const config = await load();
		expect(config.groq?.model).toBe('llama-3.3-70b-versatile');
	});

	it('honours an explicit model override', async () => {
		mockEnv.GROQ_API_KEY = 'gsk_test';
		mockEnv.GROQ_MODEL = 'llama-3.1-8b-instant';

		const config = await load();
		expect(config.groq?.model).toBe('llama-3.1-8b-instant');
	});

	it('treats a blank ADMIN_TOKEN as unset, so the admin route stays hidden', async () => {
		mockEnv.ADMIN_TOKEN = '';
		expect((await load()).adminToken).toBeNull();
	});

	it('falls back to the default budget on a malformed value', async () => {
		mockEnv.LLM_BUDGET_MS = 'not-a-number';
		expect((await load()).llmBudgetMs).toBe(55_000);
	});
});
