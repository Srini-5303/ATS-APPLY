import { dev } from '$app/environment';
import { log } from '$lib/log';
import { buildCsp } from '$lib/server/csp';
import type { Handle, HandleServerError } from '@sveltejs/kit';

/** PRD §14.1. Applied to every response unless the route already set the header. */
const SECURITY_HEADERS: Record<string, string> = {
	'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy':
		'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
	'X-DNS-Prefetch-Control': 'on',
	'X-Permitted-Cross-Domain-Policies': 'none'
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();

	const response = await resolve(event);

	for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(header)) response.headers.set(header, value);
	}

	// The /api/og exemption that used to live here went with the share feature. Nothing is
	// meant to be embeddable cross-origin any more, so the policy applies everywhere.
	if (!response.headers.has('Cross-Origin-Resource-Policy')) {
		response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	}

	// Only on documents: a CSP on a JSON response does nothing but add bytes.
	if (response.headers.get('content-type')?.includes('text/html')) {
		// Report-only in development so a new violation does not break local work; enforced in
		// production, which is the point of having a policy at all (ADR 0001, §14.2 note).
		const csp = buildCsp({ enforce: !dev, reportUri: '/api/csp-report' });
		if (!response.headers.has(csp.header)) response.headers.set(csp.header, csp.value);
	}

	return response;
};

export const handleServerError: HandleServerError = ({ error, event, status, message }) => {
	const requestId = event.locals.requestId;

	log.error('unhandled server error', {
		requestId,
		route: event.route.id,
		status,
		err: error instanceof Error ? error.message : String(error)
	});

	// Never return a stack trace to the client — just an id they can quote.
	return { message, requestId };
};
