/**
 * A minimal DOCX writer for test fixtures.
 *
 * A .docx is a ZIP of XML parts. Written by hand for the same reason as the PDF builder:
 * fixtures must be byte-stable and not hostage to a library's version. Uses stored (no
 * compression) entries so the ZIP can be assembled without a deflate implementation.
 */

import { deflateRawSync } from 'node:zlib';

interface Entry {
	name: string;
	data: Buffer;
}

/** CRC-32, needed for the ZIP entry headers. */
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function zip(entries: Entry[]): Buffer {
	const chunks: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = Buffer.from(entry.name, 'utf8');
		const compressed = deflateRawSync(entry.data);
		const crc = crc32(entry.data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0); // local file header
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0, 6); // flags
		local.writeUInt16LE(8, 8); // deflate
		local.writeUInt16LE(0, 10); // mod time
		local.writeUInt16LE(0x2821, 12); // mod date (fixed, for byte stability)
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);

		chunks.push(local, name, compressed);

		const dir = Buffer.alloc(46);
		dir.writeUInt32LE(0x02014b50, 0); // central directory header
		dir.writeUInt16LE(20, 4);
		dir.writeUInt16LE(20, 6);
		dir.writeUInt16LE(0, 8);
		dir.writeUInt16LE(8, 10);
		dir.writeUInt16LE(0, 12);
		dir.writeUInt16LE(0x2821, 14);
		dir.writeUInt32LE(crc, 16);
		dir.writeUInt32LE(compressed.length, 20);
		dir.writeUInt32LE(entry.data.length, 24);
		dir.writeUInt16LE(name.length, 28);
		dir.writeUInt32LE(0, 38); // external attrs
		dir.writeUInt32LE(offset, 42);

		central.push(dir, name);
		offset += local.length + name.length + compressed.length;
	}

	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);

	return Buffer.concat([...chunks, centralBuf, end]);
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export interface DocxSpec {
	/** Paragraphs; an empty string produces a blank line. */
	paragraphs: string[];
	/** Rows of cells, appended as a real table. */
	table?: string[][];
	includeImage?: boolean;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

/** A 1x1 transparent PNG. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

function paragraph(text: string): string {
	if (text === '') return '<w:p/>';
	return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function table(rows: string[][]): string {
	const body = rows
		.map(
			(row) =>
				`<w:tr>${row.map((cell) => `<w:tc><w:tcPr/>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`
		)
		.join('');
	return `<w:tbl><w:tblPr/><w:tblGrid/>${body}</w:tbl>`;
}

const IMAGE_PARAGRAPH = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="Picture 1"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

export function buildDocx(spec: DocxSpec): Buffer {
	const parts = spec.paragraphs.map(paragraph);
	if (spec.includeImage) parts.unshift(IMAGE_PARAGRAPH);
	if (spec.table) parts.push(table(spec.table));

	const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${parts.join('')}<w:sectPr/></w:body>
</w:document>`;

	const entries: Entry[] = [
		{ name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
		{ name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
		{ name: 'word/document.xml', data: Buffer.from(document, 'utf8') }
	];

	if (spec.includeImage) {
		entries.push(
			{ name: 'word/_rels/document.xml.rels', data: Buffer.from(DOC_RELS, 'utf8') },
			{ name: 'word/media/image1.png', data: PNG }
		);
	}

	return zip(entries);
}
