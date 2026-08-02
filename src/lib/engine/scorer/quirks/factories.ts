import type { Impact, QuirkContext, QuirkRule, Suggestion } from '../../types/scoring';

/**
 * PRD §7.9's quirk table is the only place the six platforms genuinely diverge in shape.
 * All 14 quirks reduce to the four factories below, so each profile declares its quirks as
 * one line of data rather than bespoke logic.
 */

export interface QuirkTemplate {
	summary: string;
	details: string[];
	impact: Impact;
}

function suggestionFrom(template: QuirkTemplate, ctx: QuirkContext): Suggestion {
	return {
		summary: template.summary,
		details: template.details,
		impact: template.impact,
		platforms: [ctx.profile.system]
	};
}

/** Deduct a fixed number of points when `predicate` holds. */
export function penaltyWhen(
	id: string,
	predicate: (ctx: QuirkContext) => boolean,
	points: number,
	template: QuirkTemplate
): QuirkRule {
	return {
		id,
		evaluate: (ctx) => (predicate(ctx) ? -points : 0),
		explain: (ctx) => (predicate(ctx) ? suggestionFrom(template, ctx) : null)
	};
}

/** Award a fixed number of points when `predicate` holds. Bonuses do not emit suggestions —
 *  there is nothing for the user to fix. */
export function bonusWhen(
	id: string,
	predicate: (ctx: QuirkContext) => boolean,
	points: number
): QuirkRule {
	return {
		id,
		evaluate: (ctx) => (predicate(ctx) ? points : 0),
		explain: () => null
	};
}

/** Deduct `pointsPerUnit` for each unit counted by `countFn` (e.g. each missing section). */
export function perUnit(
	id: string,
	countFn: (ctx: QuirkContext) => number,
	pointsPerUnit: number,
	template: QuirkTemplate
): QuirkRule {
	return {
		id,
		evaluate: (ctx) => -countFn(ctx) * pointsPerUnit,
		explain: (ctx) => (countFn(ctx) > 0 ? suggestionFrom(template, ctx) : null)
	};
}

/** Award points when a measured value falls inside an inclusive range. */
export function betweenBonus(
	id: string,
	valueFn: (ctx: QuirkContext) => number,
	min: number,
	max: number,
	points: number
): QuirkRule {
	return {
		id,
		evaluate: (ctx) => {
			const v = valueFn(ctx);
			return v >= min && v <= max ? points : 0;
		},
		explain: () => null
	};
}
