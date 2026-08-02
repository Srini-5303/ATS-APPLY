import type { PositionedItem } from '../types/parser';

/**
 * pdf.js text extraction, reduced to geometry.
 *
 * This module is deliberately pure: it takes bytes and returns `PositionedItem[]`. Every
 * layout heuristic then operates on that array rather than on a pdf.js page object, which
 * makes the heuristics unit-testable against hand-built synthetic input and keeps threshold
 * tuning fast (ADR 0001 §11).
 *
 * The pdf.js runtime is *injected* rather than resolved by sniffing the environment. An
 * earlier version branched on `typeof window` and dynamically imported node:module /
 * node:path to locate the font metrics — Vite statically analysed both branches and pulled
 * Node builtins into the browser bundle. Injection keeps this file browser-clean and honours
 * the engine-purity rule in PRD §4.2; `tests/helpers/pdfjs-node.ts` supplies the Node
 * runtime.
 */

/** Structural minimum for the parts of the pdf.js API this module touches. */
interface PdfTextItem {
	str: string;
	transform: number[];
	width: number;
	height: number;
}

interface PdfPage {
	getTextContent(): Promise<{ items: unknown[] }>;
	getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
	getViewport(params: { scale: number }): { width: number; height: number };
}

interface PdfDocument {
	numPages: number;
	getPage(n: number): Promise<PdfPage>;
	destroy(): Promise<void>;
}

export interface PdfjsModule {
	getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocument> };
	GlobalWorkerOptions: { workerSrc: string };
	OPS: Record<string, number>;
}

export interface PdfjsRuntime {
	mod: PdfjsModule;
	/**
	 * Where to find the Type1 metrics for the 14 standard fonts. Without them pdf.js guesses
	 * widths, which quietly skews every x-coordinate the layout heuristics read.
	 */
	standardFontDataUrl: string;
}

/** Served from static/, populated by scripts/copy-pdf-assets.ts on `prepare`. */
const BROWSER_STANDARD_FONTS = '/pdfjs/standard_fonts/';

let browserRuntime: PdfjsRuntime | null = null;

async function loadBrowserRuntime(): Promise<PdfjsRuntime> {
	if (browserRuntime) return browserRuntime;

	const mod = (await import('pdfjs-dist')) as unknown as PdfjsModule;
	// Vite rewrites this to a hashed asset URL at build time, which is the only form that
	// survives both `vite dev` and a production build.
	const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
	mod.GlobalWorkerOptions.workerSrc = workerUrl;

	browserRuntime = { mod, standardFontDataUrl: BROWSER_STANDARD_FONTS };
	return browserRuntime;
}

export class PdfExtractionError extends Error {
	readonly code: 'ENCRYPTED' | 'CORRUPT' | 'NO_TEXT_LAYER';

	constructor(code: 'ENCRYPTED' | 'CORRUPT' | 'NO_TEXT_LAYER', message: string) {
		super(message);
		this.name = 'PdfExtractionError';
		this.code = code;
	}
}

export interface PdfGeometry {
	items: PositionedItem[];
	pageCount: number;
	/** Page width in PDF user-space units, used to normalise layout thresholds. */
	pageWidth: number;
	pageHeight: number;
	hasImages: boolean;
}

/**
 * Rendered size below which an image XObject is assumed to be a glyph or a rule rather than
 * real artwork (PRD §5.3 step 3). In user-space units, so ~0.7 inch.
 */
const MIN_MEANINGFUL_IMAGE_SIZE = 50;

function isTextItem(item: unknown): item is PdfTextItem {
	return (
		typeof item === 'object' &&
		item !== null &&
		typeof (item as PdfTextItem).str === 'string' &&
		Array.isArray((item as PdfTextItem).transform)
	);
}

async function pageHasMeaningfulImage(
	page: PdfPage,
	ops: Record<string, number>
): Promise<boolean> {
	const { fnArray, argsArray } = await page.getOperatorList();

	const imageOps = new Set(
		[ops.paintImageXObject, ops.paintImageMaskXObject, ops.paintInlineImageXObject].filter(
			(n): n is number => typeof n === 'number'
		)
	);

	// The operator list carries the image's intrinsic pixel size, not its rendered size.
	// Tracking the full CTM would mean interpreting save/restore/transform; for "is there
	// real artwork here", the transform immediately preceding the paint is a good proxy.
	let lastScaleX = 0;
	let lastScaleY = 0;

	for (const [i, fn] of fnArray.entries()) {
		if (fn === ops.transform) {
			const args = argsArray[i];
			if (Array.isArray(args) && args.length >= 4) {
				lastScaleX = Math.abs(Number(args[0]));
				lastScaleY = Math.abs(Number(args[3]));
			}
			continue;
		}

		if (
			imageOps.has(fn) &&
			lastScaleX >= MIN_MEANINGFUL_IMAGE_SIZE &&
			lastScaleY >= MIN_MEANINGFUL_IMAGE_SIZE
		) {
			return true;
		}
	}

	return false;
}

export async function extractPdfGeometry(
	data: ArrayBuffer,
	runtime?: PdfjsRuntime
): Promise<PdfGeometry> {
	const { mod: pdfjs, standardFontDataUrl } = runtime ?? (await loadBrowserRuntime());

	let doc: PdfDocument;
	try {
		doc = await pdfjs.getDocument({
			data: new Uint8Array(data),
			standardFontDataUrl,
			// Skipping system font lookup keeps extraction deterministic across machines.
			useSystemFonts: false,
			isEvalSupported: false,
			verbosity: 0
		}).promise;
	} catch (err) {
		const name = (err as { name?: string }).name;
		if (name === 'PasswordException') {
			throw new PdfExtractionError('ENCRYPTED', 'This PDF is password protected.');
		}
		throw new PdfExtractionError('CORRUPT', 'This PDF could not be read.');
	}

	try {
		const items: PositionedItem[] = [];
		let hasImages = false;
		let pageWidth = 0;
		let pageHeight = 0;

		for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
			const page = await doc.getPage(pageNum);

			if (pageNum === 1) {
				const viewport = page.getViewport({ scale: 1 });
				pageWidth = viewport.width;
				pageHeight = viewport.height;
			}

			const content = await page.getTextContent();

			for (const raw of content.items) {
				if (!isTextItem(raw)) continue;
				if (raw.str.trim() === '') continue;

				// transform is [a, b, c, d, e, f]; e and f are the translation, i.e. the text
				// origin in user space.
				items.push({
					str: raw.str,
					x: raw.transform[4] ?? 0,
					y: raw.transform[5] ?? 0,
					width: raw.width,
					height: raw.height,
					page: pageNum
				});
			}

			if (!hasImages && (await pageHasMeaningfulImage(page, pdfjs.OPS))) {
				hasImages = true;
			}
		}

		if (items.length === 0) {
			throw new PdfExtractionError(
				'NO_TEXT_LAYER',
				'This PDF has no selectable text — it is probably a scan. Export a text-based PDF instead.'
			);
		}

		return { items, pageCount: doc.numPages, pageWidth, pageHeight, hasImages };
	} finally {
		await doc.destroy();
	}
}
