import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	extractPdfGeometry as extractRaw,
	PdfExtractionError,
	type PdfGeometry,
	type PdfjsRuntime
} from '$engine/parser/pdf';
import { nodePdfjsRuntime } from '../../helpers/pdfjs-node';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'pdf');

let runtime: PdfjsRuntime;

beforeAll(async () => {
	runtime = await nodePdfjsRuntime();
});

function load(name: string): ArrayBuffer {
	const buf = readFileSync(join(FIXTURES, `${name}.pdf`));
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function extractPdfGeometry(data: ArrayBuffer): Promise<PdfGeometry> {
	return extractRaw(data, runtime);
}

describe('extractPdfGeometry', () => {
	it('extracts positioned text from a clean single-column resume', async () => {
		const geo = await extractPdfGeometry(load('single-column-clean'));

		expect(geo.pageCount).toBe(1);
		expect(geo.pageWidth).toBeCloseTo(612, 0);
		expect(geo.pageHeight).toBeCloseTo(792, 0);
		expect(geo.items.length).toBeGreaterThan(20);

		const text = geo.items.map((i) => i.str).join(' ');
		expect(text).toContain('ALEX MORGAN');
		expect(text).toContain('EXPERIENCE');
		expect(text).toContain('Stripe');
	});

	it('reports every page of a multi-page document', async () => {
		const geo = await extractPdfGeometry(load('three-page'));

		expect(geo.pageCount).toBe(3);
		expect(new Set(geo.items.map((i) => i.page))).toEqual(new Set([1, 2, 3]));
	});

	it('gives each item a usable position and size', async () => {
		const geo = await extractPdfGeometry(load('single-column-clean'));

		for (const item of geo.items) {
			expect(Number.isFinite(item.x)).toBe(true);
			expect(Number.isFinite(item.y)).toBe(true);
			expect(item.x).toBeGreaterThanOrEqual(0);
			expect(item.y).toBeGreaterThanOrEqual(0);
			expect(item.width).toBeGreaterThan(0);
		}
	});

	it('rejects a scanned page with a specific error rather than scoring it as empty', async () => {
		// A resume with no text layer must not silently score zero — the user needs to be
		// told to export a text-based PDF.
		await expect(extractPdfGeometry(load('scanned-image-only'))).rejects.toThrow(
			PdfExtractionError
		);

		await expect(extractPdfGeometry(load('scanned-image-only'))).rejects.toMatchObject({
			code: 'NO_TEXT_LAYER'
		});
	});

	it('distinguishes real artwork from glyph-sized image objects', async () => {
		// PRD §5.3 excludes XObjects under 50 units so font glyphs and rules do not read as
		// graphics.
		const withLogo = await extractPdfGeometry(load('with-logo-image'));
		const glyphOnly = await extractPdfGeometry(load('glyph-only-image'));

		expect(withLogo.hasImages).toBe(true);
		expect(glyphOnly.hasImages).toBe(false);
	});

	it('preserves ligatures and non-ASCII characters', async () => {
		const geo = await extractPdfGeometry(load('ligatures-unicode'));
		const text = geo.items.map((i) => i.str).join(' ');

		expect(text).toContain('Zo');
		expect(text).toMatch(/Universit/);
	});

	it('surfaces a two-column layout as two distinct x origins', async () => {
		// Not the column heuristic itself — just proving the geometry carries the signal the
		// heuristic will need.
		const geo = await extractPdfGeometry(load('two-column-true'));
		const xs = [...new Set(geo.items.map((i) => Math.round(i.x)))].sort((a, b) => a - b);

		expect(xs[0]).toBeCloseTo(72, 0);
		expect(xs.some((x) => x >= 250 && x <= 255)).toBe(true);
	});
});
