/**
 * Share-link parameters.
 *
 * Every value here is caller-supplied and unverifiable — anyone can craft a link claiming 99.
 * That is acceptable for a vanity share, but it means the values must be clamped before they
 * are rendered (PRD §14.3) and must never influence scoring or be written to history.
 */

export interface ShareParams {
	score: number;
	passing: number;
	delta: number | null;
	targeted: boolean;
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
	const parsed = Number.parseInt(raw ?? '', 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
}

export function parseShareParams(params: URLSearchParams): ShareParams {
	const rawDelta = params.get('d');
	const delta = rawDelta === null ? null : clampInt(rawDelta, -100, 100, 0);

	return {
		score: clampInt(params.get('s'), 0, 100, 0),
		// Cannot exceed the number of platforms, whatever the URL says.
		passing: clampInt(params.get('p'), 0, 6, 0),
		delta,
		targeted: params.get('t') === '1'
	};
}

/** Query string only, so callers can pair it with a resolved route path. */
export function buildShareQuery(params: ShareParams): string {
	const search = new URLSearchParams({
		s: String(Math.round(params.score)),
		p: String(params.passing),
		t: params.targeted ? '1' : '0'
	});

	if (params.delta !== null) search.set('d', String(Math.round(params.delta)));

	return search.toString();
}
