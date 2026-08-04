import type { AtsProfile } from '../../types/scoring';
import { isAbbreviatedDegree } from '../dimensions/education';
import { penaltyWhen, perUnit } from '../quirks/factories';

export const successfactors: AtsProfile = {
	id: 'successfactors',
	system: 'SuccessFactors',
	vendor: 'SAP',
	weights: {
		formatting: 0.25,
		keywordMatch: 0.25,
		sections: 0.2,
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
			'successfactors.no-experience-dates',
			(c) => !c.analysis.experienceHasDates,
			10,
			{
				summary: 'Add start and end dates to every role',
				details: [
					'SuccessFactors builds a structured employment timeline. Roles without dates cannot be placed on it and may be discarded.',
					'Use a consistent format such as "Jan 2023 – Dec 2024" or "01/2023 – 12/2024".'
				],
				impact: 'critical'
			},
			'experience'
		),
		penaltyWhen(
			'successfactors.no-structured-experience',
			(c) => !c.analysis.hasStructuredExperience,
			8,
			{
				summary: 'Give each role a clear title, employer and date line',
				details: [
					'The Textkernel parser expects a recognisable header per role. Without one it cannot split your history into discrete positions.',
					'Format each entry as "Job Title | Company | Location | Dates" on its own line.'
				],
				impact: 'high'
			},
			'experience'
		),
		perUnit(
			'successfactors.missing-sections',
			(c) => c.profile.requiredSections.filter((s) => !c.analysis.sectionSet.has(s)).length,
			5,
			{
				summary: 'Add the standard resume sections',
				details: [
					'SuccessFactors maps sections onto a profile-first candidate record; a missing section leaves that part of the profile blank.',
					'Include Experience, Education and Skills with conventional headings.'
				],
				impact: 'high'
			},
			'sections'
		),
		// Textkernel resolves common abbreviations but still records the literal string, so an
		// initialism costs less here than under Taleo's OCR indexing rather than nothing.
		penaltyWhen(
			'successfactors.abbreviated-degree',
			(c) => c.input.education.some((e) => isAbbreviatedDegree(e.degree)),
			6,
			{
				summary: 'Spell the degree out in full',
				details: [
					'SuccessFactors stores the degree as a profile field. An initialism such as "M.S." populates it less reliably than the written form.',
					'Write "Master of Science (M.S.)" so both forms are captured.'
				],
				impact: 'medium'
			},
			'education'
		)
	],
	meta: {
		parserType: 'Textkernel',
		philosophy: 'Joule AI stack ranking, profile-first',
		marketShare: '~15% of the Fortune 500',
		breaks: [
			'Builds a structured employment timeline, so roles without dates cannot be placed on it',
			'A role lacking a recognisable title / employer / date header may not register as a position at all',
			'Multi-column layouts and tables degrade field extraction'
		],
		ranking:
			'Joule AI stack-ranks the parsed candidate profile rather than the document, so anything that fails to reach a profile field cannot contribute.',
		autoReject:
			'No automatic rejection, but an incomplete profile ranks poorly and can drop out of the shortlist.'
	}
};
