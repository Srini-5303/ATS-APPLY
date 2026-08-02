import { DIMENSIONS, type ScoreResult } from '$engine/types/scoring';

/**
 * Client-side PDF report (PRD §12.2).
 *
 * jsPDF is ~350KB, so it is imported dynamically — the great majority of sessions never
 * export, and paying for it on every page load would be the single largest item in the
 * bundle.
 */

const LABELS: Record<string, string> = {
	formatting: 'Formatting',
	keywordMatch: 'Keywords',
	sections: 'Sections',
	experience: 'Experience',
	education: 'Education',
	quantification: 'Quantification'
};

export interface ReportInput {
	results: ScoreResult[];
	averageScore: number;
	passingCount: number;
	fileName?: string;
	targeted: boolean;
}

export async function exportReport(input: ReportInput): Promise<void> {
	const { jsPDF } = await import('jspdf');
	const doc = new jsPDF({ unit: 'pt', format: 'letter' });

	const margin = 56;
	const width = doc.internal.pageSize.getWidth();
	let y = margin;

	const line = (text: string, size = 11, weight: 'normal' | 'bold' = 'normal', gap = 16) => {
		// A new page before the footer margin, so text never runs off the sheet.
		if (y > doc.internal.pageSize.getHeight() - margin) {
			doc.addPage();
			y = margin;
		}
		doc.setFont('helvetica', weight);
		doc.setFontSize(size);
		doc.text(text, margin, y);
		y += gap;
	};

	line('ATS Screener report', 20, 'bold', 26);
	line(
		`${input.targeted ? 'Targeted scan' : 'General ATS readiness'} · ${new Date().toLocaleDateString()}`,
		10,
		'normal',
		14
	);
	if (input.fileName) line(input.fileName, 10, 'normal', 22);
	else y += 8;

	line(
		`Average ${String(input.averageScore)} / 100 · ${String(input.passingCount)} of 6 platforms likely to pass`,
		12,
		'bold',
		24
	);

	for (const result of input.results) {
		line(
			`${result.system} — ${String(result.overallScore)}/100 (${result.passesFilter ? 'likely to pass' : 'may be filtered'})`,
			13,
			'bold',
			18
		);

		const dims = DIMENSIONS.map(
			(d) => `${LABELS[d] ?? d} ${String(result.breakdown[d].score)}`
		).join('   ');
		line(dims, 9, 'normal', 14);

		for (const issue of result.breakdown.formatting.issues.slice(0, 3)) {
			line(`  • ${issue}`, 9, 'normal', 12);
		}

		y += 8;
	}

	const suggestions = dedupeSuggestions(input.results);
	if (suggestions.length > 0) {
		line('What to fix first', 14, 'bold', 20);

		for (const suggestion of suggestions) {
			line(`[${suggestion.impact}] ${suggestion.summary}`, 10, 'bold', 14);
			for (const detail of suggestion.details.slice(0, 2)) {
				// Wrap manually: jsPDF does not reflow.
				for (const wrapped of doc.splitTextToSize(detail, width - margin * 2) as string[]) {
					line(`  ${wrapped}`, 9, 'normal', 12);
				}
			}
			y += 6;
		}
	}

	doc.save(`ats-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function dedupeSuggestions(results: ScoreResult[]) {
	const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
	const merged = new Map<
		string,
		{ summary: string; details: string[]; impact: keyof typeof order }
	>();

	for (const result of results) {
		for (const s of result.suggestions) {
			if (!merged.has(s.summary)) {
				merged.set(s.summary, { summary: s.summary, details: s.details, impact: s.impact });
			}
		}
	}

	return [...merged.values()].sort((a, b) => order[a.impact] - order[b.impact]).slice(0, 8);
}
