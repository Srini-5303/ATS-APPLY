import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DocxExtractionError, extractDocx } from '$engine/parser/docx';
import { parsedResumeFromDocx } from '$engine/parser';
import { scoreResume } from '$engine/scorer';
import { toScoringInput } from '$engine/scorer/to-scoring-input';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'docx');

function load(name: string): ArrayBuffer {
	const buf = readFileSync(join(FIXTURES, `${name}.docx`));
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('extractDocx', () => {
	it('extracts text from a clean document', async () => {
		const result = await extractDocx(load('clean'));

		const text = result.lines.map((l) => l.text).join('\n');
		expect(text).toContain('ALEX MORGAN');
		expect(text).toContain('EXPERIENCE');
		expect(text).toContain('Stripe');
	});

	it('preserves blank-line structure before dropping empty lines', async () => {
		// PRD §5.4 filtered empty lines outright, destroying the signal §5.5's heuristics
		// need (ADR 0001 §10).
		const result = await extractDocx(load('clean'));

		expect(result.lines.every((l) => l.text !== '')).toBe(true);
		expect(result.lines.filter((l) => l.blankBefore).length).toBeGreaterThan(1);

		const summary = result.lines.find((l) => l.text === 'SUMMARY');
		expect(summary?.blankBefore).toBe(true);
	});

	it('detects a real table', async () => {
		expect((await extractDocx(load('with-table'))).hasTables).toBe(true);
	});

	it('does not report a table when there is none', async () => {
		expect((await extractDocx(load('clean'))).hasTables).toBe(false);
	});

	it('detects an embedded image', async () => {
		expect((await extractDocx(load('with-image'))).hasImages).toBe(true);
	});

	it('reports an empty document rather than returning nothing useful', async () => {
		// mammoth silently drops text inside text boxes, so a text-box-only resume looks
		// empty. Better to say so than to score a blank document.
		await expect(extractDocx(load('empty-body'))).rejects.toMatchObject({ code: 'EMPTY' });
	});

	it('rejects a file that is not a real docx', async () => {
		const notADocx = new TextEncoder().encode('this is plain text, not a zip').buffer;

		await expect(extractDocx(notADocx)).rejects.toBeInstanceOf(DocxExtractionError);
		await expect(extractDocx(notADocx)).rejects.toMatchObject({ code: 'CORRUPT' });
	});
});

describe('docx through the full pipeline', () => {
	it('parses and scores across all six platforms', async () => {
		const parsed = parsedResumeFromDocx(await extractDocx(load('clean')));

		expect(parsed.success).toBe(true);
		expect(parsed.resume?.metadata.fileType).toBe('docx');

		const types = new Set(parsed.resume?.sections.map((s) => s.type));
		expect(types).toContain('experience');
		expect(types).toContain('education');
		expect(types).toContain('skills');

		expect(parsed.resume?.experience.length).toBeGreaterThan(0);
		expect(parsed.resume?.skills.length).toBeGreaterThan(5);

		const results = scoreResume(toScoringInput(parsed.resume!));
		expect(results).toHaveLength(6);
		for (const r of results) expect(Number.isFinite(r.overallScore)).toBe(true);
	});

	it('does not claim to detect columns it cannot see', async () => {
		// mammoth flattens layout, so there is no geometry to analyse. Reporting false is
		// honest; guessing true would cost the user real formatting points.
		const parsed = parsedResumeFromDocx(await extractDocx(load('clean')));
		expect(parsed.resume?.metadata.hasMultipleColumns).toBe(false);
	});
});
