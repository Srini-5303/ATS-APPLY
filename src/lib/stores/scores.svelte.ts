import type { ParsedResume } from '$engine/types/parser';
import type { Impact, ScoreResult } from '$engine/types/scoring';
import { scoreResume } from '$engine/scorer';
import { toScoringInput } from '$engine/scorer/to-scoring-input';

export type ScoreStatus = 'idle' | 'scoring' | 'done';

class ScoresStore {
	results = $state<ScoreResult[]>([]);
	status = $state<ScoreStatus>('idle');
	jobDescription = $state('');

	/**
	 * True while the LLM refinement is in flight. The deterministic scores are already on
	 * screen at that point — the LLM adjusts them rather than replacing them, so there is
	 * never an empty results state (ADR 0001 §2). Wired up in Phase 5.
	 */
	refining = $state(false);

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
	score(resume: ParsedResume): void {
		this.status = 'scoring';
		this.results = scoreResume(toScoringInput(resume, this.jobDescription));
		this.status = 'done';
	}

	reset(): void {
		this.results = [];
		this.status = 'idle';
		this.refining = false;
	}
}

export const scoresStore = new ScoresStore();
