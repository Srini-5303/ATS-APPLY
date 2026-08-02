import { DIMENSIONS, PLATFORM_IDS } from '../../types/scoring';
import type { AtsProfile, PlatformId } from '../../types/scoring';
import { SECTION_TYPES } from '../../types/parser';
import { greenhouse } from './greenhouse';
import { icims } from './icims';
import { lever } from './lever';
import { successfactors } from './successfactors';
import { taleo } from './taleo';
import { workday } from './workday';

/**
 * The single source of truth for weights, strictness, thresholds, required sections and
 * quirks.
 *
 * Consumed by the deterministic scorer, the LLM prompt builder and the UI. PRD §7.9 and
 * §8.2 disagreed about Taleo's and Greenhouse's pass thresholds because the prompt restated
 * them as prose; generating that prose from this registry makes the drift impossible
 * (ADR 0001 §3).
 */
export const PROFILES: Readonly<Record<PlatformId, AtsProfile>> = {
	workday,
	taleo,
	icims,
	greenhouse,
	lever,
	successfactors
};

/** Stable display order. */
export const ALL_PROFILES: readonly AtsProfile[] = PLATFORM_IDS.map((id) => PROFILES[id]);

export function getProfile(id: PlatformId): AtsProfile {
	return PROFILES[id];
}

const WEIGHT_SUM_TOLERANCE = 1e-9;
const VALID_SECTIONS = new Set<string>(SECTION_TYPES);

/**
 * Registry invariants. Run as a test, and in dev builds at module load — a mistyped weight
 * is the most likely data error here and it silently skews every score otherwise.
 */
export function validateProfiles(): string[] {
	const errors: string[] = [];
	const seenQuirkIds = new Set<string>();

	for (const id of PLATFORM_IDS) {
		const profile = PROFILES[id];

		if (profile.id !== id) {
			errors.push(`${id}: registry key does not match profile.id ('${profile.id}')`);
		}

		const sum = DIMENSIONS.reduce((acc, d) => acc + profile.weights[d], 0);
		if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
			errors.push(`${id}: weights sum to ${String(sum)}, expected 1.0`);
		}

		for (const d of DIMENSIONS) {
			if (profile.weights[d] < 0) errors.push(`${id}: negative weight for '${d}'`);
		}

		if (profile.parsingStrictness < 0 || profile.parsingStrictness > 1) {
			errors.push(`${id}: parsingStrictness ${String(profile.parsingStrictness)} outside 0–1`);
		}

		if (profile.passingScore < 1 || profile.passingScore > 99) {
			errors.push(`${id}: passingScore ${String(profile.passingScore)} outside 1–99`);
		}

		for (const section of profile.requiredSections) {
			if (!VALID_SECTIONS.has(section)) {
				errors.push(`${id}: unknown required section '${section}'`);
			}
		}

		for (const quirk of profile.quirks) {
			if (!quirk.id.startsWith(`${id}.`)) {
				errors.push(`${id}: quirk id '${quirk.id}' must be prefixed with '${id}.'`);
			}
			if (seenQuirkIds.has(quirk.id)) {
				errors.push(`duplicate quirk id '${quirk.id}'`);
			}
			seenQuirkIds.add(quirk.id);
		}
	}

	return errors;
}
