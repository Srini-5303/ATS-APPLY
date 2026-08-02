import { describe, expect, it } from 'vitest';
import { STOP_WORDS, isStopWord } from '$engine/nlp/stopwords';
import { tokenize, uniqueTerms } from '$engine/nlp/tokenizer';
import { inverseDocumentFrequency, termFrequency, tfidf } from '$engine/nlp/tfidf';
import {
	ALL_GROUPS,
	canonicalize,
	normalizeTerms,
	validateSynonyms,
	variantsOf
} from '$engine/nlp/synonyms';
import {
	detectIndustry,
	getIndustrySkills,
	getSkillDomain,
	industryCoverage
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

describe('tf-idf', () => {
	it('normalises term frequency by document length', () => {
		const tf = termFrequency('kubernetes kubernetes docker');
		expect(tf.get('kubernetes')).toBeCloseTo(2 / 3, 5);
		expect(tf.get('docker')).toBeCloseTo(1 / 3, 5);
	});

	it('gives a rare term a higher idf than a common one', () => {
		const corpus = ['kubernetes docker', 'docker aws', 'docker azure'];
		expect(inverseDocumentFrequency('kubernetes', corpus)).toBeGreaterThan(
			inverseDocumentFrequency('docker', corpus)
		);
	});

	it('stays finite when a term appears in every document', () => {
		// The Laplace smoothing exists for exactly this case.
		const corpus = ['docker', 'docker', 'docker'];
		expect(Number.isFinite(inverseDocumentFrequency('docker', corpus))).toBe(true);
	});

	it('is zero for a term absent from the document', () => {
		expect(tfidf('rust', 'go and python', ['go', 'rust'])).toBe(0);
	});

	it('handles an empty document', () => {
		expect(termFrequency('').size).toBe(0);
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

	describe('industryCoverage', () => {
		it('scores a broad technical resume highly', () => {
			const text =
				'Go Python TypeScript PostgreSQL Redis Kubernetes Docker AWS Terraform Kafka gRPC GraphQL React CI/CD distributed systems observability microservices';
			const coverage = industryCoverage(text);

			expect(coverage?.industry).toBe('technology');
			expect(coverage?.score).toBeGreaterThan(40);
		});

		it('scores a thin resume lower than a broad one', () => {
			const thin = industryCoverage('Go Python Docker Kubernetes');
			const broad = industryCoverage(
				'Go Python Docker Kubernetes AWS Terraform Kafka PostgreSQL Redis React GraphQL CI/CD'
			);

			expect(broad!.score).toBeGreaterThan(thin!.score);
		});

		it('returns null when no industry clears the confidence bar', () => {
			// One stray term must not classify a resume — the caller redistributes the weight
			// instead of inventing a score (ADR 0001 §1).
			expect(industryCoverage('I once used SQL at university')).toBeNull();
		});

		it('lists what is missing so the advice can be specific', () => {
			const coverage = industryCoverage('Go Python Docker Kubernetes AWS');
			expect(coverage?.missing.length).toBeGreaterThan(0);
			expect(coverage?.matched).toContain('kubernetes');
		});
	});
});
