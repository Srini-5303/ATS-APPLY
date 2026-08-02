import { log } from '$lib/log';
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

	// /api/og must be embeddable by social crawlers, so it is exempt (PRD §14.1).
	if (!response.headers.has('Cross-Origin-Resource-Policy') && event.url.pathname !== '/api/og') {
		response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
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
