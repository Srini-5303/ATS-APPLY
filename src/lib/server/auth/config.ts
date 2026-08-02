import { env } from '$env/dynamic/public';

/**
 * Auth modes are mutually exclusive and resolved server-side (PRD §4.3), then passed to the
 * client via layout data so the client never has to discover its own mode — that would cause
 * hydration mismatches.
 *
 * Firebase is deferred; the current build target is anonymous. The seam stays here so
 * enabling Firebase is a config change rather than a refactor.
 */
export type AuthMode = 'firebase' | 'none';

export function resolveAuthMode(): AuthMode {
	return env.PUBLIC_FIREBASE_PROJECT_ID ? 'firebase' : 'none';
}
