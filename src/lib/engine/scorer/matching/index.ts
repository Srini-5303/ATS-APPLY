import { variantsOf } from '../../nlp/synonyms';
import type { KeywordStrategy } from '../../types/scoring';

/**
 * Keyword matching strategies (PRD §7.5).
 *
 * The three strategies compose rather than duplicate: fuzzy is exact plus synonyms, semantic
 * is fuzzy plus partial overlap. Adding a platform means picking one of these, never writing
 * a fourth.
 */

export interface MatchOutcome {
	matched: string[];
	/** Matched only after synonym expansion — surfaced so the UI can explain the difference. */
	synonymMatched: string[];
	missing: string[];
}

export type Matcher = (
	jdTerms: string[],
	resumeTerms: ReadonlySet<string>,
	resumeText: string
) => MatchOutcome;

function exactHit(term: string, resumeTerms: ReadonlySet<string>, resumeText: string): boolean {
	if (resumeTerms.has(term)) return true;
	// Multi-word terms never appear as a single token.
	return term.includes(' ') && resumeText.includes(term);
}

function synonymHit(term: string, resumeTerms: ReadonlySet<string>, resumeText: string): boolean {
	return variantsOf(term).some((variant) => exactHit(variant, resumeTerms, resumeText));
}

/**
 * Suffixes that make a longer token the same concept as its prefix.
 *
 * A bare prefix rule is not enough: `"javascript".startsWith("java")` is true, and treating
 * Java experience as JavaScript experience is a materially wrong match to show a candidate.
 * A separator-led remainder ("kubernetes-native") or an ordinary inflection ("testing") is a
 * variant; anything else is a different word that happens to share a stem.
 */
const INFLECTIONS = ['s', 'es', 'ed', 'ing', 'ion', 'ions', 'ment', 'ments', 'er', 'ers'];

function isVariantSuffix(remainder: string): boolean {
	if (remainder === '') return true;
	if (/^[-./_\s]/.test(remainder)) return true;
	return INFLECTIONS.includes(remainder);
}

/**
 * Partial overlap, used only by the most lenient platforms (semantic strategy).
 *
 * Conservative by design — a false keyword match tells a candidate they are covered when they
 * are not, which is worse than reporting the gap.
 */
function partialHit(term: string, resumeTerms: ReadonlySet<string>): boolean {
	if (term.length < 4) return false;

	for (const candidate of resumeTerms) {
		if (candidate.length < 4) continue;
		if (candidate === term) return true;

		if (candidate.startsWith(term) && isVariantSuffix(candidate.slice(term.length))) return true;
		if (term.startsWith(candidate) && isVariantSuffix(term.slice(candidate.length))) return true;
	}

	return false;
}

function build(
	test: (term: string, resumeTerms: ReadonlySet<string>, resumeText: string) => boolean,
	synonymTest?: (term: string, resumeTerms: ReadonlySet<string>, resumeText: string) => boolean
): Matcher {
	return (jdTerms, resumeTerms, resumeText) => {
		const matched: string[] = [];
		const synonymMatched: string[] = [];
		const missing: string[] = [];

		for (const term of jdTerms) {
			if (exactHit(term, resumeTerms, resumeText)) {
				matched.push(term);
				continue;
			}

			if (test(term, resumeTerms, resumeText)) {
				matched.push(term);
				// Attribute the looser hit so the UI can say *how* it matched.
				if (synonymTest?.(term, resumeTerms, resumeText) !== false) synonymMatched.push(term);
				continue;
			}

			missing.push(term);
		}

		return { matched, synonymMatched, missing };
	};
}

const exact: Matcher = build(() => false);

const fuzzy: Matcher = build((term, resumeTerms, resumeText) =>
	synonymHit(term, resumeTerms, resumeText)
);

const semantic: Matcher = build(
	(term, resumeTerms, resumeText) =>
		synonymHit(term, resumeTerms, resumeText) || partialHit(term, resumeTerms),
	(term, resumeTerms, resumeText) => synonymHit(term, resumeTerms, resumeText)
);

export const MATCHERS: Readonly<Record<KeywordStrategy, Matcher>> = { exact, fuzzy, semantic };

/**
 * The resume's vocabulary in its **own surface forms**, lowercased but not canonicalised.
 *
 * Folding "k8s" to "kubernetes" here would defeat the whole point of having three strategies:
 * every matcher would then see identical input and `exact` could never behave differently
 * from `semantic`. That is exactly what happened — all six platforms returned the same
 * keyword score on every resume, because the distinction had been erased one layer earlier.
 *
 * The synonym fold still happens, but inside `fuzzy` and `semantic`, where it belongs.
 */
export function buildResumeTermSet(terms: string[], skills: string[]): Set<string> {
	const set = new Set<string>();

	for (const term of [...terms, ...skills]) {
		const normalized = term.trim().toLowerCase();
		if (normalized !== '') set.add(normalized);
	}

	return set;
}
