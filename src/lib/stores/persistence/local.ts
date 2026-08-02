import { browser } from '$app/environment';
import { log } from '$lib/log';
import { MAX_HISTORY_ENTRIES, type HistoryStorage, type ScanHistoryEntry } from './types';

/** localStorage-backed history (PRD §15.2). */

const STORAGE_KEY = 'ats_local_scan_history_v1';

function isEntry(value: unknown): value is ScanHistoryEntry {
	if (typeof value !== 'object' || value === null) return false;
	const e = value as Partial<ScanHistoryEntry>;

	return (
		typeof e.id === 'string' &&
		typeof e.timestamp === 'string' &&
		(e.mode === 'general' || e.mode === 'targeted') &&
		typeof e.averageScore === 'number' &&
		Number.isFinite(e.averageScore) &&
		typeof e.passingCount === 'number' &&
		Array.isArray(e.results)
	);
}

export class LocalHistoryStorage implements HistoryStorage {
	private read(): ScanHistoryEntry[] {
		if (!browser) return [];

		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];

			const parsed: unknown = JSON.parse(raw);
			// Another tab, an older build, or a user in devtools could have written anything.
			return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
		} catch (err) {
			log.warn('could not read scan history', {
				err: err instanceof Error ? err.message : String(err)
			});
			return [];
		}
	}

	private write(entries: ScanHistoryEntry[]): void {
		if (!browser) return;

		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
		} catch (err) {
			// Quota exceeded or storage disabled. History is a convenience, not the product,
			// so this degrades rather than fails.
			log.warn('could not save scan history', {
				err: err instanceof Error ? err.message : String(err)
			});
		}
	}

	list(): Promise<ScanHistoryEntry[]> {
		return Promise.resolve(this.read());
	}

	save(entry: ScanHistoryEntry): Promise<void> {
		const next = [entry, ...this.read().filter((e) => e.id !== entry.id)].slice(
			0,
			MAX_HISTORY_ENTRIES
		);
		this.write(next);
		return Promise.resolve();
	}

	remove(id: string): Promise<void> {
		this.write(this.read().filter((e) => e.id !== id));
		return Promise.resolve();
	}

	clear(): Promise<void> {
		this.write([]);
		return Promise.resolve();
	}
}
