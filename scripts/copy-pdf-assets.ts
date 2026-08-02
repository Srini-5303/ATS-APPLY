/**
 * Copies pdf.js's standard font metrics into static/ so the browser build can serve them.
 *
 * Without these, pdf.js guesses widths for the 14 standard Type1 fonts, which skews every
 * x-coordinate the column and table heuristics read. Resolved from the installed package
 * rather than a hardcoded path because pnpm's store layout makes relative paths wrong.
 *
 * Runs from `prepare`, so it happens automatically after install.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = join(HERE, '..', 'static', 'pdfjs', 'standard_fonts');

function main(): void {
	const require = createRequire(import.meta.url);
	const pkgPath = require.resolve('pdfjs-dist/package.json');
	const source = join(dirname(pkgPath), 'standard_fonts');

	if (!existsSync(source)) {
		console.error(`pdfjs-dist standard_fonts not found at ${source}`);
		process.exit(1);
	}

	rmSync(DEST, { recursive: true, force: true });
	mkdirSync(DEST, { recursive: true });
	cpSync(source, DEST, { recursive: true });

	console.log(`pdf.js standard fonts -> ${DEST}`);
}

main();
