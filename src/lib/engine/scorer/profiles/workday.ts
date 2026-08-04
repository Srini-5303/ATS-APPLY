import type { AtsProfile } from '../../types/scoring';
import { penaltyWhen } from '../quirks/factories';

export const workday: AtsProfile = {
	id: 'workday',
	system: 'Workday',
	vendor: 'Workday Inc.',
	weights: {
		formatting: 0.25,
		keywordMatch: 0.3,
		sections: 0.15,
		experience: 0.15,
		education: 0.1,
		quantification: 0.05
	},
	parsingStrictness: 0.9,
	keywordStrategy: 'exact',
	passingScore: 70,
	// `contact` is deliberately absent: PRD §5.5 assigns all pre-header content to it, so it
	// is present for every non-empty resume and therefore carries no signal (ADR 0001 §7).
	requiredSections: ['experience', 'education', 'skills'],
	quirks: [
		penaltyWhen(
			'workday.non-standard-headers',
			(c) => c.analysis.unknownSectionCount > 2,
			5,
			{
				summary: 'Rename non-standard section headers',
				details: [
					'Workday maps headers to a fixed taxonomy. Headers it does not recognise get filed as unclassified and their content may be dropped from the candidate profile.',
					'Use conventional names: "Experience", "Education", "Skills", "Projects".'
				],
				impact: 'high'
			},
			'sections'
		),
		// Truncation costs whole pages of content, not one dimension's worth — it stays on the
		// overall.
		penaltyWhen('workday.page-truncation', (c) => c.input.pageCount > 2, 8, {
			summary: 'Cut the resume to two pages',
			details: [
				'Workday truncates long documents during import, so content past page two may never reach a recruiter.',
				'Keep the most recent and most relevant roles; drop older detail.'
			],
			impact: 'critical'
		})
	],
	meta: {
		parserType: 'Proprietary',
		philosophy: 'Strict, keyword-heavy, format-sensitive',
		marketShare: '~40% of the Fortune 500',
		breaks: [
			'Multi-column layouts are read straight across the page, interleaving the columns',
			'Table cells are flattened or dropped on import',
			'Content in headers and footers is frequently lost',
			'Documents past two pages are truncated during import',
			'Section headings outside its taxonomy are filed as unclassified and may be discarded'
		],
		ranking:
			'No single match score is shown to recruiters. Candidates surface through saved-search filters over the parsed profile, so an unparsed field is an absent field.',
		autoReject:
			'Knockout questions on the application form itself, not the resume — but an unparsed profile fails the filters that follow.'
	}
};
