import { PROFILES } from '../scorer/profiles';
import type { Impact, ScoreResult, Suggestion } from '../types/scoring';
import { MAX_ADJUSTMENT } from './prompt';

/**
 * Reconciles a model response against the deterministic baseline.
 *
 * Everything here assumes the model output is untrusted: it may return four platforms or
 * eight, duplicate one, invent a name, exceed the adjustment bound, or put a number where a
 * string belongs. Any platform the model does not usefully address keeps its baseline score,
 * so the result set is always exactly six and always complete (ADR 0001 §2).
 */

const IMPACTS: readonly Impact[] = ['critical', 'high', 'medium', 'low'];

interface RawAdjustment {
	system?: unknown;
	adjustment?: unknown;
	reason?: unknown;
	suggestions?: unknown;
}

function asString(value: unknown, max = 300): string | null {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed === '' ? null : trimmed.slice(0, max);
	}
	// Models occasionally emit a number where a string is specified.
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return null;
}

function asImpact(value: unknown): Impact {
	const s = typeof value === 'string' ? value.toLowerCase() : '';
	return IMPACTS.includes(s as Impact) ? (s as Impact) : 'medium';
}

/**
 * Models sometimes fill the slot with "No changes needed" rather than returning an empty
 * array. That is a valid verdict but not a recommendation, and it reads as filler under a
 * heading that promises improvements.
 */
const NON_SUGGESTION =
	/^(?:no|none|n\/a)\b.*\b(?:change|action|improvement|issue|recommendation|suggestion|needed|required)\b|^(?:looks good|well structured|already)\b/i;

function parseSuggestions(value: unknown, system: string): Suggestion[] {
	if (!Array.isArray(value)) return [];

	return value
		.slice(0, 5)
		.map((raw): Suggestion | null => {
			if (typeof raw !== 'object' || raw === null) return null;
			const r = raw as Record<string, unknown>;

			const summary = asString(r.summary, 160);
			if (!summary || NON_SUGGESTION.test(summary)) return null;

			const details = Array.isArray(r.details)
				? r.details
						.slice(0, 4)
						.map((d) => asString(d, 400))
						.filter((d): d is string => d !== null)
				: [];

			return { summary, details, impact: asImpact(r.impact), platforms: [system] };
		})
		.filter((s): s is Suggestion => s !== null);
}

export interface ReconcileOutcome {
	results: ScoreResult[];
	/** How many platforms the model actually moved, for logging. */
	adjustedCount: number;
}

export function reconcile(baseline: ScoreResult[], parsed: unknown): ReconcileOutcome {
	const bySystem = new Map<string, RawAdjustment>();

	const container =
		typeof parsed === 'object' && parsed !== null ? (parsed as { results?: unknown }) : {};
	const rawResults: unknown[] = Array.isArray(container.results) ? container.results : [];

	for (const entry of rawResults) {
		if (typeof entry !== 'object' || entry === null) continue;

		const candidate: RawAdjustment = entry;
		const system = asString(candidate.system, 40);
		if (!system) continue;

		// First mention wins; a duplicate platform is dropped rather than merged.
		const key = system.toLowerCase();
		if (!bySystem.has(key)) bySystem.set(key, candidate);
	}

	let adjustedCount = 0;

	const results = baseline.map((base): ScoreResult => {
		const raw = bySystem.get(base.system.toLowerCase());
		if (!raw) return base;

		const rawAdjustment = typeof raw.adjustment === 'number' ? raw.adjustment : 0;
		if (!Number.isFinite(rawAdjustment) || rawAdjustment === 0) {
			return withSuggestions(base, parseSuggestions(raw.suggestions, base.system));
		}

		// Clamp rather than reject: a model returning -40 still carries the signal that this
		// platform should score lower.
		const adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawAdjustment));
		const overallScore = Math.max(0, Math.min(100, Math.round(base.overallScore + adjustment)));

		adjustedCount += 1;

		return {
			...base,
			overallScore,
			// Recomputed from the profile, never taken from the model (ADR 0001 §3).
			passesFilter: overallScore >= PROFILES[base.platformId].passingScore,
			suggestions: mergeSuggestions(
				base.suggestions,
				parseSuggestions(raw.suggestions, base.system)
			)
		};
	});

	return { results, adjustedCount };
}

function withSuggestions(base: ScoreResult, extra: Suggestion[]): ScoreResult {
	if (extra.length === 0) return base;
	return { ...base, suggestions: mergeSuggestions(base.suggestions, extra) };
}

/** Deterministic suggestions first — they are the ones tied to a measurable rule. */
function mergeSuggestions(deterministic: Suggestion[], fromModel: Suggestion[]): Suggestion[] {
	const seen = new Set(deterministic.map((s) => s.summary.toLowerCase()));
	const additions = fromModel.filter((s) => !seen.has(s.summary.toLowerCase()));
	return [...deterministic, ...additions].slice(0, 8);
}
