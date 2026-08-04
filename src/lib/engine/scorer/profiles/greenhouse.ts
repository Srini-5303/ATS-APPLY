import { QUANT_BONUS_RATIO } from '../constants/quantification';
import type { AtsProfile } from '../../types/scoring';
import { bonusWhen } from '../quirks/factories';

export const greenhouse: AtsProfile = {
	id: 'greenhouse',
	system: 'Greenhouse',
	vendor: 'Greenhouse Software',
	weights: {
		formatting: 0.1,
		keywordMatch: 0.25,
		sections: 0.1,
		experience: 0.25,
		education: 0.1,
		quantification: 0.2
	},
	parsingStrictness: 0.4,
	keywordStrategy: 'semantic',
	passingScore: 55,
	requiredSections: ['experience', 'education'],
	quirks: [
		bonusWhen(
			'greenhouse.strong-quantification',
			(c) =>
				c.analysis.bullets.length > 0 &&
				c.analysis.quantifiedBulletCount / c.analysis.bullets.length >= QUANT_BONUS_RATIO,
			8,
			'quantification'
		),
		bonusWhen(
			'greenhouse.projects-present',
			(c) => c.analysis.sectionSet.has('projects'),
			3,
			'sections'
		)
	],
	meta: {
		parserType: 'Fine-tuned LLM',
		philosophy: 'No auto-scoring; human-driven scorecards',
		marketShare: 'Common across tech',
		breaks: [
			'Very tolerant of layout — reads narrative prose well',
			'Weak, unquantified bullets are the real risk here rather than formatting'
		],
		ranking:
			'No automatic candidate score by default. Talent Matching surfaces candidates, and hiring decisions run through structured human scorecards, so substance beats keyword density.',
		autoReject: null
	}
};
