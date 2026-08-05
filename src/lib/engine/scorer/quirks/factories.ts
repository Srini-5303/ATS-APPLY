import type { Dimension, Impact, QuirkContext, QuirkRule, Suggestion } from '../../types/scoring';

/**
 * PRD §7.9's quirk table is the only place the six platforms genuinely diverge in shape.
 * All 14 quirks reduce to the four factories below, so each profile declares its quirks as
 * one line of data rather than bespoke logic.
 *
 * Each factory takes an optional trailing `dimension`. Supplying it routes the delta onto
 * that dimension's sub-score instead of the overall, which is what makes the per-platform
 * bars differ — see `QuirkRule.dimension`.
 */

export interface QuirkTemplate {
	summary: string;
	details: string[];
	impact: Impact;
}

function suggestionFrom(
	template: QuirkTemplate,
	ctx: QuirkContext,
	dimension?: Dimension
): Suggestion {
	const base: Suggestion = {
		summary: template.summary,
		details: template.details,
		impact: template.impact,
		platforms: [ctx.profile.system]
	};

	// A quirk that names a dimension explains that bar, so its advice files under it too.
	return dimension ? { ...base, dimension } : base;
}

/** `exactOptionalPropertyTypes` rejects an explicit `dimension: undefined`, so omit the key. */
function withDimension(rule: Omit<QuirkRule, 'dimension'>, dimension?: Dimension): QuirkRule {
	return dimension ? { ...rule, dimension } : rule;
}

/** Deduct a fixed number of points when `predicate` holds. */
export function penaltyWhen(
	id: string,
	predicate: (ctx: QuirkContext) => boolean,
	points: number,
	template: QuirkTemplate,
	dimension?: Dimension
): QuirkRule {
	return withDimension(
		{
			id,
			evaluate: (ctx) => (predicate(ctx) ? -points : 0),
			explain: (ctx) => (predicate(ctx) ? suggestionFrom(template, ctx, dimension) : null)
		},
		dimension
	);
}

/** Award a fixed number of points when `predicate` holds. Bonuses do not emit suggestions —
 *  there is nothing for the user to fix. */
export function bonusWhen(
	id: string,
	predicate: (ctx: QuirkContext) => boolean,
	points: number,
	dimension?: Dimension
): QuirkRule {
	return withDimension(
		{
			id,
			evaluate: (ctx) => (predicate(ctx) ? points : 0),
			explain: () => null
		},
		dimension
	);
}

/** Deduct `pointsPerUnit` for each unit counted by `countFn` (e.g. each missing section). */
export function perUnit(
	id: string,
	countFn: (ctx: QuirkContext) => number,
	pointsPerUnit: number,
	template: QuirkTemplate,
	dimension?: Dimension
): QuirkRule {
	return withDimension(
		{
			id,
			evaluate: (ctx) => -countFn(ctx) * pointsPerUnit,
			explain: (ctx) => (countFn(ctx) > 0 ? suggestionFrom(template, ctx, dimension) : null)
		},
		dimension
	);
}

/**
 * How many of the profile's own required sections are absent.
 *
 * Shared because two profiles declare the same rule at different severities — the count is
 * the rule, the points are the platform difference.
 */
export function missingRequiredSections(ctx: QuirkContext): number {
	return ctx.profile.requiredSections.filter((s) => !ctx.analysis.sectionSet.has(s)).length;
}

/** Award points when a measured value falls inside an inclusive range. */
export function betweenBonus(
	id: string,
	valueFn: (ctx: QuirkContext) => number,
	min: number,
	max: number,
	points: number,
	dimension?: Dimension
): QuirkRule {
	return withDimension(
		{
			id,
			evaluate: (ctx) => {
				const v = valueFn(ctx);
				return v >= min && v <= max ? points : 0;
			},
			explain: () => null
		},
		dimension
	);
}
