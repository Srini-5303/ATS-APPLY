import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PdfjsModule, PdfjsRuntime } from '$engine/parser/pdf';

/**
 * Node pdf.js runtime for tests and scripts.
 *
 * Lives here rather than in the engine so that no Node builtin is reachable from
 * `src/lib/engine/**` — Vite statically analyses both sides of a conditional import and was
 * pulling node:module into the browser bundle.
 *
 * The legacy build avoids the DOMMatrix/Path2D dependencies that make the standard build
 * unusable outside a browser.
 */
let cached: PdfjsRuntime | null = null;

export async function nodePdfjsRuntime(): Promise<PdfjsRuntime> {
	if (cached) return cached;

	const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;

	// Resolve fonts out of the installed package; pnpm's store layout makes any hardcoded
	// ../node_modules path wrong.
	const require = createRequire(import.meta.url);
	const pkg = require.resolve('pdfjs-dist/package.json');
	const fontsDir = join(dirname(pkg), 'standard_fonts', '/');

	cached = { mod, standardFontDataUrl: pathToFileURL(fontsDir).href };
	return cached;
}
