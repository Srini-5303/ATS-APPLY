/**
 * Error taxonomy. Server routes map `AppError -> Response` in one place; nothing else
 * constructs a raw error response, so the shape stays consistent and stack traces never
 * reach the client.
 */

export type ErrorCode =
	'VALIDATION' | 'PARSE' | 'PROVIDER' | 'RATE_LIMIT' | 'CONFIG' | 'NOT_FOUND' | 'INTERNAL';

export class AppError extends Error {
	readonly code: ErrorCode;
	readonly httpStatus: number;
	readonly retryable: boolean;
	/** Safe to show a user. Never contains internals. */
	readonly publicMessage: string;

	constructor(opts: {
		code: ErrorCode;
		message: string;
		httpStatus: number;
		publicMessage?: string;
		retryable?: boolean;
		cause?: unknown;
	}) {
		super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause });
		this.name = 'AppError';
		this.code = opts.code;
		this.httpStatus = opts.httpStatus;
		this.retryable = opts.retryable ?? false;
		this.publicMessage = opts.publicMessage ?? opts.message;
	}
}

export class ValidationError extends AppError {
	constructor(message: string, cause?: unknown) {
		super({ code: 'VALIDATION', message, httpStatus: 400, cause });
		this.name = 'ValidationError';
	}
}

export class RateLimitError extends AppError {
	readonly retryAfterSec: number;

	constructor(message: string, retryAfterSec: number) {
		super({
			code: 'RATE_LIMIT',
			message,
			httpStatus: 429,
			retryable: true,
			publicMessage: 'Too many requests. Please wait a moment and try again.'
		});
		this.name = 'RateLimitError';
		this.retryAfterSec = retryAfterSec;
	}
}

export class ProviderError extends AppError {
	readonly provider: string;

	constructor(provider: string, message: string, cause?: unknown) {
		super({
			code: 'PROVIDER',
			message,
			httpStatus: 502,
			retryable: true,
			publicMessage: 'Scoring service is temporarily unavailable.',
			cause
		});
		this.name = 'ProviderError';
		this.provider = provider;
	}
}

export class ConfigError extends AppError {
	constructor(message: string) {
		super({
			code: 'CONFIG',
			message,
			httpStatus: 500,
			publicMessage: 'Server is misconfigured.'
		});
		this.name = 'ConfigError';
	}
}

export function isAppError(e: unknown): e is AppError {
	return e instanceof AppError;
}
