import { browser } from '$app/environment';
import { log } from '$lib/log';

/** Saved job descriptions (PRD §11.5). */

const STORAGE_KEY = 'ats_jd_library_v1';

/** Guards against a single paste filling the origin's storage quota. */
const MAX_CONTENT_CHARS = 20_000;
const MAX_ENTRIES = 50;

export interface JDLibraryEntry {
	id: string;
	label: string;
	content: string;
	savedAt: number;
}

function isEntry(value: unknown): value is JDLibraryEntry {
	if (typeof value !== 'object' || value === null) return false;
	const e = value as Partial<JDLibraryEntry>;
	return (
		typeof e.id === 'string' &&
		typeof e.label === 'string' &&
		typeof e.content === 'string' &&
		typeof e.savedAt === 'number'
	);
}

class JDLibraryStore {
	entries = $state<JDLibraryEntry[]>([]);

	/**
	 * Reads from localStorage. Called on mount rather than in the constructor because the
	 * store module is imported during SSR, where localStorage does not exist.
	 */
	load(): void {
		if (!browser) return;

		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;

			const parsed: unknown = JSON.parse(raw);
			// Anything could be in localStorage — another tab, an older build, a user editing
			// devtools. Validate rather than trust.
			this.entries = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
		} catch (err) {
			log.warn('could not read the saved job descriptions', {
				err: err instanceof Error ? err.message : String(err)
			});
			this.entries = [];
		}
	}

	private persist(): void {
		if (!browser) return;

		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
		} catch (err) {
			// Quota exceeded, or storage disabled in private mode. The in-memory list still
			// works for this session, so this is a warning rather than a failure.
			log.warn('could not save the job description library', {
				err: err instanceof Error ? err.message : String(err)
			});
		}
	}

	save(label: string, content: string): JDLibraryEntry | null {
		const trimmedLabel = label.trim();
		const trimmedContent = content.trim();
		if (trimmedLabel === '' || trimmedContent === '') return null;

		const entry: JDLibraryEntry = {
			id: crypto.randomUUID(),
			label: trimmedLabel.slice(0, 80),
			content: trimmedContent.slice(0, MAX_CONTENT_CHARS),
			savedAt: Date.now()
		};

		this.entries = [entry, ...this.entries].slice(0, MAX_ENTRIES);
		this.persist();
		return entry;
	}

	remove(id: string): void {
		this.entries = this.entries.filter((e) => e.id !== id);
		this.persist();
	}

	clear(): void {
		this.entries = [];
		this.persist();
	}
}

export const jdLibraryStore = new JDLibraryStore();
