/**
 * A minimal PDF writer, used only to generate test fixtures.
 *
 * Hand-rolled rather than pulling in jsPDF/pdfkit because fixtures must be byte-stable:
 * generating them with a library makes the committed corpus hostage to that library's
 * version and to whatever fonts happen to exist on the machine. These are produced once,
 * reviewed, and committed (see tests/fixtures/README.md).
 *
 * Coordinates are PDF user-space units (1/72 inch), origin bottom-left. US Letter is
 * 612 x 792.
 */

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

export interface TextItem {
	x: number;
	/** Distance from the bottom of the page. */
	y: number;
	text: string;
	size?: number;
	/** 'F1' Helvetica (default), 'F2' Helvetica-Bold. */
	font?: 'F1' | 'F2';
}

export interface PageSpec {
	items: TextItem[];
	/** Draws an embedded image XObject of the given size, for hasImages fixtures. */
	image?: { x: number; y: number; width: number; height: number };
}

function escapePdfText(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildContentStream(page: PageSpec): string {
	const parts: string[] = [];

	for (const item of page.items) {
		const size = item.size ?? 11;
		const font = item.font ?? 'F1';
		parts.push(
			`BT /${font} ${String(size)} Tf ${String(item.x)} ${String(item.y)} Td (${escapePdfText(item.text)}) Tj ET`
		);
	}

	if (page.image) {
		const { x, y, width, height } = page.image;
		// cm sets the transform; the image XObject is drawn into a 1x1 unit square, so the
		// matrix carries its rendered size — which is what the >50px glyph filter reads.
		parts.push(`q ${String(width)} 0 0 ${String(height)} ${String(x)} ${String(y)} cm /Im1 Do Q`);
	}

	return parts.join('\n');
}

/** A 1x1 pixel grayscale image, enough to register as an image XObject. */
const IMAGE_DATA = Buffer.from([0xff]);

export function buildPdf(pages: PageSpec[]): Buffer {
	const needsImage = pages.some((p) => p.image);
	const chunks: Buffer[] = [];
	const offsets: number[] = [];
	let position = 0;

	const push = (s: string | Buffer): void => {
		const buf = typeof s === 'string' ? Buffer.from(s, 'latin1') : s;
		chunks.push(buf);
		position += buf.length;
	};

	const startObject = (): void => {
		offsets.push(position);
	};

	push('%PDF-1.4\n');

	// Object numbering: 1 catalog, 2 pages, then per page a page object and a content
	// stream, then the two fonts, then the optional image.
	const pageObjNum = (i: number): number => 3 + i * 2;
	const contentObjNum = (i: number): number => 4 + i * 2;
	const fontRegularNum = 3 + pages.length * 2;
	const fontBoldNum = fontRegularNum + 1;
	const imageNum = fontBoldNum + 1;

	startObject();
	push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

	const kids = pages.map((_, i) => `${String(pageObjNum(i))} 0 R`).join(' ');
	startObject();
	push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>\nendobj\n`);

	for (const [i, page] of pages.entries()) {
		const xobject = needsImage ? ` /XObject << /Im1 ${String(imageNum)} 0 R >>` : '';

		startObject();
		push(
			`${String(pageObjNum(i))} 0 obj\n` +
				`<< /Type /Page /Parent 2 0 R ` +
				`/MediaBox [0 0 ${String(PAGE_WIDTH)} ${String(PAGE_HEIGHT)}] ` +
				`/Contents ${String(contentObjNum(i))} 0 R ` +
				`/Resources << /Font << /F1 ${String(fontRegularNum)} 0 R /F2 ${String(fontBoldNum)} 0 R >>${xobject} >> ` +
				`>>\nendobj\n`
		);

		const content = buildContentStream(page);
		startObject();
		push(
			`${String(contentObjNum(i))} 0 obj\n<< /Length ${String(Buffer.byteLength(content, 'latin1'))} >>\nstream\n${content}\nendstream\nendobj\n`
		);
	}

	startObject();
	push(
		`${String(fontRegularNum)} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`
	);

	startObject();
	push(
		`${String(fontBoldNum)} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`
	);

	if (needsImage) {
		startObject();
		push(
			`${String(imageNum)} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 ` +
				`/ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${String(IMAGE_DATA.length)} >>\nstream\n`
		);
		push(IMAGE_DATA);
		push('\nendstream\nendobj\n');
	}

	const xrefStart = position;
	const objectCount = offsets.length + 1;

	let xref = `xref\n0 ${String(objectCount)}\n0000000000 65535 f \n`;
	for (const offset of offsets) {
		xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
	}
	push(xref);
	push(
		`trailer\n<< /Size ${String(objectCount)} /Root 1 0 R >>\nstartxref\n${String(xrefStart)}\n%%EOF\n`
	);

	return Buffer.concat(chunks);
}
