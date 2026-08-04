/** Scoring contracts — PRD §7.1–7.2, as amended by ADR 0001 decisions 5, 6 and 7. */

import type { EducationEntry, ExperienceEntry, ProjectEntry, SectionType } from './parser';

export const PLATFORM_IDS = [
	'workday',
	'taleo',
	'icims',
	'greenhouse',
	'lever',
	'successfactors'
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/**
 * Six weighted dimensions. `quantification` is first-class here: PRD §7.3 gives it a weight
 * of up to 0.20 but §7.2 omitted it from the breakdown and §12.2's card showed only five
 * bars, so the dimension driving ~30% of Greenhouse's score was invisible (ADR 0001 §5).
 */
export const DIMENSIONS = [
	'formatting',
	'keywordMatch',
	'sections',
	'experience',
	'education',
	'quantification'
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export type KeywordStrategy = 'exact' | 'fuzzy' | 'semantic';

export type Impact = 'critical' | 'high' | 'medium' | 'low';

export interface ScoringInput {
	resumeText: string;
	resumeSkills: string[];
	resumeSections: SectionType[];

	/**
	 * Structured entries, not just flattened strings. PRD §7.1 passed only
	 * `educationText: string` and a flat section-name list, which cannot express the quirks
	 * §7.9 requires (SuccessFactors needs experience dates, Workday needs a count of unknown
	 * sections, Lever needs summary presence) and would force the scorer to re-parse text the
	 * parser already structured (ADR 0001 §6).
	 */
	experience: ExperienceEntry[];
	education: EducationEntry[];
	projects: ProjectEntry[];
	summary: string | null;
	sectionCounts: Record<SectionType, number>;

	hasMultipleColumns: boolean;
	hasTables: boolean;
	hasImages: boolean;
	pageCount: number;
	wordCount: number;

	jobDescription?: string;
}

export interface FormattingBreakdown {
	score: number;
	issues: string[];
	details: string[];
}

export interface KeywordBreakdown {
	score: number;
	matched: string[];
	missing: string[];
	synonymMatched: string[];
	/** True in general mode, where the slot is scored by industry-term coverage rather than
	 *  JD matching (ADR 0001 §1). Lets the UI label the bar honestly. */
	isIndustryProxy: boolean;
}

export interface SectionsBreakdown {
	score: number;
	present: SectionType[];
	missing: SectionType[];
}

export interface ExperienceBreakdown {
	score: number;
	totalBullets: number;
	actionVerbCount: number;
	highlights: string[];
}

export interface EducationBreakdown {
	score: number;
	notes: string[];
}

export interface QuantificationBreakdown {
	score: number;
	quantifiedBullets: number;
	totalBullets: number;
	examples: string[];
}

export interface ScoreBreakdown {
	formatting: FormattingBreakdown;
	keywordMatch: KeywordBreakdown;
	sections: SectionsBreakdown;
	experience: ExperienceBreakdown;
	education: EducationBreakdown;
	quantification: QuantificationBreakdown;
}

export interface Suggestion {
	summary: string;
	details: string[];
	impact: Impact;
	platforms: string[];
}

export interface ScoreResult {
	platformId: PlatformId;
	system: string;
	vendor: string;
	overallScore: number;
	passesFilter: boolean;
	breakdown: ScoreBreakdown;
	suggestions: Suggestion[];
}

/** A dimension scorer's return value, before weighting. */
export interface DimensionScore {
	score: number;
}

export interface QuirkContext {
	input: ScoringInput;
	analysis: ResumeAnalysis;
	profile: AtsProfile;
	dimensions: Record<Dimension, number>;
}

export interface QuirkRule {
	/** Globally unique, prefixed with the platform id, e.g. 'workday.page-truncation'. */
	id: string;
	/**
	 * The dimension this quirk actually measures.
	 *
	 * When set, the delta lands on that dimension's sub-score and reaches the overall through
	 * the weighted sum, so the bar the user sees moves with it. Omit only for whole-document
	 * effects that belong to no single dimension.
	 *
	 * Every quirk used to add into one scalar applied after the weighted sum, which meant a
	 * platform-specific experience penalty left the experience bar untouched and silently
	 * moved the total instead — six identical bars above six differing overalls.
	 */
	dimension?: Dimension;
	/** Signed point delta. */
	evaluate: (ctx: QuirkContext) => number;
	explain: (ctx: QuirkContext) => Suggestion | null;
}

/**
 * A platform profile is entirely declarative. The six platforms vary along exactly four
 * axes: the numeric fields, the keyword strategy, the required-section list, and the quirk
 * array. A `switch (profile.id)` inside a dimension scorer is a defect — the fix is a new
 * profile field or a new quirk.
 */
export interface AtsProfile {
	readonly id: PlatformId;
	readonly system: string;
	readonly vendor: string;
	/** Must sum to 1.0; asserted by a registry invariant test. */
	readonly weights: Readonly<Record<Dimension, number>>;
	/** 0–1. Scales every formatting penalty in PRD §7.4. */
	readonly parsingStrictness: number;
	readonly keywordStrategy: KeywordStrategy;
	readonly passingScore: number;
	readonly requiredSections: readonly SectionType[];
	readonly quirks: readonly QuirkRule[];
	/**
	 * Domain detail about the real platform.
	 *
	 * Feeds the LLM prompt, the UI tooltips and the docs from one place. Keeping it on the
	 * profile rather than writing it into the prompt as prose is what stops the two from
	 * drifting — the defect that left PRD §7.9 and §8.2 disagreeing about Taleo's threshold.
	 *
	 * These are researched characterisations of publicly documented behaviour, not verified
	 * measurements. Nobody outside these vendors can observe their scoring directly, and the
	 * prompt says so.
	 */
	readonly meta: {
		readonly parserType: string;
		readonly philosophy: string;
		readonly marketShare: string;
		/** Specific things known to defeat this parser. */
		readonly breaks: readonly string[];
		/** How the platform surfaces or ranks candidates natively. */
		readonly ranking: string;
		/** Automatic rejection behaviour, or null where the platform does not auto-reject. */
		readonly autoReject: string | null;
	};
}

/** Per-bullet facts, computed once so all six profiles provably see identical inputs. */
export interface BulletFact {
	text: string;
	charLength: number;
	startsWithActionVerb: boolean;
	isQuantified: boolean;
}

/**
 * Everything platform-independent, computed once by `buildAnalysis()` and shared across all
 * six profiles. Makes every dimension scorer a pure function of (analysis, profile), and
 * makes "Workday and Taleo disagree about the bullet count" structurally impossible.
 */
export interface ResumeAnalysis {
	input: ScoringInput;
	bullets: BulletFact[];
	quantifiedBulletCount: number;
	actionVerbBulletCount: number;
	avgBulletChars: number;
	sectionSet: ReadonlySet<SectionType>;
	unknownSectionCount: number;
	specialCharRatio: number;
	allCapsLineCount: number;
	bulletStyleCount: number;
	hasStructuredExperience: boolean;
	experienceHasDates: boolean;
	/** Canonicalised JD requirement terms, required ones first; empty in general mode. */
	jdTerms: string[];
	/**
	 * The subset of `jdTerms` the posting lists as required rather than preferred.
	 *
	 * The job parser has always drawn this distinction — a stateful scan for "Requirements"
	 * against "Nice to have" — but `scoringTerms()` flattened both into one list, so missing a
	 * hard requirement cost exactly as much as missing a bonus.
	 */
	jdRequiredTerms: ReadonlySet<string>;
	resumeTerms: string[];
}

export interface ScoreOptions {
	/** Restrict to a subset of platforms. Defaults to all six. */
	systems?: PlatformId[];
}
