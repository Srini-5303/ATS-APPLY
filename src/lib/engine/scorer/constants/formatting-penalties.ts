import type { ResumeAnalysis } from '../../types/scoring';

/**
 * PRD §7.4's penalty table as data.
 *
 * Every entry is scaled by the profile's `parsingStrictness`, which is the entire reason
 * Lever (0.35) and Workday (0.90) disagree about the same resume — no branching required.
 */
export interface FormattingPenalty {
	id: string;
	/** Points deducted at strictness 1.0. */
	points: number | ((a: ResumeAnalysis) => number);
	test: (a: ResumeAnalysis) => boolean;
	issue: string;
	detail: string;
}

/**
 * Ceiling on the all-caps deduction.
 *
 * PRD §7.4 charges 3 points per line beyond the third with no cap, which punishes a resume
 * for using ALL-CAPS section headers — the very convention §5.5's heuristic A relies on. Eight
 * headers would cost 15 points uncapped and keep climbing (ADR 0001 §10).
 */
export const ALL_CAPS_MAX_PENALTY = 9;
export const ALL_CAPS_FREE_LINES = 3;

export const FORMATTING_PENALTIES: readonly FormattingPenalty[] = [
	{
		id: 'multi-column',
		points: 15,
		test: (a) => a.input.hasMultipleColumns,
		issue: 'Multi-column layout detected',
		detail:
			'Strict parsers read a page left-to-right and interleave the columns, scrambling your history. Use a single column.'
	},
	{
		id: 'tables',
		points: 12,
		test: (a) => a.input.hasTables,
		issue: 'Tables detected',
		detail:
			'Table cells are frequently flattened or dropped entirely on import. Lay content out with plain paragraphs.'
	},
	{
		id: 'images',
		points: 8,
		test: (a) => a.input.hasImages,
		issue: 'Images or graphics detected',
		detail:
			'Graphics carry no extractable text. Anything meaningful inside an image is invisible to the parser.'
	},
	{
		id: 'page-count',
		points: 5,
		test: (a) => a.input.pageCount > 2,
		issue: 'Longer than two pages',
		detail: 'Some systems truncate on import, so later pages may never be read.'
	},
	{
		id: 'too-short',
		points: 10,
		test: (a) => a.input.wordCount < 150,
		issue: 'Very little content',
		detail:
			'Under 150 words gives both the parser and the recruiter almost nothing to match against.'
	},
	{
		id: 'too-long',
		points: 3,
		test: (a) => a.input.wordCount > 1500,
		issue: 'Very long',
		detail: 'Past roughly 1500 words the most relevant detail gets buried.'
	},
	{
		id: 'special-chars',
		points: 8,
		test: (a) => a.specialCharRatio > 0.05,
		issue: 'Unusual characters detected',
		detail:
			'Decorative glyphs and mangled encodings can corrupt extracted text. Stick to standard characters.'
	},
	{
		id: 'all-caps',
		points: (a) =>
			Math.min(ALL_CAPS_MAX_PENALTY, Math.max(0, a.allCapsLineCount - ALL_CAPS_FREE_LINES) * 3),
		test: (a) => a.allCapsLineCount > ALL_CAPS_FREE_LINES,
		issue: 'Heavy use of all-caps text',
		detail:
			'A few all-caps section headers are fine; whole lines of body text in capitals reduce readability.'
	},
	{
		id: 'bullet-styles',
		points: 2,
		test: (a) => a.bulletStyleCount > 2,
		issue: 'Inconsistent bullet characters',
		detail: 'Mixing bullet glyphs suggests inconsistent formatting. Pick one and use it throughout.'
	}
];
