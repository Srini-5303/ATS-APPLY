import { log } from '$lib/log';

/**
 * Shared guards for the unauthenticated telemetry endpoints.
 *
 * PRD §9.4 left these with no auth, no size cap, and sampling controlled by a `PUBLIC_*`
 * variable — i.e. by the client, which an attacker simply ignores. That is an open log-flood
 * and log-injection surface. Sampling is decided here, on the server, and every body is
 * capped and rate limited.
 */

/** Well under any log line limit, and far more than a legitimate report needs. */
export const MAX_TELEMETRY_BODY_BYTES = 8 * 1024;

/** Per-instance, per-minute ceiling across all telemetry endpoints combined. */
const MAX_REPORTS_PER_MINUTE = 60;

let windowStart = 0;
let windowCount = 0;

function withinBudget(now: number): boolean {
	if (now - windowStart > 60_000) {
		windowStart = now;
		windowCount = 0;
	}

	windowCount += 1;
	return windowCount <= MAX_REPORTS_PER_MINUTE;
}

export interface TelemetryOutcome {
	accepted: boolean;
	reason?: 'too-large' | 'rate-limited' | 'not-sampled' | 'malformed';
}

/**
 * Reads and validates a telemetry body.
 *
 * Always resolves — a telemetry endpoint must never surface an error to the page, or a
 * reporting failure becomes a second visible failure on top of whatever was being reported.
 */
export async function acceptTelemetry(
	request: Request,
	sampleRate: number,
	now: () => number = Date.now
): Promise<{ outcome: TelemetryOutcome; body: unknown }> {
	if (!withinBudget(now())) {
		return { outcome: { accepted: false, reason: 'rate-limited' }, body: null };
	}

	// Server-side sampling. The client cannot opt itself in.
	if (Math.random() > sampleRate) {
		return { outcome: { accepted: false, reason: 'not-sampled' }, body: null };
	}

	const declared = Number.parseInt(request.headers.get('content-length') ?? '0', 10);
	if (Number.isFinite(declared) && declared > MAX_TELEMETRY_BODY_BYTES) {
		return { outcome: { accepted: false, reason: 'too-large' }, body: null };
	}

	let text: string;
	try {
		text = await request.text();
	} catch {
		return { outcome: { accepted: false, reason: 'malformed' }, body: null };
	}

	// content-length is caller-supplied, so check the real thing too.
	if (text.length > MAX_TELEMETRY_BODY_BYTES) {
		return { outcome: { accepted: false, reason: 'too-large' }, body: null };
	}

	try {
		return { outcome: { accepted: true }, body: JSON.parse(text) };
	} catch {
		return { outcome: { accepted: false, reason: 'malformed' }, body: null };
	}
}

/**
 * Truncates a value for logging.
 *
 * Reports are attacker-controlled strings that end up in a log aggregator, so newlines are
 * stripped — otherwise a crafted message can forge additional log lines.
 */
export function safeField(value: unknown, max = 300): string {
	if (typeof value !== 'string') return '';
	return value.replace(/[\r\n]+/g, ' ').slice(0, max);
}

/** Telemetry is best-effort; a report is never worth a visible error. */
export function telemetryResponse(outcome: TelemetryOutcome, kind: string): Response {
	if (!outcome.accepted && outcome.reason !== 'not-sampled') {
		log.debug('telemetry rejected', { kind, reason: outcome.reason });
	}
	return new Response(null, { status: 204 });
}
