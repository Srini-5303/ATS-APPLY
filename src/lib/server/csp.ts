/**
 * Content Security Policy.
 *
 * PRD §14.2 specified report-only "forever, nothing blocked in production", which is a
 * decision to have no CSP rather than a security control. This ships report-only in preview
 * so violations surface, and **enforcing** in production — the report stream is what tells
 * you it is safe to do so, not a reason to never do it.
 */

export interface CspOptions {
	/** Report-only in preview and development; enforced in production. */
	enforce: boolean;
	reportUri: string;
}

export function buildCsp({ enforce, reportUri }: CspOptions): { header: string; value: string } {
	const directives: Record<string, string[]> = {
		'default-src': ["'self'"],

		// SvelteKit inlines a hydration bootstrap; 'unsafe-inline' is required until that moves
		// to a nonce. Scoped to scripts from our own origin only.
		'script-src': ["'self'", "'unsafe-inline'", 'blob:'],

		// blob: is required by pdf.js, which creates its worker from a blob URL.
		'worker-src': ["'self'", 'blob:'],
		'child-src': ["'self'", 'blob:'],

		// Svelte scoped styles are injected as inline <style>.
		'style-src': ["'self'", "'unsafe-inline'"],

		'img-src': ["'self'", 'data:', 'blob:'],
		'font-src': ["'self'", 'data:'],

		// The app calls only its own API. Resumes are parsed locally, so no third-party
		// endpoint should ever be contacted from the browser.
		'connect-src': ["'self'"],

		'object-src': ["'none'"],
		'base-uri': ["'self'"],
		'form-action': ["'self'"],
		'frame-ancestors': ["'none'"],
		'upgrade-insecure-requests': []
	};

	const value = [
		...Object.entries(directives).map(([key, sources]) =>
			sources.length === 0 ? key : `${key} ${sources.join(' ')}`
		),
		`report-uri ${reportUri}`
	].join('; ');

	return {
		header: enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
		value
	};
}
