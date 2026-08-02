import type { ScoreResult } from '$engine/types/scoring';

/**
 * Scan history persistence.
 *
 * An interface with one implementation today. Firebase mode is deferred, but keeping the
 * boundary means adding it is a new file plus one line of selection rather than a change to
 * every caller — and the store never branches on auth mode.
 */

export interface ScanHistoryEntry {
	id: string;
	/** ISO 8601. */
	timestamp: string;
	mode: 'general' | 'targeted';
	averageScore: number;
	passingCount: number;
	results: ScoreResult[];
	fileName?: string;
	/** First 200 characters, enough to recognise which posting this was. */
	jobDescriptionSnippet?: string;
}

export interface HistoryStorage {
	list(): Promise<ScanHistoryEntry[]>;
	save(entry: ScanHistoryEntry): Promise<void>;
	remove(id: string): Promise<void>;
	clear(): Promise<void>;
}

/**
 * PRD §15 caps this at 5. Raised to 20: §2.2 wants a career coach tracking improvement over
 * time and §12.1 draws a `ScoreTimeline`, and five points is not a timeline. localStorage has
 * room for it.
 */
export const MAX_HISTORY_ENTRIES = 20;
