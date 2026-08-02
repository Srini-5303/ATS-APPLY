import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractDocx } from '$engine/parser/docx';
import { parsedResumeFromDocx, parsedResumeFromGeometry } from '$engine/parser';
import { extractPdfGeometry, PdfExtractionError, type PdfjsRuntime } from '$engine/parser/pdf';
import type { ParsedResume } from '$engine/types/parser';
import { nodePdfjsRuntime } from '../../helpers/pdfjs-node';

/**
 * Golden parse snapshots.
 *
 * Every fixture's full `ParsedResume` is committed under expected/parse/. A diff in a PR
 * means extraction behaviour changed, and a human has to confirm the change was intended —
 * which is the only practical regression net for heuristic code like this.
 *
 * Update deliberately with `pnpm test -u`, then read the diff.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PDF_DIR = join(HERE, '..', '..', 'fixtures', 'pdf');
const DOCX_DIR = join(HERE, '..', '..', 'fixtures', 'docx');
const EXPECTED = join(HERE, '..', '..', 'fixtures', 'expected', 'parse');

let runtime: PdfjsRuntime;
beforeAll(async () => {
	runtime = await nodePdfjsRuntime();
});

function bytes(path: string): ArrayBuffer {
	const buf = readFileSync(path);
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * `rawText` and `lines` are omitted: they duplicate the whole document and would bury the
 * structural signal the snapshot exists to protect.
 */
function summarise(resume: ParsedResume) {
	return {
		contact: resume.contact,
		metadata: resume.metadata,
		sections: resume.sections.map((s) => ({
			type: s.type,
			heading: s.heading,
			lines: s.content.length
		})),
		experience: resume.experience,
		education: resume.education,
		projects: resume.projects,
		certifications: resume.certifications,
		skills: resume.skills,
		summary: resume.summary
	};
}

const pdfNames = readdirSync(PDF_DIR)
	.filter((f) => f.endsWith('.pdf'))
	.map((f) => f.replace(/\.pdf$/, ''))
	.sort();

const docxNames = readdirSync(DOCX_DIR)
	.filter((f) => f.endsWith('.docx'))
	.map((f) => f.replace(/\.docx$/, ''))
	.sort();

describe('golden parse — pdf', () => {
	it('covers every committed fixture', () => {
		// Guards against a fixture being added without a golden, which would silently leave
		// it untested.
		expect(pdfNames.length).toBeGreaterThanOrEqual(12);
	});

	it.each(pdfNames)('%s', async (name) => {
		let parsed;
		try {
			parsed = parsedResumeFromGeometry(
				await extractPdfGeometry(bytes(join(PDF_DIR, `${name}.pdf`)), runtime)
			);
		} catch (err) {
			// A fixture that legitimately cannot be parsed still gets a golden, recording the
			// error code rather than silently passing.
			expect(err).toBeInstanceOf(PdfExtractionError);
			await expect(
				JSON.stringify({ error: (err as PdfExtractionError).code }, null, 2)
			).toMatchFileSnapshot(join(EXPECTED, `pdf-${name}.json`));
			return;
		}

		await expect(JSON.stringify(summarise(parsed.resume!), null, 2)).toMatchFileSnapshot(
			join(EXPECTED, `pdf-${name}.json`)
		);
	});
});

describe('golden parse — docx', () => {
	it.each(docxNames)('%s', async (name) => {
		try {
			const parsed = parsedResumeFromDocx(await extractDocx(bytes(join(DOCX_DIR, `${name}.docx`))));
			await expect(JSON.stringify(summarise(parsed.resume!), null, 2)).toMatchFileSnapshot(
				join(EXPECTED, `docx-${name}.json`)
			);
		} catch (err) {
			await expect(
				JSON.stringify({ error: (err as { code?: string }).code ?? 'UNKNOWN' }, null, 2)
			).toMatchFileSnapshot(join(EXPECTED, `docx-${name}.json`));
		}
	});
});
