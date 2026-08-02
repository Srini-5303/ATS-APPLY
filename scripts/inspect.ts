/**
 * Prints the full parse tree for one file. Debugging aid for the extractors — complements
 * `scripts/score.ts`, which shows only the scores.
 *
 *   pnpm inspect tests/fixtures/pdf/single-column-clean.pdf
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { extractPdfGeometry } from '../src/lib/engine/parser/pdf';
import { parsedResumeFromGeometry, parseResumeText } from '../src/lib/engine/parser';
import { nodePdfjsRuntime } from '../tests/helpers/pdfjs-node';

async function main(): Promise<void> {
	const path = process.argv[2];
	if (!path) {
		console.error('usage: pnpm inspect <resume.pdf|resume.txt>');
		process.exit(1);
	}

	const buf = readFileSync(path);
	const parsed =
		extname(path).toLowerCase() === '.pdf'
			? parsedResumeFromGeometry(
					await extractPdfGeometry(
						buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
						await nodePdfjsRuntime()
					)
				)
			: parseResumeText(buf.toString('utf8'));

	if (!parsed.resume) {
		console.error('parse failed:', parsed.errors);
		process.exit(1);
	}

	const r = parsed.resume;

	console.log('\ncontact');
	for (const [k, v] of Object.entries(r.contact)) console.log(`  ${k.padEnd(10)} ${String(v)}`);

	console.log(`\nsections (${String(r.sections.length)})`);
	for (const s of r.sections) {
		console.log(
			`  ${s.type.padEnd(15)} "${s.heading ?? '(implicit)'}"  ${String(s.content.length)} lines`
		);
	}

	console.log(`\nexperience (${String(r.experience.length)})`);
	for (const e of r.experience) {
		console.log(`  title:   ${String(e.title)}`);
		console.log(`  company: ${String(e.company)}`);
		console.log(`  loc:     ${String(e.location)}`);
		console.log(`  dates:   ${JSON.stringify(e.dates)}`);
		console.log(`  bullets: ${String(e.bullets.length)}`);
		console.log('');
	}

	console.log(`education (${String(r.education.length)})`);
	for (const e of r.education) console.log(`  ${JSON.stringify(e)}`);

	console.log(`\nprojects (${String(r.projects.length)})`);
	for (const p of r.projects) console.log(`  ${JSON.stringify(p)}`);

	console.log(`\ncertifications (${String(r.certifications.length)})`);
	for (const c of r.certifications) console.log(`  ${JSON.stringify(c)}`);

	console.log(`\nskills (${String(r.skills.length)}): ${r.skills.join(', ')}`);
	console.log(`\nsummary: ${r.summary ?? '(none)'}\n`);
}

void main();
