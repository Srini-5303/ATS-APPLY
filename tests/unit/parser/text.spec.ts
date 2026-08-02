import { describe, expect, it } from 'vitest';
import { bulletGlyphOf, isBulletLine, normalizeText, stripBullet } from '$engine/parser/text';

describe('normalizeText', () => {
	it.each([
		['ﬀ', 'ff'],
		['ﬁ', 'fi'],
		['ﬂ', 'fl'],
		['ﬃ', 'ffi'],
		['ﬄ', 'ffl'],
		['œ', 'oe']
	])('expands the ligature %s', (input, expected) => {
		// pdf.js emits these verbatim from embedded fonts, so "oﬃce" would never match
		// the keyword "office".
		expect(normalizeText(input)).toBe(expected);
	});

	it('folds curly punctuation to ASCII', () => {
		expect(normalizeText('Dean’s List')).toBe("Dean's List");
		expect(normalizeText('“quoted”')).toBe('"quoted"');
		expect(normalizeText('2021–2024')).toBe('2021-2024');
	});

	it.each([
		[' ', 'non-breaking space'],
		[' ', 'thin space'],
		['　', 'ideographic space']
	])('converts %s (%s) to a plain space', (char) => {
		// These defeat every split(/\s/) downstream if they survive.
		expect(normalizeText(`a${char}b`)).toBe('a b');
	});

	it.each([
		['​', 'zero-width space'],
		['‍', 'zero-width joiner'],
		['﻿', 'byte order mark']
	])('strips %s (%s) entirely', (char) => {
		expect(normalizeText(`Kuber${char}netes`)).toBe('Kubernetes');
	});

	it('collapses runs of spaces without destroying line structure', () => {
		expect(normalizeText('a    b\n\nc')).toBe('a b\n\nc');
	});

	it('normalises CRLF line endings', () => {
		expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
	});
});

describe('bullet handling', () => {
	it.each(['- item', '* item', '• item', '▪ item', '– item'])(
		'recognises %s as a bullet',
		(line) => {
			expect(isBulletLine(line)).toBe(true);
		}
	);

	it('does not treat a hyphenated word as a bullet', () => {
		expect(isBulletLine('re-engineered the pipeline')).toBe(false);
	});

	it('strips the glyph and surrounding space', () => {
		expect(stripBullet('•   Built a thing')).toBe('Built a thing');
	});

	it('reports which glyph was used, for the consistency check', () => {
		expect(bulletGlyphOf('• a')).toBe('•');
		expect(bulletGlyphOf('- a')).toBe('-');
		expect(bulletGlyphOf('plain text')).toBeNull();
	});
});
