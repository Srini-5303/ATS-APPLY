import { log } from '$lib/log';
import { acceptTelemetry, safeField, telemetryResponse } from '$lib/server/telemetry';
import type { RequestHandler } from './$types';

/**
 * CSP violation reports (PRD §14.2).
 *
 * Sampled at 1.0: these are the signal that tells you whether the policy can be moved from
 * report-only to enforced, so dropping them defeats the purpose. The shared rate limit still
 * caps the volume.
 */

export const config = { runtime: 'edge' };

export const POST: RequestHandler = async ({ request }) => {
	const { outcome, body } = await acceptTelemetry(request, 1);
	if (!outcome.accepted) return telemetryResponse(outcome, 'csp');

	// Browsers send either the legacy `csp-report` envelope or a bare Reporting API object.
	const envelope = (body ?? {}) as { 'csp-report'?: Record<string, unknown> };
	const report = envelope['csp-report'] ?? (body as Record<string, unknown> | null) ?? {};

	log.warn('csp violation', {
		directive: safeField(report['violated-directive'] ?? report.effectiveDirective, 100),
		blockedUri: safeField(report['blocked-uri'] ?? report.blockedURL, 200),
		documentUri: safeField(report['document-uri'] ?? report.documentURL, 200)
	});

	return telemetryResponse(outcome, 'csp');
};
