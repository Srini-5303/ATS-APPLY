import { resolveAuthMode } from '$lib/server/auth/config';
import type { LayoutServerLoad } from './$types';

// Resolved server-side and handed to the client (PRD §4.3) so the client never has to
// discover its own auth mode, which would produce hydration mismatches.
export const load: LayoutServerLoad = () => {
	return { authMode: resolveAuthMode() };
};
