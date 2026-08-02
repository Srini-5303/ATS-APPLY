import { tokenize } from './tokenizer';

/**
 * TF-IDF (PRD §6.2), used to weight which job-description terms actually matter.
 *
 * IDF uses Laplace smoothing so a term appearing in every document still yields a defined
 * (near-zero) weight rather than dividing by zero.
 */

export function termFrequency(text: string): Map<string, number> {
	const counts = new Map<string, number>();
	const tokens = tokenize(text);

	for (const token of tokens) {
		counts.set(token.normalized, (counts.get(token.normalized) ?? 0) + 1);
	}

	// Normalise by document length so a long JD does not dominate a short one.
	const total = tokens.length;
	if (total === 0) return counts;

	for (const [term, count] of counts) counts.set(term, count / total);
	return counts;
}

export function inverseDocumentFrequency(term: string, corpus: string[]): number {
	const documentFrequency = corpus.filter((doc) =>
		tokenize(doc).some((t) => t.normalized === term)
	).length;

	// +1 in the denominator is the Laplace smoothing.
	return Math.log(corpus.length / (1 + documentFrequency));
}

export function tfidf(term: string, document: string, corpus: string[]): number {
	return (termFrequency(document).get(term) ?? 0) * inverseDocumentFrequency(term, corpus);
}
