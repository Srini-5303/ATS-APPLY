import { PROFILES } from '$engine/scorer/profiles';
import { DIMENSIONS, type Impact, type ScoreResult, type Suggestion } from '$engine/types/scoring';
import { dimensionEvidence, labelFor, STRONG_SCORE } from './evidence';

/**
 * Client-side PDF report.
 *
 * jsPDF is ~350KB and most sessions never export, so it is imported dynamically.
 *
 * Deliberately printed dark-on-white rather than in the app's dark theme: this is a document
 * people forward and print, and a full-bleed dark background is unreadable on paper and
 * wastes toner.
 */

/** A score this far below a platform's threshold is borderline rather than a clean fail. */
const MARGINAL_BAND = 8;

/**
 * Evidence lines printed per dimension in the detail section.
 *
 * The screen can scroll; six platforms times six dimensions times an uncapped list of quoted
 * bullets cannot. Four keeps each block to a few lines while still carrying the counts and the
 * first examples.
 */
const EVIDENCE_LINES = 4;

type Status = 'PASS' | 'MARGINAL' | 'FAIL';

const INK = { text: 17, muted: 110, rule: 205, head: 245 } as const;
const TONE: Record<Status, [number, number, number]> = {
	PASS: [22, 128, 82],
	MARGINAL: [176, 122, 12],
	FAIL: [190, 52, 52]
};

const DIMENSION_HEADS: Record<string, string> = {
	formatting: 'FORMAT',
	keywordMatch: 'KEYWORDS',
	sections: 'SECTIONS',
	experience: 'EXPER',
	education: 'EDUC',
	quantification: 'QUANT'
};

export interface ReportInput {
	results: ScoreResult[];
	averageScore: number;
	passingCount: number;
	candidateName?: string;
	fileName?: string;
	targeted: boolean;
}

function statusOf(result: ScoreResult, threshold: number): Status {
	if (result.passesFilter) return 'PASS';
	return result.overallScore >= threshold - MARGINAL_BAND ? 'MARGINAL' : 'FAIL';
}

function band(score: number): string {
	if (score >= 85) return 'Excellent';
	if (score >= 70) return 'Good';
	if (score >= 55) return 'Fair';
	if (score >= 40) return 'Weak';
	return 'Poor';
}

/**
 * Formatting issues collapsed across platforms.
 *
 * Every platform sees the same document, so listing "Heavy use of all-caps text" once per
 * card printed the same sentence six times and buried everything else.
 */
function uniqueIssues(results: ScoreResult[]): { issue: string; platforms: string[] }[] {
	const byIssue = new Map<string, string[]>();

	for (const result of results) {
		for (const issue of result.breakdown.formatting.issues) {
			const platforms = byIssue.get(issue) ?? [];
			platforms.push(result.system);
			byIssue.set(issue, platforms);
		}
	}

	return [...byIssue].map(([issue, platforms]) => ({ issue, platforms }));
}

/**
 * Keyword coverage aggregated across platforms.
 *
 * A term counts as found if any platform matched it, and as missing only if none did — the
 * strict and lenient matchers disagree by design, so a per-platform list would contradict
 * itself.
 */
function keywordCoverage(results: ScoreResult[]): { matched: string[]; missing: string[] } {
	const matched = new Set<string>();
	const seen = new Set<string>();

	for (const result of results) {
		for (const term of result.breakdown.keywordMatch.matched) {
			matched.add(term);
			seen.add(term);
		}
		for (const term of result.breakdown.keywordMatch.missing) seen.add(term);
	}

	return {
		matched: [...matched].sort(),
		missing: [...seen].filter((t) => !matched.has(t)).sort()
	};
}

const IMPACT_ORDER: Record<Impact, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function rankedSuggestions(results: ScoreResult[]) {
	const merged = new Map<
		string,
		{ summary: string; detail: string; impact: Impact; platforms: string[] }
	>();

	for (const result of results) {
		for (const s of result.suggestions) {
			const existing = merged.get(s.summary);
			if (existing) {
				if (!existing.platforms.includes(result.system)) existing.platforms.push(result.system);
				continue;
			}
			merged.set(s.summary, {
				summary: s.summary,
				detail: s.details[0] ?? '',
				impact: s.impact,
				platforms: [result.system]
			});
		}
	}

	return [...merged.values()]
		.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact])
		.slice(0, 8);
}

export async function exportReport(input: ReportInput): Promise<void> {
	const { jsPDF } = await import('jspdf');
	const doc = new jsPDF({ unit: 'pt', format: 'letter' });

	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const margin = 48;
	const right = pageWidth - margin;
	const width = right - margin;

	let y = margin;

	const gray = (level: number) => {
		doc.setTextColor(level);
	};

	/** Starts a new page when the next block would not fit. */
	const ensure = (needed: number) => {
		if (y + needed <= pageHeight - margin - 24) return;
		doc.addPage();
		y = margin;
	};

	const text = (value: string, size: number, weight: 'normal' | 'bold' = 'normal', x = margin) => {
		doc.setFont('helvetica', weight);
		doc.setFontSize(size);
		doc.text(value, x, y);
	};

	const paragraph = (value: string, size = 9, leading = 12) => {
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(size);
		for (const line of doc.splitTextToSize(value, width) as string[]) {
			ensure(leading);
			doc.text(line, margin, y);
			y += leading;
		}
	};

	const rule = () => {
		doc.setDrawColor(INK.rule);
		doc.setLineWidth(0.5);
		doc.line(margin, y, right, y);
	};

	const heading = (value: string) => {
		ensure(40);
		y += 12;
		gray(INK.text);
		text(value, 12, 'bold');
		y += 6;
		rule();
		y += 14;
	};

	// ── Header ────────────────────────────────────────────────────────────────
	gray(INK.muted);
	text(input.targeted ? 'TARGETED SCAN' : 'GENERAL READINESS', 8, 'bold');
	y += 18;

	gray(INK.text);
	text('ATS Compatibility Report', 22, 'bold');
	y += 26;

	rule();
	y += 16;

	// Metadata row: three labelled columns.
	const columns: [string, string][] = [
		['PREPARED FOR', input.candidateName ?? input.fileName ?? 'Candidate'],
		['DATE OF ANALYSIS', new Date().toLocaleDateString(undefined, { dateStyle: 'long' })],
		['OVERALL SCORE', `${String(input.averageScore)}/100`]
	];

	const columnWidth = width / columns.length;
	for (const [index, [label, value]] of columns.entries()) {
		const x = margin + index * columnWidth;
		gray(INK.muted);
		text(label, 7, 'bold', x);
		gray(INK.text);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(12);
		doc.text(value, x, y + 15);
	}
	y += 34;
	rule();
	y += 4;

	// ── Executive summary ─────────────────────────────────────────────────────
	heading('EXECUTIVE SUMMARY');
	gray(INK.text);

	const weakest = [...input.results].sort((a, b) => a.overallScore - b.overallScore)[0];
	paragraph(
		`This resume was analysed against 6 enterprise ATS platforms. ` +
			`${String(input.passingCount)} of 6 returned a passing score. The average compatibility ` +
			`rating is ${String(input.averageScore)}/100, classified as ${band(input.averageScore)}. ` +
			(weakest
				? `${weakest.system} scores lowest at ${String(weakest.overallScore)}/100, so the ` +
					`recommendations below are ordered by the impact they would have there first.`
				: '')
	);
	y += 4;

	// ── 1. Platform table ─────────────────────────────────────────────────────
	heading('1. PLATFORM COMPATIBILITY SCORES');

	const cols = [
		{ head: 'PLATFORM', w: 96, align: 'left' as const },
		{ head: 'OVERALL', w: 52, align: 'right' as const },
		...DIMENSIONS.map((d) => ({ head: DIMENSION_HEADS[d] ?? d, w: 52, align: 'right' as const })),
		{ head: 'STATUS', w: 60, align: 'right' as const }
	];

	const totalW = cols.reduce((sum, c) => sum + c.w, 0);
	const scale = width / totalW;

	const drawRow = (
		cells: string[],
		opts: { bold?: boolean; size?: number; tone?: [number, number, number] } = {}
	) => {
		let x = margin;
		doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
		doc.setFontSize(opts.size ?? 8);

		for (const [i, cell] of cells.entries()) {
			const col = cols[i];
			if (!col) continue;
			const w = col.w * scale;

			// Only the status cell is coloured; a fully coloured row is noise.
			if (opts.tone && i === cells.length - 1) doc.setTextColor(...opts.tone);
			else gray(opts.bold ? INK.text : INK.text);

			doc.text(cell, col.align === 'right' ? x + w - 4 : x, y, {
				align: col.align === 'right' ? 'right' : 'left'
			});
			x += w;
		}
	};

	// Header band. Three-argument form: jsPDF's single-argument overload is typed as a string.
	doc.setFillColor(INK.head, INK.head, INK.head);
	doc.rect(margin, y - 10, width, 16, 'F');
	gray(INK.muted);
	drawRow(
		cols.map((c) => c.head),
		{ bold: true, size: 7 }
	);
	y += 16;

	for (const result of input.results) {
		ensure(16);

		// The real per-platform threshold, so MARGINAL means "close to this platform's bar"
		// rather than something derived from the score itself.
		const status = statusOf(result, PROFILES[result.platformId].passingScore);

		drawRow(
			[
				result.system,
				String(result.overallScore),
				...DIMENSIONS.map((d) => String(result.breakdown[d].score)),
				status
			],
			{ tone: TONE[status] }
		);

		y += 6;
		doc.setDrawColor(238);
		doc.line(margin, y, right, y);
		y += 10;
	}

	// ── 2. Recommendations ────────────────────────────────────────────────────
	const suggestions = rankedSuggestions(input.results);
	const issues = uniqueIssues(input.results);

	if (suggestions.length > 0 || issues.length > 0) {
		heading('2. RECOMMENDATIONS FOR IMPROVEMENT');

		let index = 1;
		for (const suggestion of suggestions) {
			ensure(34);
			gray(INK.muted);
			text(String(index).padStart(2, '0'), 8, 'bold');
			gray(INK.text);
			text(suggestion.summary, 9, 'bold', margin + 22);

			doc.setTextColor(
				...TONE[
					suggestion.impact === 'low'
						? 'PASS'
						: suggestion.impact === 'medium'
							? 'MARGINAL'
							: 'FAIL'
				]
			);
			doc.setFontSize(7);
			doc.setFont('helvetica', 'bold');
			doc.text(suggestion.impact.toUpperCase(), right, y, { align: 'right' });
			y += 12;

			if (suggestion.detail) {
				gray(INK.muted);
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(8);
				for (const line of doc.splitTextToSize(suggestion.detail, width - 22) as string[]) {
					ensure(11);
					doc.text(line, margin + 22, y);
					y += 11;
				}
			}

			gray(INK.muted);
			doc.setFontSize(7);
			doc.text(`Affects: ${suggestion.platforms.join(', ')}`, margin + 22, y);
			y += 16;
			index += 1;
		}

		for (const { issue, platforms } of issues) {
			ensure(24);
			gray(INK.muted);
			text(String(index).padStart(2, '0'), 8, 'bold');
			gray(INK.text);
			text(issue, 9, 'bold', margin + 22);
			y += 12;
			gray(INK.muted);
			doc.setFontSize(7);
			doc.setFont('helvetica', 'normal');
			doc.text(`Affects: ${platforms.join(', ')}`, margin + 22, y);
			y += 16;
			index += 1;
		}
	}

	// ── 3. Platform detail ────────────────────────────────────────────────────
	//
	// The table in section 1 gives six numbers per platform and no reason for any of them.
	// This is the same evidence the on-screen detail view shows, from the same module, so the
	// printed report and the screen cannot disagree.
	heading('3. PLATFORM DETAIL');

	gray(INK.muted);
	paragraph(
		'What each score was measured from, with the advice that would move it. Experience, ' +
			'education and quantification read the resume itself and so read the same on every ' +
			'platform; formatting, keywords and sections are where the parsers genuinely differ.',
		8,
		11
	);
	y += 8;

	/** One suggestion, indented under whatever it belongs to. */
	const adviceBlock = (suggestion: Suggestion, indent: number) => {
		ensure(26);
		gray(INK.text);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(8);
		doc.text(suggestion.summary, margin + indent, y);

		doc.setTextColor(
			...TONE[
				suggestion.impact === 'low' ? 'PASS' : suggestion.impact === 'medium' ? 'MARGINAL' : 'FAIL'
			]
		);
		doc.setFontSize(7);
		doc.text(suggestion.impact.toUpperCase(), right, y, { align: 'right' });
		y += 11;

		gray(INK.muted);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(8);
		for (const detail of suggestion.details.slice(0, 2)) {
			for (const line of doc.splitTextToSize(detail, width - indent) as string[]) {
				ensure(10);
				doc.text(line, margin + indent, y);
				y += 10;
			}
		}
		y += 4;
	};

	for (const result of input.results) {
		// Enough room that a platform name never strands itself at the foot of a page.
		ensure(80);

		const detailStatus = statusOf(result, PROFILES[result.platformId].passingScore);

		gray(INK.text);
		text(result.system, 11, 'bold');
		doc.setTextColor(...TONE[detailStatus]);
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(9);
		doc.text(`${String(result.overallScore)}/100  ${detailStatus}`, right, y, { align: 'right' });
		y += 6;
		rule();
		y += 14;

		for (const dimension of DIMENSIONS) {
			const score = result.breakdown[dimension].score;
			const lines = dimensionEvidence(result, dimension).slice(0, EVIDENCE_LINES);
			const advice = result.suggestions.filter((s) => s.dimension === dimension);

			ensure(20 + lines.length * 10);

			gray(INK.text);
			text(labelFor(result, dimension), 9, 'bold');

			// Only a shortfall is coloured. A page of green numbers hides the two that matter.
			if (score < STRONG_SCORE) doc.setTextColor(...TONE.MARGINAL);
			else gray(INK.text);
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(9);
			doc.text(String(score), margin + 120, y, { align: 'right' });
			y += 12;

			gray(INK.muted);
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(8);
			for (const line of lines) {
				for (const wrapped of doc.splitTextToSize(line, width - 16) as string[]) {
					ensure(10);
					doc.text(wrapped, margin + 16, y);
					y += 10;
				}
			}

			y += 2;
			for (const suggestion of advice) adviceBlock(suggestion, 16);
			y += 6;
		}

		const unfiled = result.suggestions.filter((s) => s.dimension === undefined);
		if (unfiled.length > 0) {
			ensure(30);
			gray(INK.text);
			text('Whole document', 9, 'bold');
			y += 12;
			for (const suggestion of unfiled) adviceBlock(suggestion, 16);
		}

		y += 6;
	}

	// ── 4. Keyword coverage ───────────────────────────────────────────────────
	const { matched, missing } = keywordCoverage(input.results);

	if (matched.length > 0 || missing.length > 0) {
		heading('4. KEYWORD COVERAGE');

		const half = width / 2 - 8;
		const startY = y;

		gray(INK.muted);
		text(`FOUND (${String(matched.length)})`, 7, 'bold');
		doc.text(`NOT FOUND (${String(missing.length)})`, margin + half + 16, y);
		y += 12;

		doc.setFont('helvetica', 'normal');
		doc.setFontSize(8);

		const left = doc.splitTextToSize(matched.join(', ') || '—', half) as string[];
		const rightCol = doc.splitTextToSize(missing.join(', ') || '—', half) as string[];

		gray(INK.text);
		let ly = y;
		for (const line of left.slice(0, 8)) {
			doc.text(line, margin, ly);
			ly += 11;
		}

		gray(INK.muted);
		let ry = y;
		for (const line of rightCol.slice(0, 8)) {
			doc.text(line, margin + half + 16, ry);
			ry += 11;
		}

		y = Math.max(ly, ry, startY) + 6;
	}

	// ── 4. Methodology ────────────────────────────────────────────────────────
	heading('5. METHODOLOGY');
	gray(INK.muted);
	paragraph(
		'Each platform score is a weighted composite of six dimensions: formatting compliance, ' +
			'keyword match, section structure, experience quality, education completeness and ' +
			'quantification. Weights, parsing strictness and keyword-matching strategy differ per ' +
			'platform and are derived from publicly documented parsing behaviour. Scores are ' +
			'produced by a deterministic rule-based engine; where an AI pass is available it may ' +
			'adjust each score by at most 15 points with stated evidence. Pass thresholds are set ' +
			'per platform rather than at a single cutoff.',
		8,
		11
	);

	// ── Footer on every page ──────────────────────────────────────────────────
	const pages = doc.getNumberOfPages();
	for (let page = 1; page <= pages; page++) {
		doc.setPage(page);
		doc.setDrawColor(INK.rule);
		doc.line(margin, pageHeight - 42, right, pageHeight - 42);

		gray(INK.muted);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(7);
		doc.text(
			'Independent open-source tool. Not affiliated with any ATS vendor. Scores are estimates, not guarantees.',
			margin,
			pageHeight - 30
		);
		doc.text(
			`${input.fileName ?? 'Resume'}  ·  Page ${String(page)} of ${String(pages)}`,
			right,
			pageHeight - 30,
			{ align: 'right' }
		);
	}

	doc.save(`ats-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
