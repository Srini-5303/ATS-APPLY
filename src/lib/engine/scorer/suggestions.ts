import type { AtsProfile, ScoreBreakdown, ResumeAnalysis, Suggestion } from '../types/scoring';

/**
 * Advice derived from the dimension scores (PRD §7.10).
 *
 * This table was specified but never built: suggestions came only from platform quirks, so a
 * resume that triggered no quirk got almost no advice even when a dimension was visibly weak.
 * A report that scores quantification at 67 and then says nothing about quantification is not
 * much use.
 *
 * Every rule names the actual shortfall — which terms are missing, how many bullets lack a
 * number — because "add more keywords" is advice the reader already knew.
 */

interface Rule {
	id: string;
	applies: (b: ScoreBreakdown, a: ResumeAnalysis) => boolean;
	build: (b: ScoreBreakdown, a: ResumeAnalysis, p: AtsProfile) => Suggestion;
}

/** At most this many example terms in one line of advice. */
const SAMPLE = 6;

function list(terms: string[]): string {
	const head = terms.slice(0, SAMPLE).join(', ');
	const rest = terms.length - SAMPLE;
	return rest > 0 ? `${head} and ${String(rest)} more` : head;
}

const RULES: Rule[] = [
	{
		id: 'keywords.targeted',
		applies: (b) => !b.keywordMatch.isIndustryProxy && b.keywordMatch.score < 70,
		build: (b, _a, p) => ({
			summary: 'Add the requirements this posting names that your resume does not',
			details: [
				`Missing from your resume: ${list(b.keywordMatch.missing)}.`,
				`${p.system} matches keywords ${p.keywordStrategy === 'exact' ? 'literally, so use the posting’s exact wording rather than a synonym' : 'loosely, so a close variant will still be found'}.`,
				'Work them into the bullet where you actually used them, not a keyword list.'
			],
			impact: b.keywordMatch.score < 40 ? 'critical' : 'high',
			platforms: [p.system]
		})
	},
	{
		id: 'keywords.industry',
		applies: (b) => b.keywordMatch.isIndustryProxy && b.keywordMatch.score < 65,
		build: (b, _a, p) => ({
			summary: 'Broaden the vocabulary recruiters search for in your field',
			details: [
				`Common in your field but absent here: ${list(b.keywordMatch.missing)}.`,
				'Only add what you have genuinely used — a keyword you cannot discuss in an interview costs more than it gains.'
			],
			impact: 'medium',
			platforms: [p.system]
		})
	},
	{
		id: 'quantification',
		applies: (b) => b.quantification.score < 75 && b.quantification.totalBullets > 0,
		build: (b, _a, p) => {
			const unquantified = b.quantification.totalBullets - b.quantification.quantifiedBullets;
			return {
				summary: 'Put numbers on more of your bullet points',
				details: [
					`${String(unquantified)} of ${String(b.quantification.totalBullets)} bullets carry no figure — a percentage, a count, an amount or a duration.`,
					b.quantification.examples[0]
						? `Your strongest example reads: "${b.quantification.examples[0].slice(0, 110)}". Aim for that shape throughout.`
						: 'Scale, cost, time saved and volume are all quantifiable.'
				],
				impact: b.quantification.score < 40 ? 'high' : 'medium',
				platforms: [p.system]
			};
		}
	},
	{
		id: 'experience.verbs',
		applies: (b) => b.experience.score < 70 && b.experience.totalBullets > 0,
		build: (b, _a, p) => ({
			summary: 'Open more bullets with a strong action verb',
			details: [
				`${String(b.experience.actionVerbCount)} of ${String(b.experience.totalBullets)} bullets begin with one.`,
				'Built, led, reduced, migrated and designed read as ownership; "responsible for" and "helped with" do not.'
			],
			impact: 'medium',
			platforms: [p.system]
		})
	},
	{
		id: 'experience.thin',
		applies: (b) => b.experience.totalBullets === 0,
		build: (_b, _a, p) => ({
			summary: 'Describe what you did in each role',
			details: [
				'No achievement bullets were found under your roles.',
				`${p.system} scores experience on the substance beneath each job title, not the title alone.`
			],
			impact: 'critical',
			platforms: [p.system]
		})
	},
	{
		id: 'sections.missing',
		applies: (b) => b.sections.missing.length > 0,
		build: (b, _a, p) => ({
			summary: `Add the ${b.sections.missing.join(' and ')} section${b.sections.missing.length > 1 ? 's' : ''}`,
			details: [
				`${p.system} maps content to fixed fields by heading, so a missing section leaves that field empty on your candidate record.`,
				'Use the conventional heading word — a creative label will not be recognised.'
			],
			impact: 'critical',
			platforms: [p.system]
		})
	},
	{
		id: 'education',
		applies: (b) => b.education.score < 70,
		build: (b, _a, p) => ({
			summary: 'Complete the education entry',
			details:
				b.education.notes.length > 0
					? b.education.notes.slice(0, 3)
					: ['Add the degree, institution and graduation year.'],
			impact: b.education.score < 40 ? 'high' : 'medium',
			platforms: [p.system]
		})
	},
	{
		id: 'formatting',
		applies: (b) => b.formatting.score < 85 && b.formatting.issues.length > 0,
		build: (b, _a, p) => ({
			summary: 'Simplify the layout so it survives parsing',
			details: [
				...b.formatting.details.slice(0, 2),
				`${p.system} parses at ${p.parsingStrictness >= 0.8 ? 'high' : p.parsingStrictness >= 0.5 ? 'moderate' : 'low'} strictness, so this costs ${p.parsingStrictness >= 0.8 ? 'more here than elsewhere' : 'less here than on stricter platforms'}.`
			],
			impact: b.formatting.score < 60 ? 'high' : 'medium',
			platforms: [p.system]
		})
	}
];

export function buildSuggestions(
	breakdown: ScoreBreakdown,
	analysis: ResumeAnalysis,
	profile: AtsProfile
): Suggestion[] {
	return RULES.filter((rule) => rule.applies(breakdown, analysis)).map((rule) =>
		rule.build(breakdown, analysis, profile)
	);
}
