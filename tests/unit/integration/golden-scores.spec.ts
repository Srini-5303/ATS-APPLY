import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parsedResumeFromGeometry } from '$engine/parser';
import { extractPdfGeometry, type PdfjsRuntime } from '$engine/parser/pdf';
import { scoreResume } from '$engine/scorer';
import { toScoringInput } from '$engine/scorer/to-scoring-input';
import { DIMENSIONS } from '$engine/types/scoring';
import { nodePdfjsRuntime } from '../../helpers/pdfjs-node';

/**
 * Golden score snapshots.
 *
 * Committed now rather than in Phase 1 on purpose: before all six dimensions were real, every
 * change rewrote these files and reviewers would have stopped reading the diffs. Now a diff
 * means scoring behaviour genuinely moved.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PDF_DIR = join(HERE, '..', '..', 'fixtures', 'pdf');
const JD_DIR = join(HERE, '..', '..', 'fixtures', 'jd');
const EXPECTED = join(HERE, '..', '..', 'fixtures', 'expected', 'score');

let runtime: PdfjsRuntime;
beforeAll(async () => {
	runtime = await nodePdfjsRuntime();
});

function bytes(path: string): ArrayBuffer {
	const buf = readFileSync(path);
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function scoresFor(fixture: string, jd?: string) {
	const parsed = parsedResumeFromGeometry(
		await extractPdfGeometry(bytes(join(PDF_DIR, `${fixture}.pdf`)), runtime)
	);

	const jdText = jd ? readFileSync(join(JD_DIR, `${jd}.txt`), 'utf8') : undefined;
	const results = scoreResume(toScoringInput(parsed.resume!, jdText));

	return results.map((r) => ({
		platform: r.platformId,
		overall: r.overallScore,
		passes: r.passesFilter,
		dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, r.breakdown[d].score])),
		suggestions: r.suggestions.map((s) => `[${s.impact}] ${s.summary}`)
	}));
}

const scorable = readdirSync(PDF_DIR)
	.filter((f) => f.endsWith('.pdf'))
	.map((f) => f.replace(/\.pdf$/, ''))
	// This one has no text layer and errors before scoring; the parse golden covers it.
	.filter((n) => n !== 'scanned-image-only')
	.sort();

describe('golden scores — general mode', () => {
	it.each(scorable)('%s', async (name) => {
		await expect(JSON.stringify(await scoresFor(name), null, 2)).toMatchFileSnapshot(
			join(EXPECTED, `${name}.json`)
		);
	});
});

describe('golden scores — targeted mode', () => {
	it.each([
		['single-column-clean', 'backend-senior'],
		['single-column-clean', 'marketing-manager'],
		['two-column-true', 'backend-senior']
	])('%s against %s', async (fixture, jd) => {
		await expect(JSON.stringify(await scoresFor(fixture, jd), null, 2)).toMatchFileSnapshot(
			join(EXPECTED, `${fixture}--${jd}.json`)
		);
	});
});

describe('calibration anchors', () => {
	async function averageOf(fixture: string, jd?: string): Promise<number> {
		const scores = (await scoresFor(fixture, jd)).map((r) => r.overall);
		return scores.reduce((a, b) => a + b, 0) / scores.length;
	}

	it("lands the three-line stub in PRD §8.2's 10-25 band", async () => {
		// Implemented literally, PRD §7.5 put this at 58 — the free keyword 100 alone was
		// worth 30 of those points (ADR 0001 §1).
		const average = await averageOf('three-line-stub');
		expect(average).toBeGreaterThanOrEqual(10);
		expect(average).toBeLessThanOrEqual(25);
	});

	it('lands a strong resume in the 75-95 band', async () => {
		const average = await averageOf('single-column-clean');
		expect(average).toBeGreaterThanOrEqual(75);
		expect(average).toBeLessThanOrEqual(95);
	});

	it('orders the corpus from worst to best as a human would', async () => {
		const stub = await averageOf('three-line-stub');
		const sparse = await averageOf('all-caps-headers');
		const columned = await averageOf('two-column-true');
		const clean = await averageOf('single-column-clean');

		expect(stub).toBeLessThan(sparse);
		expect(sparse).toBeLessThan(columned);
		expect(columned).toBeLessThan(clean);
	});

	it('rewards a matching job description over a mismatched one', async () => {
		const matched = await averageOf('single-column-clean', 'backend-senior');
		const mismatched = await averageOf('single-column-clean', 'marketing-manager');

		expect(matched).toBeGreaterThan(mismatched + 10);
	});
});
