import { isStopWord } from './stopwords';

/**
 * Tokenizer (PRD §6.1).
 *
 * Resume vocabulary is full of tokens that a naive word-splitter destroys: `C++`, `C#`,
 * `.NET`, `Node.js`, `CI/CD`, `co-founder`, `Ph.D.`. Internal punctuation is therefore
 * preserved and only leading/trailing punctuation is stripped.
 */

export interface Token {
	raw: string;
	normalized: string;
	position: number;
}

/**
 * Trailing characters that are part of the token rather than punctuation.
 *
 * `+` and `#` matter for C++/C#, so they survive at the end of a token even though they
 * would normally be stripped.
 */
const KEEPS_TRAILING = /[+#]$/;

function stripEdges(raw: string): string {
	let out = raw;

	// Leading punctuation is never meaningful.
	out = out.replace(/^[^\p{L}\p{N}.+#]+/u, '');

	// Trailing punctuation is stripped unless it is part of the token (C++, C#).
	while (out.length > 0 && !KEEPS_TRAILING.test(out) && /[^\p{L}\p{N}]$/u.test(out)) {
		out = out.slice(0, -1);
	}

	return out;
}

export function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	let position = 0;

	// Split on whitespace and the separators that never occur inside a term. Slashes are
	// deliberately absent so CI/CD and TCP/IP stay whole.
	for (const raw of text.split(/[\s,;|•·()[\]{}<>"]+/)) {
		if (raw === '') continue;

		const cleaned = stripEdges(raw);
		if (cleaned.length < 2) continue;

		const normalized = cleaned.toLowerCase();
		if (isStopWord(normalized)) continue;
		// A token with no letters is a bare number or punctuation noise.
		if (!/\p{L}/u.test(normalized)) continue;

		tokens.push({ raw: cleaned, normalized, position });
		position += 1;
	}

	return tokens;
}

/** Normalized forms only, deduplicated, order preserved. */
export function uniqueTerms(text: string): string[] {
	const seen = new Set<string>();
	for (const token of tokenize(text)) seen.add(token.normalized);
	return [...seen];
}
