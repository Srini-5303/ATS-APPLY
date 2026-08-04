/**
 * A deliberately small suffix stripper.
 *
 * Lever's parser is documented as using word stemming — "collaborating" reaching a search for
 * "collaborate" — and the LLM prompt says so, but the deterministic path had no stemmer at
 * all. `managed` and `managing` were unrelated tokens.
 *
 * This is not Porter. Porter's later steps rewrite word endings aggressively
 * (`ational` → `ate`, `iveness` → `ive`), which is right for document retrieval and wrong
 * here: a false keyword match tells a candidate they are covered when they are not, which is
 * worse than reporting the gap. Every rule below is one a reader can check by eye, and the
 * collision audit in `stemmer.spec.ts` runs the whole skills taxonomy through it to prove no
 * two distinct skills collapse together.
 *
 * **Where this may be used matters.** Stemming inside `buildResumeTermSet` would make every
 * matcher see identical input, and `exact` could no longer behave differently from `semantic`
 * — the bug that once gave all six platforms the same keyword score. The stem index is built
 * inside the fuzzy and semantic matchers only.
 */

/** Below this a word is left alone; short tokens are mostly acronyms (`aws`, `sql`, `ci`). */
const MIN_LENGTH = 4;

/** A stem shorter than this is too ambiguous to be useful. */
const MIN_STEM = 3;

/**
 * Endings that are part of the word rather than an inflection.
 *
 * Without this, `kubernetes` → `kubernete` is harmless but `business` → `busines` and
 * `analysis` → `analysi` are just noise, and `css` → `cs` is actively wrong.
 */
const PROTECTED_ENDINGS = ['ss', 'us', 'is', 'os'];

/** Ordered longest-first: `management` must lose `ment`, not `nt`. */
const SUFFIXES = ['ments', 'ment', 'ions', 'ion', 'ings', 'ing', 'ers', 'er', 'ed', 'es', 's'];

/** `running` → `runn` → `run`. Only for a doubled consonant that is not `ll`/`ss`/`ff`. */
function undouble(word: string): string {
	const last = word.at(-1);
	const prev = word.at(-2);
	if (last === undefined || last !== prev) return word;
	if (last === 'l' || last === 's' || last === 'f' || last === 'z') return word;
	return word.slice(0, -1);
}

function stripSuffix(word: string): string {
	for (const suffix of SUFFIXES) {
		if (!word.endsWith(suffix)) continue;

		const base = word.slice(0, -suffix.length);
		if (base.length < MIN_STEM) continue;

		// `ing`/`ed` can leave a doubled consonant; `s`/`es` never do.
		return suffix === 'ing' || suffix === 'ings' || suffix === 'ed' ? undouble(base) : base;
	}

	return word;
}

/**
 * Reduce one word to its stem.
 *
 * Tokens carrying internal punctuation are returned untouched: `node.js`, `ci/cd`, `c++`,
 * `.net` and `c#` are names, not inflected words, and stripping their endings produces
 * nonsense that could collide with real terms.
 */
export function stem(word: string): string {
	const lower = word.toLowerCase();

	if (lower.length < MIN_LENGTH) return lower;
	if (!/^[a-z]+$/.test(lower)) return lower;
	if (PROTECTED_ENDINGS.some((ending) => lower.endsWith(ending))) return lower;

	const stripped = stripSuffix(lower);

	// A trailing `e` is dropped so `manage`, `managed`, `managing` and `management` all reach
	// the same stem. Guarded by length so `code` does not become `cod` while `coding` does.
	const base =
		stripped.length > MIN_STEM + 1 && stripped.endsWith('e') ? stripped.slice(0, -1) : stripped;

	return base.length >= MIN_STEM ? base : lower;
}

/** Stem each word of a possibly multi-word term, preserving the spaces between them. */
export function stemTerm(term: string): string {
	return term.trim().toLowerCase().split(/\s+/).map(stem).join(' ');
}
