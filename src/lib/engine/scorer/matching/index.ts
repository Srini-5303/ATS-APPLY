import { stem, stemTerm } from '../../nlp/stemmer';
import { variantsOf } from '../../nlp/synonyms';
import type { KeywordStrategy } from '../../types/scoring';

/**
 * Keyword matching strategies (PRD §7.5).
 *
 * The three compose rather than duplicate, and each maps onto what its platforms actually do:
 *
 * - `exact`    — literal token match. Taleo, Workday and SuccessFactors index the string.
 * - `fuzzy`    — plus curated synonyms. iCIMS normalises skills onto a controlled taxonomy.
 * - `semantic` — plus stemming and partial overlap. Lever's documented feature is word
 *                stemming; Greenhouse's parser is the most forgiving of the six.
 *
 * Adding a platform means picking one of these, never writing a fourth.
 */

export interface MatchOutcome {
	matched: string[];
	/**
	 * Matched by something looser than a literal hit — a synonym, a shared stem or a partial
	 * overlap. Surfaced so the UI can explain the difference, and credited at a discount.
	 */
	synonymMatched: string[];
	missing: string[];
}

export type Matcher = (
	jdTerms: string[],
	resumeTerms: ReadonlySet<string>,
	resumeText: string
) => MatchOutcome;

/**
 * Everything a matcher needs about the resume side.
 *
 * `stems` is a thunk so the index is built once per call and only by the strategies that use
 * it — `exact` and `fuzzy` never pay for it.
 */
interface MatchContext {
	resumeTerms: ReadonlySet<string>;
	resumeText: string;
	stems: () => ReadonlySet<string>;
	stemmedText: () => string;
}

function exactHit(term: string, ctx: MatchContext): boolean {
	if (ctx.resumeTerms.has(term)) return true;
	// Multi-word terms never appear as a single token.
	return term.includes(' ') && ctx.resumeText.includes(term);
}

function synonymHit(term: string, ctx: MatchContext): boolean {
	return variantsOf(term).some((variant) => exactHit(variant, ctx));
}

/**
 * Morphological match: `collaborating` on the resume answering `collaborate` in the posting.
 *
 * The stem index is built from the resume's own surface forms at call time rather than folded
 * into `buildResumeTermSet` — see the note there for why that distinction is load-bearing.
 */
function stemHit(term: string, ctx: MatchContext): boolean {
	// Phrases are where this earns its keep. Single-word plurals are mostly enumerated in the
	// synonym groups already, but nobody lists every inflection of every phrase — "distributed
	// system" against "distributed systems", "systems design" against "system design".
	if (term.includes(' ')) return ctx.stemmedText().includes(stemTerm(term));
	return ctx.stems().has(stemTerm(term));
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
function partialHit(term: string, ctx: MatchContext): boolean {
	if (term.length < 4) return false;

	for (const candidate of ctx.resumeTerms) {
		if (candidate.length < 4) continue;
		if (candidate === term) return true;

		if (candidate.startsWith(term) && isVariantSuffix(candidate.slice(term.length))) return true;
		if (term.startsWith(candidate) && isVariantSuffix(term.slice(candidate.length))) return true;
	}

	return false;
}

/**
 * Builds a matcher from one loose test.
 *
 * Every hit that is not literal is recorded in `synonymMatched` and therefore credited at a
 * discount. That used to be true of synonym hits only: a partial overlap fell through the
 * attribution check and scored as though it were exact, so the *weakest* mechanism paid no
 * penalty while the strongest curated one did.
 */
function build(test: (term: string, ctx: MatchContext) => boolean): Matcher {
	return (jdTerms, resumeTerms, resumeText) => {
		let stemIndex: ReadonlySet<string> | null = null;
		let stemmedResume: string | null = null;

		const ctx: MatchContext = {
			resumeTerms,
			resumeText,
			stems: () => {
				stemIndex ??= new Set([...resumeTerms].map((t) => stemTerm(t)));
				return stemIndex;
			},
			stemmedText: () => {
				stemmedResume ??= resumeText.split(/\s+/).map(stem).join(' ');
				return stemmedResume;
			}
		};

		const matched: string[] = [];
		const synonymMatched: string[] = [];
		const missing: string[] = [];

		for (const term of jdTerms) {
			if (exactHit(term, ctx)) {
				matched.push(term);
				continue;
			}

			if (test(term, ctx)) {
				matched.push(term);
				synonymMatched.push(term);
				continue;
			}

			missing.push(term);
		}

		return { matched, synonymMatched, missing };
	};
}

const exact: Matcher = build(() => false);

const fuzzy: Matcher = build((term, ctx) => synonymHit(term, ctx));

// Stemming lives here rather than in `fuzzy` because it is Lever's documented mechanism, and
// keeping it out of `fuzzy` leaves iCIMS a genuinely distinct middle tier: curated synonyms
// but no morphology.
const semantic: Matcher = build(
	(term, ctx) => synonymHit(term, ctx) || stemHit(term, ctx) || partialHit(term, ctx)
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
