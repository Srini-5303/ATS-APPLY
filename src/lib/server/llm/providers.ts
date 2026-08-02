/**
 * LLM providers.
 *
 * `fetch` is injected rather than closed over so timeout behaviour is testable with fake
 * timers, and every call carries a deadline derived from the request's remaining budget
 * (ADR 0001 §8).
 */

export interface ProviderConfig {
	apiKey: string;
	model: string;
	fetchImpl?: typeof fetch;
}

export interface Provider {
	name: string;
	tier: 'primary' | 'fallback';
	/** Minimum time worth attempting; below this the chain skips it entirely. */
	minBudgetMs: number;
	complete(prompt: string, signal: AbortSignal): Promise<string>;
}

export class ProviderFailure extends Error {
	constructor(
		readonly provider: string,
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'ProviderFailure';
	}
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export function geminiProvider(config: ProviderConfig): Provider {
	const doFetch = config.fetchImpl ?? fetch;

	return {
		name: `gemini:${config.model}`,
		tier: 'primary',
		minBudgetMs: 8000,

		async complete(prompt, signal) {
			const response = await doFetch(
				`${GEMINI_URL}/${config.model}:generateContent?key=${config.apiKey}`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						contents: [{ parts: [{ text: prompt }] }],
						generationConfig: {
							temperature: 0.2,
							maxOutputTokens: 6144,
							responseMimeType: 'application/json'
						}
					}),
					signal
				}
			);

			if (!response.ok) {
				throw new ProviderFailure('gemini', `HTTP ${String(response.status)}`, response.status);
			}

			const body: unknown = await response.json();
			const text = (body as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
				.candidates?.[0]?.content?.parts?.[0]?.text;

			if (typeof text !== 'string' || text.trim() === '') {
				throw new ProviderFailure('gemini', 'empty response');
			}

			return text;
		}
	};
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function groqProvider(config: ProviderConfig): Provider {
	const doFetch = config.fetchImpl ?? fetch;

	return {
		name: `groq:${config.model}`,
		tier: 'fallback',
		minBudgetMs: 5000,

		async complete(prompt, signal) {
			const response = await doFetch(GROQ_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${config.apiKey}`
				},
				body: JSON.stringify({
					model: config.model,
					messages: [{ role: 'user', content: prompt }],
					temperature: 0.2,
					max_tokens: 3072,
					response_format: { type: 'json_object' }
				}),
				signal
			});

			if (!response.ok) {
				throw new ProviderFailure('groq', `HTTP ${String(response.status)}`, response.status);
			}

			const body: unknown = await response.json();
			const text = (body as { choices?: { message?: { content?: string } }[] }).choices?.[0]
				?.message?.content;

			if (typeof text !== 'string' || text.trim() === '') {
				throw new ProviderFailure('groq', 'empty response');
			}

			return text;
		}
	};
}
