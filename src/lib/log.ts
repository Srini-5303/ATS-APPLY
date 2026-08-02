// This module is the single sanctioned console boundary (PRD §18.4); eslint.config.js
// grants it the sole `no-console` exemption.

/**
 * Structured logger. Single-line JSON on the server so Vercel log drains can parse it,
 * grouped console output in the browser.
 *
 * Built now rather than later because retrofitting a logger means touching every file.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Keys whose values are redacted wherever they appear. Resume text and contact details must
 * never reach a log sink, even at debug — the product's headline claim is that resumes stay
 * private.
 */
const REDACTED_KEYS = new Set([
	'resumetext',
	'rawtext',
	'jobdescription',
	'email',
	'phone',
	'name',
	'linkedin',
	'github',
	'authorization',
	'cookie',
	'apikey',
	'api_key',
	'token',
	'password'
]);

const MAX_DEPTH = 4;

function redact(value: unknown, depth = 0): unknown {
	if (depth > MAX_DEPTH) return '[depth-limit]';
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
		out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(val, depth + 1);
	}
	return out;
}

function resolveMinLevel(): LogLevel {
	const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
		?.env?.LOG_LEVEL;
	return raw && raw in LEVEL_ORDER ? (raw as LogLevel) : 'info';
}

const MIN_LEVEL = resolveMinLevel();
const IS_BROWSER = typeof window !== 'undefined';

export interface Logger {
	debug(msg: string, ctx?: Record<string, unknown>): void;
	info(msg: string, ctx?: Record<string, unknown>): void;
	warn(msg: string, ctx?: Record<string, unknown>): void;
	error(msg: string, ctx?: Record<string, unknown>): void;
	/** Returns a logger that merges `bound` into every subsequent call's context. */
	child(bound: Record<string, unknown>): Logger;
}

function emit(
	level: LogLevel,
	bound: Record<string, unknown>,
	msg: string,
	ctx?: Record<string, unknown>
): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

	const payload = redact({ ...bound, ...ctx }) as Record<string, unknown>;

	if (IS_BROWSER) {
		const fn =
			level === 'debug'
				? console.debug
				: level === 'info'
					? console.info
					: level === 'warn'
						? console.warn
						: console.error;
		fn(`[${level}] ${msg}`, payload);
		return;
	}

	console[level === 'debug' ? 'log' : level](
		JSON.stringify({ level, msg, time: new Date().toISOString(), ...payload })
	);
}

function make(bound: Record<string, unknown>): Logger {
	return {
		debug: (msg, ctx) => {
			emit('debug', bound, msg, ctx);
		},
		info: (msg, ctx) => {
			emit('info', bound, msg, ctx);
		},
		warn: (msg, ctx) => {
			emit('warn', bound, msg, ctx);
		},
		error: (msg, ctx) => {
			emit('error', bound, msg, ctx);
		},
		child: (extra) => make({ ...bound, ...extra })
	};
}

export const log: Logger = make({});
