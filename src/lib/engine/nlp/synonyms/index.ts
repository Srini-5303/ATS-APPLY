import {
	DESIGN,
	EDUCATION_DOMAIN,
	FINANCE,
	HEALTHCARE,
	HR,
	LEGAL,
	MARKETING,
	OPERATIONS,
	PRODUCT,
	SALES
} from './other-domains';
import { TECHNOLOGY } from './technology';

/**
 * Synonym lookup (PRD §6.3).
 *
 * The reverse index is built once at module load and frozen, so canonicalisation is a single
 * Map hit rather than a scan across 250+ groups on every term.
 */

export const DOMAINS = {
	technology: TECHNOLOGY,
	finance: FINANCE,
	healthcare: HEALTHCARE,
	marketing: MARKETING,
	sales: SALES,
	hr: HR,
	product: PRODUCT,
	legal: LEGAL,
	operations: OPERATIONS,
	education: EDUCATION_DOMAIN,
	design: DESIGN
} as const;

export type Domain = keyof typeof DOMAINS;

export const ALL_GROUPS: readonly (readonly string[])[] = Object.values(DOMAINS).flat();

/** variant -> canonical form. */
const REVERSE_INDEX: ReadonlyMap<string, string> = (() => {
	const index = new Map<string, string>();

	for (const group of ALL_GROUPS) {
		const canonical = group[0];
		if (canonical === undefined) continue;
		for (const variant of group) index.set(variant.toLowerCase(), canonical);
	}

	return index;
})();

/** variant -> the domain it belongs to. */
const DOMAIN_INDEX: ReadonlyMap<string, Domain> = (() => {
	const index = new Map<string, Domain>();

	for (const [domain, groups] of Object.entries(DOMAINS)) {
		for (const group of groups) {
			for (const variant of group) index.set(variant.toLowerCase(), domain as Domain);
		}
	}

	return index;
})();

/**
 * Folds a term to its canonical form. Unknown terms are returned lowercased unchanged, so
 * this is always safe to apply.
 */
export function canonicalize(term: string): string {
	const key = term.trim().toLowerCase();
	return REVERSE_INDEX.get(key) ?? key;
}

export function domainOf(term: string): Domain | null {
	return DOMAIN_INDEX.get(term.trim().toLowerCase()) ?? null;
}

/** Every known variant of a term, including the term itself. */
export function variantsOf(term: string): string[] {
	const canonical = canonicalize(term);
	const group = ALL_GROUPS.find((g) => g[0] === canonical);
	return group ? [...group] : [canonical];
}

/** Canonicalised and deduplicated, order preserved. */
export function normalizeTerms(terms: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];

	for (const term of terms) {
		const canonical = canonicalize(term);
		if (canonical === '' || seen.has(canonical)) continue;
		seen.add(canonical);
		out.push(canonical);
	}

	return out;
}

/** Structural problems in the data files, surfaced by a test. */
export function validateSynonyms(): string[] {
	const errors: string[] = [];
	const owner = new Map<string, string>();

	for (const group of ALL_GROUPS) {
		const canonical = group[0];
		if (canonical === undefined) {
			errors.push('empty synonym group');
			continue;
		}

		for (const variant of group) {
			const key = variant.toLowerCase();
			const existing = owner.get(key);

			// A variant in two groups makes canonicalisation order-dependent and silently
			// corrupts every match that touches it.
			if (existing !== undefined && existing !== canonical) {
				errors.push(`"${variant}" appears in both "${existing}" and "${canonical}"`);
			}
			owner.set(key, canonical);

			if (variant !== variant.toLowerCase()) errors.push(`"${variant}" is not lowercase`);
		}
	}

	return errors;
}
