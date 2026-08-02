import {
	MAX_REQUESTS_PER_DAY,
	MAX_REQUESTS_PER_MINUTE,
	type RateLimiter,
	type RateLimitVerdict
} from './types';

/** In-memory fixed-window limiter. See types.ts for why this is not sufficient on Edge. */

interface Window {
	count: number;
	resetAt: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Sweep only when the maps get large; sweeping on every request is wasted work. */
const CLEANUP_THRESHOLD = 10_000;
const CLEANUP_INTERVAL_MS = 30_000;

export class MemoryRateLimiter implements RateLimiter {
	private readonly minute = new Map<string, Window>();
	private readonly day = new Map<string, Window>();
	private lastCleanup = 0;

	constructor(
		private readonly maxPerMinute = MAX_REQUESTS_PER_MINUTE,
		private readonly maxPerDay = MAX_REQUESTS_PER_DAY,
		private readonly now: () => number = Date.now
	) {}

	check(key: string): RateLimitVerdict {
		const t = this.now();
		this.maybeCleanup(t);

		const daily = this.windowFor(this.day, key, t, DAY_MS);
		if (daily.count >= this.maxPerDay) {
			return {
				allowed: false,
				retryAfterSec: Math.ceil((daily.resetAt - t) / 1000),
				scope: 'day'
			};
		}

		const perMinute = this.windowFor(this.minute, key, t, MINUTE_MS);
		if (perMinute.count >= this.maxPerMinute) {
			// PRD §9.3 checked the minute window first and returned early on a daily rejection
			// without incrementing either counter — which let a capped caller hammer the
			// endpoint for free. Both windows are evaluated before anything is consumed.
			return {
				allowed: false,
				retryAfterSec: Math.ceil((perMinute.resetAt - t) / 1000),
				scope: 'minute'
			};
		}

		perMinute.count += 1;
		daily.count += 1;

		return { allowed: true, retryAfterSec: 0 };
	}

	stats() {
		return {
			trackedKeys: new Set([...this.minute.keys(), ...this.day.keys()]).size,
			minuteEntries: this.minute.size,
			dayEntries: this.day.size
		};
	}

	private windowFor(map: Map<string, Window>, key: string, t: number, span: number): Window {
		const existing = map.get(key);
		if (existing && existing.resetAt > t) return existing;

		const fresh: Window = { count: 0, resetAt: t + span };
		map.set(key, fresh);
		return fresh;
	}

	private maybeCleanup(t: number): void {
		if (t - this.lastCleanup < CLEANUP_INTERVAL_MS) return;
		if (this.minute.size < CLEANUP_THRESHOLD && this.day.size < CLEANUP_THRESHOLD) return;

		this.lastCleanup = t;
		for (const map of [this.minute, this.day]) {
			for (const [key, window] of map) {
				if (window.resetAt <= t) map.delete(key);
			}
		}
	}
}
