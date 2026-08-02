import { env } from '$env/dynamic/public';
import { log } from '$lib/log';
import { acceptTelemetry, safeField, telemetryResponse } from '$lib/server/telemetry';
import type { RequestHandler } from './$types';

/** Client error reporting (PRD §9.4). Sampled, capped and rate limited server-side. */

export const config = { runtime: 'edge' };

function sampleRate(): number {
	const parsed = Number.parseFloat(env.PUBLIC_ERROR_SAMPLE_RATE ?? '0.05');
	return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.05;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { outcome, body } = await acceptTelemetry(request, sampleRate());
	if (!outcome.accepted) return telemetryResponse(outcome, 'client-error');

	const report = (body ?? {}) as Record<string, unknown>;

	log.error('client error reported', {
		requestId: locals.requestId,
		message: safeField(report.message, 300),
		// Enough of the stack to locate the fault, not enough to fill a log line.
		stack: safeField(report.stack, 600),
		url: safeField(report.url, 200),
		userAgent: safeField(request.headers.get('user-agent'), 200)
	});

	return telemetryResponse(outcome, 'client-error');
};
