import { ValidationError } from '$lib/errors';
import type { ScoreResult } from '$engine/types/scoring';
import { PLATFORM_IDS } from '$engine/types/scoring';

/**
 * Request validation at the trust boundary (PRD §14.3).
 *
 * Hand-rolled rather than pulling in a schema library: the surface is four fields, this runs
 * on Edge where bundle size is charged per invocation, and every rule here is one the caller
 * needs a specific message for.
 */

export const MAX_RESUME_CHARS = 50_000;
export const MAX_JD_CHARS = 20_000;

export interface AnalyzeRequest {
	resumeText: string;
	jobDescription?: string;
	baseline: ScoreResult[];
}

const PLATFORM_SET = new Set<string>(PLATFORM_IDS);

/**
 * The baseline is only used as an anchor, so it is validated for shape rather than trusted:
 * a caller could otherwise send 500 fabricated entries and have them echoed back.
 */
function validateBaseline(value: unknown): ScoreResult[] {
	if (!Array.isArray(value)) throw new ValidationError('baseline must be an array');
	if (value.length !== PLATFORM_IDS.length) {
		throw new ValidationError(`baseline must contain ${String(PLATFORM_IDS.length)} results`);
	}

	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null) {
			throw new ValidationError('baseline entries must be objects');
		}

		const r = entry as Partial<ScoreResult>;

		if (typeof r.platformId !== 'string' || !PLATFORM_SET.has(r.platformId)) {
			throw new ValidationError('baseline contains an unknown platform');
		}
		if (typeof r.overallScore !== 'number' || !Number.isFinite(r.overallScore)) {
			throw new ValidationError('baseline scores must be finite numbers');
		}
		if (r.overallScore < 0 || r.overallScore > 100) {
			throw new ValidationError('baseline scores must be between 0 and 100');
		}
		if (typeof r.breakdown !== 'object' || r.breakdown === null) {
			throw new ValidationError('baseline entries must include a breakdown');
		}
	}

	return value as ScoreResult[];
}

export function validateAnalyzeRequest(body: unknown): AnalyzeRequest {
	if (typeof body !== 'object' || body === null) {
		throw new ValidationError('request body must be a JSON object');
	}

	const b = body as Record<string, unknown>;

	if (typeof b.resumeText !== 'string' || b.resumeText.trim() === '') {
		throw new ValidationError('resumeText is required');
	}
	if (b.resumeText.length > MAX_RESUME_CHARS) {
		throw new ValidationError(`resumeText exceeds ${String(MAX_RESUME_CHARS)} characters`);
	}

	if (b.jobDescription !== undefined && typeof b.jobDescription !== 'string') {
		throw new ValidationError('jobDescription must be a string');
	}
	if (typeof b.jobDescription === 'string' && b.jobDescription.length > MAX_JD_CHARS) {
		throw new ValidationError(`jobDescription exceeds ${String(MAX_JD_CHARS)} characters`);
	}

	const baseline = validateBaseline(b.baseline);
	const jobDescription = typeof b.jobDescription === 'string' ? b.jobDescription.trim() : '';

	return jobDescription === ''
		? { resumeText: b.resumeText, baseline }
		: { resumeText: b.resumeText, jobDescription, baseline };
}

/**
 * Client IP for rate limiting.
 *
 * Only the first hop of x-forwarded-for is trusted; the rest of the chain is caller-supplied
 * and trivially spoofed to bypass a per-IP limit.
 */
export function clientKey(request: Request, fallback: string): string {
	const forwarded = request.headers.get('x-forwarded-for');
	const first = forwarded?.split(',')[0]?.trim();
	return first && first !== '' ? first : fallback;
}
