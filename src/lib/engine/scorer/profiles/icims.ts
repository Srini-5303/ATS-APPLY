import type { AtsProfile } from '../../types/scoring';
import { bonusWhen } from '../quirks/factories';

export const icims: AtsProfile = {
	id: 'icims',
	system: 'iCIMS',
	vendor: 'iCIMS',
	weights: {
		formatting: 0.15,
		keywordMatch: 0.3,
		sections: 0.15,
		experience: 0.2,
		education: 0.1,
		quantification: 0.1
	},
	parsingStrictness: 0.6,
	keywordStrategy: 'fuzzy',
	passingScore: 60,
	requiredSections: ['experience', 'education'],
	quirks: [
		bonusWhen(
			'icims.rich-skill-taxonomy',
			(c) => c.input.resumeSkills.length >= 10,
			5,
			'keywordMatch'
		)
	],
	meta: {
		parserType: 'HireAbility ALEX (grammar-based NLP)',
		philosophy: 'Semantic matching with role-fit scoring',
		marketShare: '~15% of the Fortune 500',
		breaks: [
			'More layout-tolerant than the strict enterprise parsers',
			'Graphics-heavy and template-driven resumes still lose content',
			'Skills buried only in prose are weaker than an explicit skills section'
		],
		ranking:
			'Normalises skills onto a controlled taxonomy before matching, so common variants resolve to the same concept, then scores role fit.',
		autoReject: null
	}
};
