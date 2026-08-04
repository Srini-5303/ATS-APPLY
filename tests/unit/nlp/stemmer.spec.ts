import { describe, expect, it } from 'vitest';
import { stem, stemTerm } from '$engine/nlp/stemmer';
import { DOMAINS, type Domain } from '$engine/nlp/synonyms';
import { getIndustrySkills } from '$engine/nlp/taxonomy';

describe('stem', () => {
	it.each([
		['manage', 'managing'],
		['manage', 'managed'],
		['manage', 'management'],
		['collaborate', 'collaborating'],
		['develop', 'developer'],
		['develop', 'developers'],
		['test', 'testing'],
		['deploy', 'deployment'],
		['orchestrate', 'orchestration'],
		['run', 'running'],
		['optimise', 'optimising']
	])('folds %s and %s together', (a, b) => {
		expect(stem(a)).toBe(stem(b));
	});

	it.each([
		['java', 'javascript'],
		['go', 'golang'],
		['react', 'redis'],
		['css', 'cs'],
		['sass', 'sas'],
		['analysis', 'analyst'],
		['scala', 'scale']
	])('keeps %s and %s apart', (a, b) => {
		// A false keyword match tells a candidate they are covered when they are not, which is
		// worse than reporting the gap. These are the pairs a greedier stemmer would merge.
		expect(stem(a)).not.toBe(stem(b));
	});

	it.each(['node.js', 'ci/cd', 'c++', 'c#', '.net', 'tcp/ip', 'a/b'])(
		'leaves the technical token %s untouched',
		(token) => {
			expect(stem(token)).toBe(token);
		}
	);

	it.each(['aws', 'sql', 'ci', 'go', 'r'])('leaves the short token %s untouched', (token) => {
		expect(stem(token)).toBe(token);
	});

	it('never strips a real word down to nothing', () => {
		// The MIN_STEM floor exists so a word that is almost entirely suffix survives.
		for (const word of ['s', 'es', 'ing', 'ed', 'ions', 'aaa']) {
			expect(stem(word).length).toBeGreaterThan(0);
		}
		expect(stem('')).toBe('');
	});

	it('is idempotent', () => {
		// Stemming a stem must not strip a second suffix, or the index and the lookup disagree.
		for (const word of ['managing', 'developers', 'deployment', 'running', 'orchestration']) {
			expect(stem(stem(word))).toBe(stem(word));
		}
	});

	it('stems each word of a phrase', () => {
		expect(stemTerm('distributed systems')).toBe(stemTerm('distributed system'));
	});

	it('collapses no two distinct taxonomy skills onto one stem', () => {
		// The audit that justifies using this stemmer at all. If a future rule merges two real
		// skills, this fails with both names rather than silently inflating a keyword score.
		const skills = new Set<string>();
		for (const domain of Object.keys(DOMAINS) as Domain[]) {
			for (const skill of getIndustrySkills(domain)) skills.add(skill);
		}

		const byStem = new Map<string, string[]>();
		for (const skill of skills) {
			const key = stemTerm(skill);
			byStem.set(key, [...(byStem.get(key) ?? []), skill]);
		}

		const collisions = [...byStem.values()].filter((group) => group.length > 1);
		expect(collisions).toEqual([]);
	});
});
