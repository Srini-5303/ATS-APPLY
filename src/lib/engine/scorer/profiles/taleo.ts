import type { AtsProfile } from '../../types/scoring';
import { isAbbreviatedDegree } from '../dimensions/education';
import { penaltyWhen, perUnit } from '../quirks/factories';

export const taleo: AtsProfile = {
	id: 'taleo',
	system: 'Taleo',
	vendor: 'Oracle',
	weights: {
		formatting: 0.2,
		keywordMatch: 0.35,
		sections: 0.15,
		experience: 0.15,
		education: 0.1,
		quantification: 0.05
	},
	parsingStrictness: 0.85,
	keywordStrategy: 'exact',
	passingScore: 65,
	requiredSections: ['experience', 'education', 'skills'],
	quirks: [
		penaltyWhen(
			'taleo.low-skill-density',
			(c) => c.input.resumeSkills.length < 5,
			10,
			{
				summary: 'List more skills explicitly',
				details: [
					'Taleo relies on Boolean keyword search over a literal skills list. Fewer than five detected skills leaves recruiters little to match against.',
					'Add a dedicated Skills section naming tools, languages and platforms in full.'
				],
				impact: 'critical'
			},
			'keywordMatch'
		),
		perUnit(
			'taleo.missing-sections',
			(c) => c.profile.requiredSections.filter((s) => !c.analysis.sectionSet.has(s)).length,
			8,
			{
				summary: 'Add the standard resume sections',
				details: [
					'Taleo maps content to fixed fields by section header. A missing section means an empty field on the candidate record.',
					'Include Experience, Education and Skills with conventional headings.'
				],
				impact: 'critical'
			},
			'sections'
		),
		// Taleo indexes the literal string. "M.S." never matches a requisition asking for
		// "Master of Science" — the mismatch that makes education the one dimension where an
		// OCR-era parser genuinely scores a good entry lower than everyone else.
		penaltyWhen(
			'taleo.abbreviated-degree',
			(c) => c.input.education.some((e) => isAbbreviatedDegree(e.degree)),
			10,
			{
				summary: 'Spell the degree out in full',
				details: [
					'Taleo matches credential strings literally, so "M.S." and "Master of Science" are unrelated tokens to it.',
					'Write "Master of Science (M.S.)" so both forms are indexed.'
				],
				impact: 'high'
			},
			'education'
		)
	],
	meta: {
		parserType: 'OCR-based (legacy)',
		philosophy: 'Literal keyword matching, capable of auto-rejection',
		marketShare: '~25% of the Fortune 500',
		breaks: [
			'OCR misreads decorative fonts, ligatures and unusual glyphs',
			'Text in headers and footers is commonly lost entirely',
			'Tables are badly mangled',
			'Graphics and text boxes yield nothing at all'
		],
		ranking:
			'Req Rank / ACE scoring: Boolean keyword search over indexed fields, matched literally against the requisition and ranked by density. A synonym is simply a different word.',
		autoReject:
			'Yes. Required keywords and qualifications can be configured as hard knockouts that filter a candidate before any human sees them.'
	}
};
