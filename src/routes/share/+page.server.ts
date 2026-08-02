import { parseShareParams } from '$lib/share';
import type { PageServerLoad } from './$types';

/**
 * Clamped server-side so the rendered page and the OG image agree, and so an out-of-range
 * value in the URL cannot produce an impossible card (PRD §14.3).
 */
export const load: PageServerLoad = ({ url }) => {
	return { share: parseShareParams(url.searchParams) };
};
