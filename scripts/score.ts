/**
 * CLI scoring harness.
 *
 * Proves the whole engine end-to-end with no UI, and is the tool used to eyeball
 * calibration while tuning thresholds.
 *
 *   pnpm score tests/fixtures/pdf/single-column-clean.pdf
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { extractPdfGeometry } from '../src/lib/engine/parser/pdf';
import { parsedResumeFromGeometry, parseResumeText } from '../src/lib/engine/parser';
import { scoreResume } from '../src/lib/engine/scorer';
import { toScoringInput } from '../src/lib/engine/scorer/to-scoring-input';
import { DIMENSIONS } from '../src/lib/engine/types/scoring';
import { nodePdfjsRuntime } from '../tests/helpers/pdfjs-node';
import type { ParseResult } from '../src/lib/engine/types/parser';

async function parse(path: string): Promise<ParseResult> {
	const buf = readFileSync(path);

	if (extname(path).toLowerCase() === '.pdf') {
		const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		const geometry = await extractPdfGeometry(data, await nodePdfjsRuntime());
		return parsedResumeFromGeometry(geometry);
	}

	return parseResumeText(buf.toString('utf8'));
}

function pad(s: string, width: number): string {
	return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

async function main(): Promise<void> {
	const [path, jdPath] = process.argv.slice(2);

	if (!path) {
		console.error('usage: pnpm score <resume.pdf|resume.txt> [job-description.txt]');
		process.exit(1);
	}

	const parsed = await parse(path);

	if (!parsed.success || !parsed.resume) {
		console.error('Parse failed:');
		for (const e of parsed.errors) console.error(`  [${e.code}] ${e.message}`);
		process.exit(1);
	}

	const resume = parsed.resume;
	const jd = jdPath ? readFileSync(jdPath, 'utf8') : undefined;
	const results = scoreResume(toScoringInput(resume, jd));

	console.log(`\n${path}`);
	console.log(
		`  ${String(resume.metadata.wordCount)} words, ${String(resume.metadata.pageCount)} page(s), ` +
			`${String(resume.sections.length)} sections, ${String(resume.skills.length)} skills`
	);
	console.log(`  sections: ${resume.sections.map((s) => s.type).join(', ')}`);

	if (parsed.warnings.length > 0) {
		console.log('\n  warnings:');
		for (const w of parsed.warnings) console.log(`    - ${w.message}`);
	}

	const cols = DIMENSIONS.map((d) => d.slice(0, 6));
	console.log(
		`\n  ${pad('platform', 16)}${pad('overall', 9)}${pad('pass', 6)}${cols.map((c) => pad(c, 8)).join('')}`
	);
	console.log(`  ${'-'.repeat(16 + 9 + 6 + cols.length * 8)}`);

	for (const r of results) {
		const cells = DIMENSIONS.map((d) => pad(String(r.breakdown[d].score), 8)).join('');
		console.log(
			`  ${pad(r.system, 16)}${pad(String(r.overallScore), 9)}${pad(r.passesFilter ? 'yes' : 'no', 6)}${cells}`
		);
	}

	const scores = results.map((r) => r.overallScore);
	const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
	const mode = results[0]?.breakdown.keywordMatch.isIndustryProxy ? 'general' : 'targeted';
	console.log(
		`\n  average ${avg.toFixed(1)}   spread ${String(Math.max(...scores) - Math.min(...scores))}   mode: ${mode}`
	);

	const suggestions = results.flatMap((r) => r.suggestions);
	if (suggestions.length > 0) {
		console.log('\n  suggestions:');
		for (const s of suggestions)
			console.log(`    [${s.impact}] ${s.platforms.join('/')}: ${s.summary}`);
	}
	console.log();
}

void main();
