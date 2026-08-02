/**
 * Text normalisation applied before any structural parsing.
 *
 * PDF extraction routinely yields typographic ligatures and exotic whitespace. Left alone,
 * "oﬃce" never matches the keyword "office" and a non-breaking space defeats every
 * `split(/\s/)` downstream — so this runs first and everything after it can assume plain
 * characters.
 */

/** Ligatures pdf.js emits verbatim from embedded fonts. */
const LIGATURES: readonly (readonly [RegExp, string])[] = [
	[/ﬀ/g, 'ff'],
	[/ﬁ/g, 'fi'],
	[/ﬂ/g, 'fl'],
	[/ﬃ/g, 'ffi'],
	[/ﬄ/g, 'ffl'],
	[/ﬅ/g, 'st'],
	[/ﬆ/g, 'st'],
	[/Ĳ/g, 'IJ'],
	[/ĳ/g, 'ij'],
	[/Œ/g, 'OE'],
	[/œ/g, 'oe']
];

/**
 * Curly punctuation folded to ASCII. Matters for matching: a resume written in Word has
 * "Dean's List" with U+2019, and a naive comparison against "Dean's List" fails.
 */
const PUNCTUATION: readonly (readonly [RegExp, string])[] = [
	[/[‘’‚‛]/g, "'"],
	[/[“”„‟]/g, '"'],
	[/[–—―]/g, '-'],
	[/…/g, '...'],
	// Non-breaking space, en/em/thin spaces, ideographic space.
	[/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' '],
	// Zero-width characters are invisible but silently break substring matching.
	[/[\u200b-\u200d\ufeff]/g, '']
];

/** Bullet glyphs, normalised so bullet detection has one shape to look for. */
export const BULLET_GLYPHS = /^[\s]*[•▪▫◦‣⁃∙·*\-–—+>]\s+/;

export function normalizeText(input: string): string {
	let out = input;

	for (const [pattern, replacement] of LIGATURES) out = out.replace(pattern, replacement);
	for (const [pattern, replacement] of PUNCTUATION) out = out.replace(pattern, replacement);

	// Normalise line endings, then collapse runs of spaces/tabs without touching newlines.
	out = out.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ');

	return out;
}

/** True when the line begins with a bullet glyph. */
export function isBulletLine(line: string): boolean {
	return BULLET_GLYPHS.test(line);
}

/** Strips a leading bullet glyph, leaving the content. */
export function stripBullet(line: string): string {
	return line.replace(BULLET_GLYPHS, '').trim();
}

/** Which bullet glyph a line uses, for the inconsistent-bullet-style check in PRD §7.4. */
export function bulletGlyphOf(line: string): string | null {
	const match = /^[\s]*([•▪▫◦‣⁃∙·*\-–—+>])\s+/.exec(line);
	return match?.[1] ?? null;
}
