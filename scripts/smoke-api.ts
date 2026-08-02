/**
 * Live HTTP smoke test against a running server.
 *
 * `smoke-llm.ts` exercises the provider chain directly; this goes through the actual route —
 * content-type check, request validation, rate limiter, cache, then the chain — so the parts
 * only reachable over HTTP get covered too.
 *
 *   pnpm dev            # in one terminal
 *   pnpm smoke:api      # in another
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPdfGeometry } from '../src/lib/engine/parser/pdf';
import { parsedResumeFromGeometry } from '../src/lib/engine/parser';
import { scoreResume } from '../src/lib/engine/scorer';
import { toScoringInput } from '../src/lib/engine/scorer/to-scoring-input';
import type { ScoreResult } from '../src/lib/engine/types/scoring';
import { nodePdfjsRuntime } from '../tests/helpers/pdfjs-node';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:5173';
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

let failures = 0;

function check(ok: boolean, label: string, detail = ''): void {
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
	if (!ok) failures += 1;
}

async function baseline(): Promise<{ resumeText: string; jd: string; results: ScoreResult[] }> {
	const buf = readFileSync(join(FIXTURES, 'pdf', 'single-column-clean.pdf'));
	const geometry = await extractPdfGeometry(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
		await nodePdfjsRuntime()
	);
	const parsed = parsedResumeFromGeometry(geometry);
	const jd = readFileSync(join(FIXTURES, 'jd', 'backend-senior.txt'), 'utf8');

	return {
		resumeText: parsed.resume?.rawText ?? '',
		jd,
		results: scoreResume(toScoringInput(parsed.resume!, jd))
	};
}

interface AnalyzeResponse {
	results?: ScoreResult[];
	_provider?: string;
	_fallback?: boolean;
	_cached?: boolean;
	error?: string;
}

async function post(body: unknown, contentType = 'application/json') {
	const response = await fetch(`${BASE}/api/analyze`, {
		method: 'POST',
		headers: { 'Content-Type': contentType },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

	let parsed: AnalyzeResponse = {};
	try {
		parsed = (await response.json()) as AnalyzeResponse;
	} catch {
		/* non-JSON responses are handled by the caller via status */
	}

	return { status: response.status, headers: response.headers, body: parsed };
}

async function main(): Promise<void> {
	console.log(`\nLive API smoke test against ${BASE}\n`);

	const health = await fetch(`${BASE}/healthz`).catch(() => null);
	if (!health?.ok) {
		console.error(`No server at ${BASE}. Start one with \`pnpm dev\`.\n`);
		process.exit(1);
	}

	const healthBody = (await health.json()) as { refinementAvailable?: boolean };
	console.log(`  refinement available: ${String(healthBody.refinementAvailable)}\n`);

	const { resumeText, jd, results } = await baseline();
	const before = results.map((r) => r.overallScore);

	console.log('1. Happy path');
	const started = Date.now();
	const ok = await post({ resumeText, jobDescription: jd, baseline: results });
	check(ok.status === 200, 'returns 200', `${String(Date.now() - started)}ms`);
	check(ok.body.results?.length === 6, 'returns six platforms');
	check(ok.body._fallback === false, 'did not fall back', `provider: ${ok.body._provider ?? '?'}`);
	check(ok.headers.get('cache-control') === 'no-store', 'sets Cache-Control: no-store');

	const after = ok.body.results?.map((r) => r.overallScore) ?? [];
	const moved = before.filter((b, i) => b !== after[i]).length;
	console.log(`        adjusted ${String(moved)} of 6 platforms`);

	console.log('\n2. Cache');
	const cached = await post({ resumeText, jobDescription: jd, baseline: results });
	check(cached.body._cached === true, 'second identical request is served from cache');

	console.log('\n3. Validation');
	const noResume = await post({ baseline: results });
	check(noResume.status === 400, 'rejects a missing resumeText');

	const noBaseline = await post({ resumeText });
	check(noBaseline.status === 400, 'rejects a missing baseline');

	const shortBaseline = await post({ resumeText, baseline: results.slice(0, 2) });
	check(shortBaseline.status === 400, 'rejects an incomplete baseline');

	const tampered = await post({
		resumeText,
		baseline: results.map((r) => ({ ...r, platformId: 'bamboo' }))
	});
	check(tampered.status === 400, 'rejects a fabricated platform id');

	const huge = await post({ resumeText: 'x'.repeat(50_001), baseline: results });
	check(huge.status === 400, 'rejects an oversized resume');

	const wrongType = await post('{}', 'text/plain');
	check(wrongType.status === 415, 'rejects a non-JSON content type');

	console.log('\n4. Other routes');
	const og = await fetch(`${BASE}/api/og?s=82&p=4`);
	check(og.ok, 'OG image renders');
	check((og.headers.get('content-type') ?? '').includes('image/svg'), 'OG image is served as SVG');

	const admin = await fetch(`${BASE}/api/admin/rate-limit-stats`);
	check(admin.status === 404, 'admin stats hidden when ADMIN_TOKEN is unset');

	const csp = await fetch(`${BASE}/`);
	const cspHeader =
		csp.headers.get('content-security-policy') ??
		csp.headers.get('content-security-policy-report-only');
	check(cspHeader !== null, 'CSP header present on documents');
	check(csp.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options set');

	console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${String(failures)} failed.\n`);
	process.exit(failures === 0 ? 0 : 1);
}

void main();
