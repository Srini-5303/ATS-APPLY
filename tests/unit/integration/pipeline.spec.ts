import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractPdfGeometry, type PdfjsRuntime } from '$engine/parser/pdf';
import { parsedResumeFromGeometry, parseResumeText } from '$engine/parser';
import { scoreResume } from '$engine/scorer';
import { toScoringInput } from '$engine/scorer/to-scoring-input';
import { DIMENSIONS } from '$engine/types/scoring';
import type { ScoreResult } from '$engine/types/scoring';
import { nodePdfjsRuntime } from '../../helpers/pdfjs-node';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'pdf');

let runtime: PdfjsRuntime;

beforeAll(async () => {
	runtime = await nodePdfjsRuntime();
});

async function scoreFixture(name: string): Promise<ScoreResult[]> {
	const buf = readFileSync(join(FIXTURES, `${name}.pdf`));
	const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

	const geometry = await extractPdfGeometry(data, runtime);
	const parsed = parsedResumeFromGeometry(geometry);

	expect(parsed.success).toBe(true);
	expect(parsed.resume).not.toBeNull();

	return scoreResume(toScoringInput(parsed.resume!));
}

describe('parse -> score pipeline', () => {
	it('produces one result per platform', async () => {
		const results = await scoreFixture('single-column-clean');

		expect(results).toHaveLength(6);
		expect(results.map((r) => r.system)).toEqual([
			'Workday',
			'Taleo',
			'iCIMS',
			'Greenhouse',
			'Lever',
			'SuccessFactors'
		]);
	});

	it('detects the standard sections of a well-structured resume', async () => {
		const buf = readFileSync(join(FIXTURES, 'single-column-clean.pdf'));
		const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		const parsed = parsedResumeFromGeometry(await extractPdfGeometry(data, runtime));

		const types = new Set(parsed.resume?.sections.map((s) => s.type));
		expect(types).toContain('experience');
		expect(types).toContain('education');
		expect(types).toContain('skills');
		expect(types).toContain('summary');
	});

	it('extracts individual skills from the skills section', async () => {
		const buf = readFileSync(join(FIXTURES, 'single-column-clean.pdf'));
		const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		const parsed = parsedResumeFromGeometry(await extractPdfGeometry(data, runtime));

		const skills = parsed.resume?.skills.map((s) => s.toLowerCase()) ?? [];
		expect(skills).toContain('go');
		expect(skills).toContain('kubernetes');
		expect(skills).toContain('postgresql');
	});

	it('differentiates platforms rather than returning six identical scores', async () => {
		// The entire product premise. Under PRD §7.5's literal "keyword = 100 when no JD",
		// every platform returned exactly 100 here (ADR 0001 §1).
		const results = await scoreFixture('single-column-clean');
		const scores = results.map((r) => r.overallScore);

		expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(0);
		expect(new Set(scores).size).toBeGreaterThan(1);
	});

	it('never emits NaN, even for a resume with no bullets', async () => {
		// three-line-stub is the exact input that produced NaN under the unguarded 0/0 in
		// PRD §7.7 (ADR 0001 §4).
		const results = await scoreFixture('three-line-stub');

		for (const result of results) {
			expect(Number.isFinite(result.overallScore)).toBe(true);
			expect(result.overallScore).toBeGreaterThanOrEqual(0);
			expect(result.overallScore).toBeLessThanOrEqual(100);

			for (const dimension of DIMENSIONS) {
				const score = result.breakdown[dimension].score;
				expect(Number.isFinite(score), `${result.system}.${dimension}`).toBe(true);
				expect(score).toBeGreaterThanOrEqual(0);
				expect(score).toBeLessThanOrEqual(100);
			}
		}
	});

	it('scores a bare stub far below a strong resume', async () => {
		const strong = await scoreFixture('single-column-clean');
		const stub = await scoreFixture('three-line-stub');

		const avg = (rs: ScoreResult[]) => rs.reduce((s, r) => s + r.overallScore, 0) / rs.length;
		expect(avg(strong)).toBeGreaterThan(avg(stub) + 20);
	});

	it('penalises a three-page resume most heavily on the strictest parser', async () => {
		const results = await scoreFixture('three-page');
		const byId = new Map(results.map((r) => [r.platformId, r]));

		const workday = byId.get('workday');
		const lever = byId.get('lever');

		// Workday charges both the page-count penalty and its truncation quirk; Lever's 0.35
		// strictness barely reacts.
		expect(workday?.breakdown.formatting.issues).toContain('Longer than two pages');
		expect(workday?.breakdown.formatting.score).toBeLessThan(
			lever?.breakdown.formatting.score ?? 100
		);
	});

	it('is deterministic', async () => {
		const a = await scoreFixture('single-column-clean');
		const b = await scoreFixture('single-column-clean');
		expect(a).toEqual(b);
	});
});

describe('parseResumeText', () => {
	it('parses pasted plain text and preserves blank-line structure', () => {
		const parsed = parseResumeText(
			['Alex Morgan', 'alex@example.com', '', 'EXPERIENCE', '- Built things', ''].join('\n')
		);

		expect(parsed.success).toBe(true);
		expect(parsed.resume?.metadata.fileType).toBe('text');
		expect(parsed.resume?.sections.some((s) => s.type === 'experience')).toBe(true);

		// blankBefore has to survive the empty-line filter — PRD §5.4 dropped it, which broke
		// the section heuristics that depend on it (ADR 0001 §10).
		const lines = parsed.resume?.lines ?? [];
		expect(lines).not.toContain('');
	});

	it('reports an empty document rather than throwing', () => {
		const parsed = parseResumeText('   \n  \n ');

		expect(parsed.success).toBe(false);
		expect(parsed.errors[0]?.code).toBe('EMPTY');
	});
});
