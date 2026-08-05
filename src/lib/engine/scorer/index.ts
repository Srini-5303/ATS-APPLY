import { DIMENSIONS, PLATFORM_IDS } from '../types/scoring';
import type {
	AtsProfile,
	Dimension,
	QuirkContext,
	ResumeAnalysis,
	ScoreBreakdown,
	ScoreOptions,
	ScoreResult,
	ScoringInput,
	Suggestion
} from '../types/scoring';
import { buildAnalysis } from './analyze';
import { keywordsActive, scoreKeywords } from './dimensions/keywords';
import { scoreEducation } from './dimensions/education';
import { scoreExperience } from './dimensions/experience';
import { scoreFormatting } from './dimensions/formatting';
import { scoreQuantification } from './dimensions/quantification';
import { scoreSections } from './dimensions/sections';
import { ALL_PROFILES, PROFILES } from './profiles';
import { buildSuggestions } from './suggestions';

/**
 * Deterministic scoring entry point.
 *
 * Pure TypeScript with no UI, DOM or network dependency, so it runs in the browser, in a
 * worker, in Vitest and on Edge alike (PRD §4.2). The client computes these locally and
 * renders them immediately; the LLM refines them later rather than replacing them
 * (ADR 0001 §2).
 */

/** Total quirk adjustment is bounded so the §7.9 table cannot dominate the weighted sum. */
export const QUIRK_MIN = -25;
export const QUIRK_MAX = 15;

/**
 * Same bound, applied per dimension.
 *
 * A quirk routed to a dimension can move that bar by this much before the weighted sum sees
 * it. Bounding each bar separately rather than the sum keeps one harsh dimension from
 * cancelling a bonus on an unrelated one.
 */
export const DIMENSION_QUIRK_MIN = -25;
export const DIMENSION_QUIRK_MAX = 15;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function clampScore(value: number): number {
	// Number.isFinite guards the whole NaN class rather than any single case (ADR 0001 §4).
	if (!Number.isFinite(value)) return 0;
	return clamp(Math.round(value), 0, 100);
}

/** A record carrying one value per dimension, so no call site has to assert the key set. */
function dimensionMap(valueOf: (dimension: Dimension) => number): Record<Dimension, number> {
	return Object.fromEntries(DIMENSIONS.map((d) => [d, valueOf(d)])) as Record<Dimension, number>;
}

function buildBreakdown(analysis: ResumeAnalysis, profile: AtsProfile): ScoreBreakdown {
	return {
		formatting: scoreFormatting(analysis, profile),
		keywordMatch: scoreKeywords(analysis, profile),
		sections: scoreSections(analysis, profile),
		experience: scoreExperience(analysis),
		education: scoreEducation(analysis),
		quantification: scoreQuantification(analysis)
	};
}

/**
 * Effective weights for this scoring run.
 *
 * When a dimension carries no signal — no job description, so no keyword score — its weight
 * is redistributed proportionally across the rest instead of multiplying a fabricated value.
 * PRD §7.5 returned a flat 100 there, which handed Taleo (highest keyword weight) the largest
 * free boost and pushed every clean resume to exactly 100 on all six platforms
 * (ADR 0001 §1).
 *
 * Phase 3 fills the keyword slot with real industry-term coverage in general mode; until
 * then it is always redistributed.
 */
export function effectiveWeights(
	profile: AtsProfile,
	inactive: ReadonlySet<Dimension>
): Record<Dimension, number> {
	const activeTotal = DIMENSIONS.filter((d) => !inactive.has(d)).reduce(
		(sum, d) => sum + profile.weights[d],
		0
	);

	if (activeTotal <= 0) return dimensionMap(() => 0);
	return dimensionMap((d) => (inactive.has(d) ? 0 : profile.weights[d] / activeTotal));
}

interface QuirkOutcome {
	/** Deltas for quirks that name a dimension, keyed by it. */
	byDimension: Record<Dimension, number>;
	/** Deltas for whole-document quirks, applied to the overall after weighting. */
	overall: number;
	suggestions: Suggestion[];
}

function applyQuirks(ctx: QuirkContext, profile: AtsProfile): QuirkOutcome {
	const raw = dimensionMap(() => 0);
	let overall = 0;
	const suggestions: Suggestion[] = [];

	for (const quirk of profile.quirks) {
		const delta = quirk.evaluate(ctx);
		if (Number.isFinite(delta)) {
			// A quirk that names a dimension moves that bar; the overall then follows from the
			// weighted sum rather than from a scalar bolted on afterwards.
			if (quirk.dimension) raw[quirk.dimension] += delta;
			else overall += delta;
		}

		const suggestion = quirk.explain(ctx);
		if (suggestion) suggestions.push(suggestion);
	}

	return {
		byDimension: dimensionMap((d) => clamp(raw[d], DIMENSION_QUIRK_MIN, DIMENSION_QUIRK_MAX)),
		overall: clamp(overall, QUIRK_MIN, QUIRK_MAX),
		suggestions
	};
}

export function scoreWithProfile(analysis: ResumeAnalysis, profile: AtsProfile): ScoreResult {
	const breakdown = buildBreakdown(analysis, profile);

	const baseScores = dimensionMap((d) => breakdown[d].score);

	// Quirks are evaluated against the unadjusted dimensions so that a rule reading
	// `ctx.dimensions` cannot depend on the order quirks happen to run in.
	const { byDimension, overall, suggestions } = applyQuirks(
		{ input: analysis.input, analysis, profile, dimensions: baseScores },
		profile
	);

	// The keyword slot is dropped only when there is no JD *and* no identifiable industry —
	// the single case where scoring it would mean inventing a number (ADR 0001 §1).
	const inactive = new Set<Dimension>();
	if (!keywordsActive(analysis)) inactive.add('keywordMatch');

	// Route each quirk delta to wherever it can still be felt, then bound the residue.
	const dimensionScores = dimensionMap(() => 0);
	let overallDelta = overall;

	for (const d of DIMENSIONS) {
		if (inactive.has(d)) {
			// An inactive dimension carries zero weight, so a quirk routed to it would contribute
			// nothing at all. Taleo's skill-density rule is the whole reason Taleo scores low
			// without a job description; it must not evaporate because the bar it names was
			// dropped. Fall the delta back onto the overall, where it landed before routing
			// existed, and leave the bar showing its unadjusted value.
			overallDelta += byDimension[d];
			dimensionScores[d] = clampScore(baseScores[d]);
			continue;
		}

		// Whatever the bar cannot absorb still counts against the total.
		//
		// A resume with no sections at all sits at 0 on that bar, so Taleo's -24 for three
		// missing sections would land on a floor and disappear — leaving the platform that
		// punishes this hardest scoring higher than the one that barely cares. The shortfall
		// spills through at full strength, which is exactly where it landed before routing
		// existed.
		const raw = baseScores[d] + byDimension[d];
		dimensionScores[d] = clampScore(raw);
		overallDelta += raw - dimensionScores[d];
	}

	overallDelta = clamp(overallDelta, QUIRK_MIN, QUIRK_MAX);

	// Write the adjusted score back so the bar the user sees is the one that was weighted.
	for (const d of DIMENSIONS) breakdown[d].score = dimensionScores[d];

	const weights = effectiveWeights(profile, inactive);
	const weighted = DIMENSIONS.reduce((sum, d) => sum + dimensionScores[d] * weights[d], 0);

	const overallScore = clampScore(weighted + overallDelta);

	// Quirk advice first — it is the platform-specific part — then the dimension rules from
	// PRD §7.10, deduplicated by summary.
	const merged = [...suggestions];
	const seen = new Set(merged.map((s) => s.summary));
	for (const suggestion of buildSuggestions(breakdown, analysis, profile)) {
		if (!seen.has(suggestion.summary)) {
			seen.add(suggestion.summary);
			merged.push(suggestion);
		}
	}

	return {
		platformId: profile.id,
		system: profile.system,
		vendor: profile.vendor,
		overallScore,
		// Always derived from the profile, never taken from a model response (ADR 0001 §3).
		passesFilter: overallScore >= profile.passingScore,
		breakdown,
		suggestions: merged
	};
}

export function scoreResume(input: ScoringInput, options?: ScoreOptions): ScoreResult[] {
	const analysis = buildAnalysis(input);

	const selected = options?.systems
		? PLATFORM_IDS.filter((id) => options.systems?.includes(id)).map((id) => PROFILES[id])
		: ALL_PROFILES;

	return selected.map((profile) => scoreWithProfile(analysis, profile));
}

export { buildAnalysis } from './analyze';
export { ALL_PROFILES, PROFILES, validateProfiles } from './profiles';
