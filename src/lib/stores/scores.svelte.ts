import type { ParsedResume } from '$engine/types/parser';
import type { Impact, ScoreResult } from '$engine/types/scoring';
import { refineScores } from '$engine/llm/client';
import { scoreResume } from '$engine/scorer';
import { toScoringInput } from '$engine/scorer/to-scoring-input';
import { log } from '$lib/log';
import { LocalHistoryStorage } from './persistence/local';
import type { HistoryStorage, ScanHistoryEntry } from './persistence/types';

export type ScoreStatus = 'idle' | 'scoring' | 'done';

class ScoresStore {
	results = $state<ScoreResult[]>([]);
	status = $state<ScoreStatus>('idle');
	jobDescription = $state('');

	/**
	 * True while the LLM refinement is in flight. The deterministic scores are already on
	 * screen at that point — the LLM adjusts them rather than replacing them, so there is
	 * never an empty results state (ADR 0001 §2).
	 */
	refining = $state(false);

	/** Which engine produced what is currently displayed. */
	provider = $state<string | null>(null);
	/** True when refinement was attempted and did not land. */
	refinementUnavailable = $state(false);
	/** Absolute epoch ms at which a rate-limited caller may retry. */
	retryAtMs = $state<number | null>(null);

	/**
	 * Per-platform scores as the rules left them, before any refinement.
	 *
	 * Kept so the UI can show what the AI actually changed. Without it the two stages are
	 * indistinguishable on screen: numbers appear, numbers quietly differ, and nothing tells
	 * the reader a second pass happened at all.
	 */
	ruleBasedScores = $state<Record<string, number>>({});
	/** How long the refinement round trip took, once it has finished. */
	refineMs = $state<number | null>(null);

	/** How many platforms the refinement moved. Zero is a valid, meaningful answer. */
	get adjustedCount(): number {
		return this.results.filter((r) => this.adjustmentFor(r.platformId) !== null).length;
	}

	/** Signed change the refinement made to one platform, or null if it left it alone. */
	adjustmentFor(platformId: string): number | null {
		const before = this.ruleBasedScores[platformId];
		const after = this.results.find((r) => r.platformId === platformId)?.overallScore;
		if (before === undefined || after === undefined || before === after) return null;
		return after - before;
	}

	/** Past scans, newest first. */
	history = $state<ScanHistoryEntry[]>([]);

	/**
	 * The scan the current results are compared against.
	 *
	 * PRD §11.2 snapshotted this from the in-memory results inside `startScoring()`, so on a
	 * fresh page load there was nothing to snapshot and the first scan of every session showed
	 * no delta even when history existed. Seeded from storage instead.
	 */
	previousScan = $state<ScanHistoryEntry | null>(null);

	/** True while viewing a stored scan rather than a live one. */
	viewingHistory = $state(false);

	private controller: AbortController | null = null;
	private storage: HistoryStorage = new LocalHistoryStorage();

	get hasResults(): boolean {
		return this.results.length > 0;
	}

	get averageScore(): number {
		if (this.results.length === 0) return 0;
		const total = this.results.reduce((sum, r) => sum + r.overallScore, 0);
		return Math.round(total / this.results.length);
	}

	get passingCount(): number {
		return this.results.filter((r) => r.passesFilter).length;
	}

	get spread(): number {
		if (this.results.length === 0) return 0;
		const scores = this.results.map((r) => r.overallScore);
		return Math.max(...scores) - Math.min(...scores);
	}

	/**
	 * Deduplicated across platforms, most severe first. The same advice usually applies to
	 * several platforms, so it is merged into one row listing them all.
	 */
	get topSuggestions(): { summary: string; impact: Impact; platforms: string[] }[] {
		const order: Record<Impact, number> = { critical: 0, high: 1, medium: 2, low: 3 };
		// A plain array rather than a Map: this is a derived local, not reactive state, and
		// the list is short enough that a linear lookup is irrelevant.
		const merged: { summary: string; impact: Impact; platforms: string[] }[] = [];

		for (const result of this.results) {
			for (const suggestion of result.suggestions) {
				const existing = merged.find((m) => m.summary === suggestion.summary);
				if (existing) {
					for (const p of suggestion.platforms) {
						if (!existing.platforms.includes(p)) existing.platforms.push(p);
					}
				} else {
					merged.push({
						summary: suggestion.summary,
						impact: suggestion.impact,
						platforms: [...suggestion.platforms]
					});
				}
			}
		}

		return merged.sort((a, b) => order[a.impact] - order[b.impact]).slice(0, 3);
	}

	/**
	 * Scores synchronously in the browser. The engine is pure TypeScript, so this needs no
	 * server and completes in well under 100 ms — the user sees results immediately rather
	 * than watching a spinner (ADR 0001 §2).
	 */
	score(resume: ParsedResume, fileName?: string): void {
		this.cancelRefinement();

		// Snapshot before overwriting, falling back to the most recent stored scan so the very
		// first scan of a session still shows a delta.
		this.previousScan = this.currentAsEntry() ?? this.history[0] ?? null;

		this.status = 'scoring';
		this.results = scoreResume(toScoringInput(resume, this.jobDescription));
		this.status = 'done';
		this.provider = 'rule-based';
		this.refinementUnavailable = false;
		this.retryAtMs = null;
		this.refineMs = null;
		this.viewingHistory = false;

		// Snapshot before refinement can touch anything, so the UI can name the difference.
		this.ruleBasedScores = Object.fromEntries(
			this.results.map((r) => [r.platformId, r.overallScore])
		);

		void this.persist(fileName);
	}

	/** Score change against the previous scan, or null when there is nothing to compare. */
	get scoreDelta(): number | null {
		if (!this.previousScan || this.results.length === 0) return null;
		const delta = this.averageScore - this.previousScan.averageScore;
		return delta === 0 ? null : delta;
	}

	async loadHistory(): Promise<void> {
		this.history = await this.storage.list();
		this.previousScan ??= this.history[0] ?? null;
	}

	/** Displays a stored scan without touching the live parse. */
	view(entry: ScanHistoryEntry): void {
		this.cancelRefinement();
		this.results = entry.results;
		this.status = 'done';
		this.provider = 'rule-based';
		this.viewingHistory = true;
	}

	async removeFromHistory(id: string): Promise<void> {
		await this.storage.remove(id);
		await this.loadHistory();
	}

	async clearHistory(): Promise<void> {
		await this.storage.clear();
		this.history = [];
		this.previousScan = null;
	}

	private currentAsEntry(fileName?: string): ScanHistoryEntry | null {
		if (this.results.length === 0) return null;

		const snippet = this.jobDescription.trim().slice(0, 200);

		return {
			id: crypto.randomUUID(),
			timestamp: new Date().toISOString(),
			mode: snippet === '' ? 'general' : 'targeted',
			averageScore: this.averageScore,
			passingCount: this.passingCount,
			results: this.results,
			...(fileName === undefined ? {} : { fileName }),
			...(snippet === '' ? {} : { jobDescriptionSnippet: snippet })
		};
	}

	private async persist(fileName?: string): Promise<void> {
		const entry = this.currentAsEntry(fileName);
		if (!entry) return;

		await this.storage.save(entry);
		await this.loadHistory();
	}

	/**
	 * Asks the server to refine what is already displayed.
	 *
	 * Deliberately fire-and-forget from the caller's perspective: every failure path leaves
	 * the deterministic scores in place, so there is nothing for the UI to handle beyond an
	 * indicator.
	 */
	async refine(resume: ParsedResume): Promise<void> {
		if (this.results.length === 0 || this.refining) return;

		this.cancelRefinement();
		this.controller = new AbortController();
		this.refining = true;
		this.refineMs = null;
		const startedAt = Date.now();

		try {
			const outcome = await refineScores({
				resumeText: resume.rawText,
				...(this.jobDescription.trim() === '' ? {} : { jobDescription: this.jobDescription }),
				baseline: this.results,
				signal: this.controller.signal
			});

			switch (outcome.status) {
				case 'ok':
					// Ignore a stale response if the user re-scored while this was in flight.
					if (this.controller.signal.aborted) return;
					this.results = outcome.results;
					this.provider = outcome.provider;
					this.refinementUnavailable = outcome.fallback;
					break;

				case 'rate_limited':
					this.retryAtMs = Date.now() + outcome.retryAfterSec * 1000;
					this.refinementUnavailable = true;
					break;

				case 'error':
					this.refinementUnavailable = true;
					break;

				case 'cancelled':
					break;
			}

			log.info('refinement finished', { outcome: outcome.status });
		} finally {
			this.refining = false;
			this.refineMs = Date.now() - startedAt;
		}
	}

	cancelRefinement(): void {
		this.controller?.abort();
		this.controller = null;
		this.refining = false;
	}

	reset(): void {
		this.cancelRefinement();
		this.results = [];
		this.status = 'idle';
		this.provider = null;
		this.refinementUnavailable = false;
		this.retryAtMs = null;
		this.refineMs = null;
		this.ruleBasedScores = {};
		this.viewingHistory = false;
		// History and previousScan deliberately survive: "scan another" starts a new scan, it
		// does not erase what came before.
	}
}

export const scoresStore = new ScoresStore();
