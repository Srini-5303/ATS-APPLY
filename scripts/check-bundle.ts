/**
 * Bundle budget (PRD §17.2).
 *
 * PRD §17.2 quotes "~15KB Svelte runtime" as the initial bundle, which is the framework's own
 * figure, not a budget for an application. This measures what a first-time visitor actually
 * downloads.
 *
 * Crucially it follows the **static import graph** from the entry point. Measuring only
 * `entry/app.js` reports ~3 KB and passes trivially, because that file does nothing but
 * import the chunks that hold the real code. Dynamic imports are deliberately not followed —
 * they are the thing being kept out of first load.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(HERE, '..', '.svelte-kit', 'output', 'client');

/** Gzipped kilobytes a first-load visitor pays before any interaction. */
const ENTRY_BUDGET_KB = 200;

/** Modules that must stay behind a dynamic import. */
const MUST_BE_LAZY = ['pdfjs-dist', 'pdf.worker', 'jspdf', 'mammoth'];

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...walk(path));
		else out.push(path);
	}
	return out;
}

/** Static `import ... from '...'` and `export ... from '...'` specifiers only. */
function staticImports(source: string): string[] {
	const specifiers: string[] = [];
	const pattern = /(?:^|[\s;}])(?:import|export)\b[^'"()]*?from\s*['"]([^'"]+)['"]/g;

	let match: RegExpExecArray | null;
	while ((match = pattern.exec(source)) !== null) {
		if (match[1]) specifiers.push(match[1]);
	}

	// Bare side-effect imports: import './chunk.js'
	const bare = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g;
	while ((match = bare.exec(source)) !== null) {
		if (match[1]) specifiers.push(match[1]);
	}

	return specifiers;
}

/** Transitive closure of static imports from the given roots. */
function firstLoadGraph(roots: string[]): Set<string> {
	const seen = new Set<string>();
	const queue = [...roots];

	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;

		let source: string;
		try {
			source = readFileSync(file, 'utf8');
		} catch {
			continue;
		}

		seen.add(file);

		for (const specifier of staticImports(source)) {
			if (!specifier.startsWith('.')) continue;
			const target = resolvePath(dirname(file), specifier);
			if (!seen.has(target)) queue.push(target);
		}
	}

	return seen;
}

function gzippedKb(path: string): number {
	return gzipSync(readFileSync(path)).length / 1024;
}

function main(): void {
	let files: string[];
	try {
		files = walk(CLIENT_DIR);
	} catch {
		console.error(`No client build at ${CLIENT_DIR}. Run \`pnpm build:app\` first.`);
		process.exit(1);
	}

	const roots = files.filter((f) => f.endsWith('.js') && f.includes(join('immutable', 'entry')));

	if (roots.length === 0) {
		console.error('Could not find the entry chunks; the build layout may have changed.');
		process.exit(1);
	}

	const graph = [...firstLoadGraph(roots)].sort();
	const totalKb = graph.reduce((sum, f) => sum + gzippedKb(f), 0);

	console.log(
		`\nFirst load: ${totalKb.toFixed(1)} KB gzipped across ${String(graph.length)} chunks ` +
			`(budget ${String(ENTRY_BUDGET_KB)} KB)`
	);

	for (const file of graph.sort((a, b) => gzippedKb(b) - gzippedKb(a)).slice(0, 8)) {
		console.log(`  ${gzippedKb(file).toFixed(1).padStart(7)} KB  ${basename(file)}`);
	}

	let failed = false;

	if (totalKb > ENTRY_BUDGET_KB) {
		console.error(
			`\nFAIL: first load is ${totalKb.toFixed(1)} KB, over the ${String(ENTRY_BUDGET_KB)} KB budget.`
		);
		failed = true;
	}

	// A heavy dependency entering the static graph is the regression that actually matters —
	// far more than a few kilobytes of drift.
	const source = graph.map((f) => readFileSync(f, 'utf8')).join('\n');
	for (const module of MUST_BE_LAZY) {
		if (source.includes(module)) {
			console.error(`\nFAIL: "${module}" is in the first-load graph; it must stay dynamic.`);
			failed = true;
		}
	}

	if (failed) process.exit(1);
	console.log('\nBundle budget OK.\n');
}

main();
