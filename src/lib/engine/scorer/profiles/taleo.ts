import type { AtsProfile } from '../../types/scoring';
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
		penaltyWhen('taleo.low-skill-density', (c) => c.input.resumeSkills.length < 5, 10, {
			summary: 'List more skills explicitly',
			details: [
				'Taleo relies on Boolean keyword search over a literal skills list. Fewer than five detected skills leaves recruiters little to match against.',
				'Add a dedicated Skills section naming tools, languages and platforms in full.'
			],
			impact: 'critical'
		}),
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
			}
		)
	],
	meta: {
		parserType: 'OCR-based (legacy)',
		philosophy: 'Literal keyword matching, capable of auto-rejection',
		marketShare: '~25% of the Fortune 500'
	}
};
