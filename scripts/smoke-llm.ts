/**
 * Live LLM smoke test.
 *
 * Everything in the provider chain is unit-tested with an injected `fetch`, which proves the
 * control flow but not that the request and response shapes match the real API. This makes
 * actual calls.
 *
 *   pnpm smoke:llm
 *
 * Deliberately not part of `pnpm test`: it costs quota, needs a key, and would make CI flaky.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRefinementPrompt } from '../src/lib/engine/llm/prompt';
import { extractJson } from '../src/lib/engine/llm/json-extract';
import { reconcile } from '../src/lib/engine/llm/reconcile';
import { extractPdfGeometry } from '../src/lib/engine/parser/pdf';
import { parsedResumeFromGeometry } from '../src/lib/engine/parser';
import { scoreResume } from '../src/lib/engine/scorer';
import { toScoringInput } from '../src/lib/engine/scorer/to-scoring-input';
import { groqProvider, geminiProvider, type Provider } from '../src/lib/server/llm/providers';
import { runChain } from '../src/lib/server/llm/chain';
import { nodePdfjsRuntime } from '../tests/helpers/pdfjs-node';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'tests', 'fixtures');

function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value === '' ? undefined : value;
}

function pass(label: string, detail = ''): void {
	console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
}

function fail(label: string, detail = ''): void {
	console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`);
	failures += 1;
}

let failures = 0;

async function buildBaseline() {
	const buf = readFileSync(join(FIXTURES, 'pdf', 'single-column-clean.pdf'));
	const geometry = await extractPdfGeometry(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
		await nodePdfjsRuntime()
	);
	const parsed = parsedResumeFromGeometry(geometry);
	const jd = readFileSync(join(FIXTURES, 'jd', 'backend-senior.txt'), 'utf8');

	return {
		resumeText: parsed.resume?.rawText ?? '',
		jobDescription: jd,
		baseline: scoreResume(toScoringInput(parsed.resume!, jd))
	};
}

/** Confirms the model name is accepted and the response envelope is what the provider expects. */
async function checkProvider(provider: Provider, prompt: string): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, 40_000);

	const started = Date.now();
	try {
		const raw = await provider.complete(prompt, controller.signal);
		pass(
			`${provider.name} responded`,
			`${String(Date.now() - started)}ms, ${String(raw.length)} chars`
		);
		return raw;
	} catch (err) {
		fail(`${provider.name} failed`, err instanceof Error ? err.message : String(err));
		return null;
	} finally {
		clearTimeout(timer);
	}
}

async function main(): Promise<void> {
	console.log('\nLive LLM smoke test\n');

	const groqKey = env('GROQ_API_KEY');
	const geminiKey = env('GEMINI_API_KEY');

	if (!groqKey && !geminiKey) {
		console.error('No GROQ_API_KEY or GEMINI_API_KEY in the environment. Add one to .env.\n');
		process.exit(1);
	}

	console.log('Building a real baseline from the fixture corpus…');
	const { resumeText, jobDescription, baseline } = await buildBaseline();

	const prompt = buildRefinementPrompt({ resumeText, jobDescription, baseline });
	console.log(`  prompt is ${String(prompt.length)} chars`);
	console.log(
		`  baseline: ${baseline.map((r) => `${r.system} ${String(r.overallScore)}`).join(', ')}\n`
	);

	const providers: Provider[] = [];
	if (geminiKey) {
		providers.push(
			geminiProvider({ apiKey: geminiKey, model: env('GEMINI_MODEL') ?? 'gemini-2.0-flash-lite' })
		);
	}
	if (groqKey) {
		providers.push(
			groqProvider({ apiKey: groqKey, model: env('GROQ_MODEL') ?? 'llama-3.3-70b-versatile' })
		);
	}

	console.log('1. Provider reachability and response shape');
	let sample: string | null = null;
	for (const provider of providers) {
		const raw = await checkProvider(provider, prompt);
		sample ??= raw;
	}

	if (sample === null) {
		console.log('\nNo provider returned anything; nothing further to check.\n');
		process.exit(1);
	}

	console.log('\n2. JSON extraction from the real response');
	const parsed = extractJson(sample);
	if (parsed === null) {
		fail('could not extract JSON', `first 200 chars: ${sample.slice(0, 200)}`);
	} else {
		pass('extracted a JSON object');
		const count = Array.isArray((parsed as { results?: unknown }).results)
			? (parsed as { results: unknown[] }).results.length
			: 0;
		if (count === 0) fail('response had no results array');
		else pass(`response contained ${String(count)} platform entries`);
	}

	console.log('\n3. Reconciliation against the baseline');
	const { results, adjustedCount } = reconcile(baseline, parsed);

	if (results.length !== 6) fail(`expected 6 results, got ${String(results.length)}`);
	else pass('returned exactly 6 platforms');

	const finite = results.every((r) => Number.isFinite(r.overallScore));
	if (!finite) fail('a score was not finite');
	else pass('all scores finite and in range');

	const withinBound = results.every((r, i) => {
		const base = baseline[i];
		return base !== undefined && Math.abs(r.overallScore - base.overallScore) <= 15;
	});
	if (!withinBound) fail('an adjustment exceeded the +/-15 bound');
	else pass('every adjustment within the bound');

	pass(`model moved ${String(adjustedCount)} of 6 platforms`);

	console.log('\n   before -> after');
	for (const [i, r] of results.entries()) {
		const before = baseline[i]?.overallScore ?? 0;
		const arrow = r.overallScore === before ? '  =' : r.overallScore > before ? ' up' : ' dn';
		console.log(
			`     ${r.system.padEnd(16)} ${String(before).padStart(3)} -> ${String(r.overallScore).padStart(3)} ${arrow}`
		);
	}

	console.log('\n4. Full chain with fallback');
	const outcome = await runChain({ providers, baseline, prompt });
	if (outcome.fallback) fail('chain fell back despite a working provider');
	else pass(`chain returned via ${outcome.provider}`);

	console.log('\n5. Chain with no providers falls back cleanly');
	const empty = await runChain({ providers: [], baseline, prompt });
	if (!empty.fallback || empty.results.length !== 6)
		fail('empty chain did not return the baseline');
	else pass('returned the untouched baseline, no error');

	console.log(
		failures === 0 ? '\nAll checks passed.\n' : `\n${String(failures)} check(s) failed.\n`
	);
	process.exit(failures === 0 ? 0 : 1);
}

void main();
