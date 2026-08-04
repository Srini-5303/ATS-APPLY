import { LEVER_BULLET_MAX, LEVER_BULLET_MIN } from '../constants/bullets';
import type { AtsProfile } from '../../types/scoring';
import { betweenBonus, bonusWhen } from '../quirks/factories';

export const lever: AtsProfile = {
	id: 'lever',
	system: 'Lever',
	vendor: 'Lever (Employ)',
	weights: {
		formatting: 0.08,
		keywordMatch: 0.22,
		sections: 0.1,
		experience: 0.3,
		education: 0.1,
		quantification: 0.2
	},
	parsingStrictness: 0.35,
	keywordStrategy: 'semantic',
	passingScore: 50,
	requiredSections: ['experience'],
	quirks: [
		// Narrative quality signal: bullets long enough to carry context but short enough to
		// scan.
		betweenBonus(
			'lever.narrative-bullets',
			(c) => c.analysis.avgBulletChars,
			LEVER_BULLET_MIN,
			LEVER_BULLET_MAX,
			5
		),
		bonusWhen('lever.summary-present', (c) => c.analysis.sectionSet.has('summary'), 3)
	],
	meta: {
		parserType: 'Proprietary (Sovren lineage)',
		philosophy: 'Word stemming; no algorithmic scoring',
		marketShare: 'Startups and mid-market',
		breaks: [
			'Highly tolerant of layout',
			'Very short or telegraphic bullets read poorly in a review-first workflow'
		],
		ranking:
			'No algorithmic ranking. Recruiters search and review directly, with word stemming widening matches, so readable narrative bullets matter more than exact terms.',
		autoReject: null
	}
};
