import { describe, expect, it } from 'vitest';
import { STOP_WORDS, isStopWord } from '$engine/nlp/stopwords';
import { tokenize, uniqueTerms } from '$engine/nlp/tokenizer';
import {
	ALL_GROUPS,
	canonicalize,
	normalizeTerms,
	validateSynonyms,
	variantsOf
} from '$engine/nlp/synonyms';
import {
	coverageScore,
	detectIndustry,
	FULL_COVERAGE_RATIO,
	getIndustrySkills,
	getSkillDomain,
	industryVocabulary
} from '$engine/nlp/taxonomy';

describe('tokenizer', () => {
	it.each([
		['C++', 'c++'],
		['C#', 'c#'],
		['Node.js', 'node.js'],
		['CI/CD', 'ci/cd'],
		['co-founder', 'co-founder'],
		['scikit-learn', 'scikit-learn']
	])('keeps %s intact', (input, expected) => {
		// A naive word-splitter destroys every one of these, and they are exactly the terms a
		// technical resume is matched on.
		expect(tokenize(input)[0]?.normalized).toBe(expected);
	});

	it('strips surrounding punctuation but not internal', () => {
		expect(tokenize('(Node.js),')[0]?.normalized).toBe('node.js');
	});

	it('drops stop words', () => {
		expect(uniqueTerms('the quick and the dead')).toEqual(['quick', 'dead']);
	});

	it('keeps short tokens that are real technologies', () => {
		// "go", "r" and "c" are stop-word-shaped but are programming languages.
		expect(isStopWord('go')).toBe(false);
		expect(isStopWord('r')).toBe(false);
		expect(isStopWord('it')).toBe(false);
	});

	it('drops bare numbers', () => {
		expect(uniqueTerms('reduced by 42 percent')).not.toContain('42');
	});

	it('assigns increasing positions', () => {
		const tokens = tokenize('alpha beta gamma');
		expect(tokens.map((t) => t.position)).toEqual([0, 1, 2]);
	});

	it('returns nothing for empty input', () => {
		expect(tokenize('')).toEqual([]);
		expect(tokenize('   \n  ')).toEqual([]);
	});

	it('has a stop list of a sane size', () => {
		expect(STOP_WORDS.size).toBeGreaterThan(100);
		for (const word of STOP_WORDS) expect(word).toBe(word.toLowerCase());
	});
});

describe('synonyms', () => {
	it('has no structural defects', () => {
		// The critical one is a variant appearing in two groups, which makes canonicalisation
		// order-dependent and silently corrupts every match that touches it.
		expect(validateSynonyms()).toEqual([]);
	});

	it.each([
		['js', 'javascript'],
		['k8s', 'kubernetes'],
		['postgres', 'postgresql'],
		['ml', 'machine learning'],
		['amazon web services', 'aws'],
		['nodejs', 'node.js']
	])('folds %s to %s', (variant, canonical) => {
		expect(canonicalize(variant)).toBe(canonical);
	});

	it('is idempotent', () => {
		for (const group of ALL_GROUPS) {
			for (const variant of group) {
				const once = canonicalize(variant);
				expect(canonicalize(once)).toBe(once);
			}
		}
	});

	it('returns unknown terms unchanged but lowercased', () => {
		expect(canonicalize('Blorptech')).toBe('blorptech');
	});

	it('lists every variant of a term', () => {
		expect(variantsOf('k8s')).toContain('kubernetes');
		expect(variantsOf('kubernetes')).toContain('k8s');
	});

	it('deduplicates through canonical forms', () => {
		expect(normalizeTerms(['JS', 'javascript', 'ECMAScript'])).toEqual(['javascript']);
	});

	it('carries a substantial vocabulary', () => {
		expect(ALL_GROUPS.length).toBeGreaterThan(200);
	});
});

describe('taxonomy', () => {
	it('identifies the industry of a technical resume', () => {
		const text = 'Go Python Kubernetes Docker PostgreSQL AWS Terraform Kafka microservices';
		expect(detectIndustry(text)[0]?.industry).toBe('technology');
	});

	it('identifies a marketing resume', () => {
		const text = 'SEO SEM PPC HubSpot Salesforce Google Analytics conversion rate optimization';
		expect(detectIndustry(text)[0]?.industry).toBe('marketing');
	});

	it('identifies a healthcare resume', () => {
		const text = 'registered nurse EHR Epic HIPAA ICD-10 BLS ACLS patient care';
		expect(detectIndustry(text)[0]?.industry).toBe('healthcare');
	});

	it('finds nothing in text with no domain vocabulary', () => {
		expect(detectIndustry('the quick brown fox jumped over the lazy dog')).toEqual([]);
	});

	it('maps a term back to its domain', () => {
		expect(getSkillDomain('kubernetes')).toBe('technology');
		expect(getSkillDomain('hubspot')).toBe('marketing');
		expect(getSkillDomain('nonsenseword')).toBeNull();
	});

	it('matches multi-word terms that tokenisation would split', () => {
		expect(getIndustrySkills('technology')).toContain('machine learning');
		expect(detectIndustry('experienced in machine learning and deep learning')[0]?.industry).toBe(
			'technology'
		);
	});

	describe('industryVocabulary', () => {
		it('returns the industry and its full term list', () => {
			// Deliberately returns the vocabulary rather than a score: which terms count as
			// present depends on the platform's matching strategy, so that decision belongs to
			// the scorer.
			const vocabulary = industryVocabulary(
				'Go Python TypeScript PostgreSQL Redis Kubernetes Docker AWS Terraform Kafka'
			);

			expect(vocabulary?.industry).toBe('technology');
			expect(vocabulary?.skills.length).toBeGreaterThan(50);
			expect(vocabulary?.skills).toContain('kubernetes');
		});

		it('returns null when no industry clears the confidence bar', () => {
			// One stray term must not classify a resume — the caller redistributes the weight
			// instead of inventing a score (ADR 0001 §1).
			expect(industryVocabulary('I once used SQL at university')).toBeNull();
		});
	});

	describe('coverageScore', () => {
		it('is zero for no matches', () => {
			expect(coverageScore(0, 100)).toBe(0);
		});

		it('reaches 100 at the full-coverage ratio', () => {
			expect(coverageScore(FULL_COVERAGE_RATIO * 100, 100)).toBe(100);
		});

		it('rises with the number of matched terms', () => {
			expect(coverageScore(30, 120)).toBeGreaterThan(coverageScore(20, 120));
		});

		it('caps rather than exceeding 100', () => {
			expect(coverageScore(120, 120)).toBe(100);
		});

		it('handles an empty vocabulary without dividing by zero', () => {
			expect(coverageScore(0, 0)).toBe(0);
		});
	});
});
