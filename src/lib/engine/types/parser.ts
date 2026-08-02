/** Parser contracts — PRD §5.2, §5.5–5.8. */

export const SECTION_TYPES = [
	'contact',
	'summary',
	'experience',
	'education',
	'skills',
	'projects',
	'certifications',
	'awards',
	'publications',
	'volunteer',
	'languages',
	'interests',
	'unknown'
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export interface ContactInfo {
	name: string | null;
	email: string | null;
	phone: string | null;
	linkedin: string | null;
	github: string | null;
	website: string | null;
	location: string | null;
}

export interface DateRange {
	/** "YYYY-MM" or "YYYY". */
	start: string | null;
	end: string | null;
	isCurrent: boolean;
}

/**
 * A line of section content with its horizontal position preserved.
 *
 * Indentation is structural, not cosmetic: a LaTeX resume marks role headers and their
 * achievement bullets with the same glyph at different depths, so discarding x means the two
 * cannot be told apart.
 */
export interface SectionLine {
	text: string;
	/** Left edge in PDF user-space units; 0 for text-derived input. */
	indent: number;
}

export interface ResumeSection {
	type: SectionType;
	/** The header line as written in the resume, or null when inferred. */
	heading: string | null;
	content: SectionLine[];
	startLine: number;
	endLine: number;
}

export interface ExperienceEntry {
	title: string | null;
	company: string | null;
	location: string | null;
	dates: DateRange | null;
	bullets: string[];
}

export interface EducationEntry {
	degree: string | null;
	field: string | null;
	institution: string | null;
	dates: DateRange | null;
	gpa: string | null;
	honors: string[];
}

export interface ProjectEntry {
	name: string | null;
	techStack: string[];
	url: string | null;
	bullets: string[];
}

export interface CertificationEntry {
	name: string;
	issuer: string | null;
	date: string | null;
}

export interface ResumeMetadata {
	fileType: 'pdf' | 'docx' | 'text';
	pageCount: number;
	wordCount: number;
	lineCount: number;
	hasMultipleColumns: boolean;
	hasTables: boolean;
	hasImages: boolean;
}

export interface ParsedResume {
	rawText: string;
	lines: string[];
	contact: ContactInfo;
	sections: ResumeSection[];
	experience: ExperienceEntry[];
	education: EducationEntry[];
	projects: ProjectEntry[];
	certifications: CertificationEntry[];
	skills: string[];
	summary: string | null;
	metadata: ResumeMetadata;
}

/**
 * A line plus the layout facts derived from it.
 *
 * `blankBefore` exists because PRD §5.5's section heuristics A and C both test "preceded by
 * a blank line", but §5.4 filters empty lines out of DOCX and §5.3's PDF line reconstruction
 * has no blank-line concept at all — the signal was being destroyed before the code that
 * needs it ran (ADR 0001 §10).
 */
export interface RawLine {
	text: string;
	page: number;
	y: number;
	xStart: number;
	xEnd: number;
	blankBefore: boolean;
}

/** A pdf.js text item reduced to geometry. Layout heuristics operate on these, never on a
 *  pdf.js page object — that keeps them pure and testable against synthetic arrays. */
export interface PositionedItem {
	str: string;
	x: number;
	y: number;
	width: number;
	height: number;
	page: number;
	/**
	 * Zero-based column index within the page, assigned by `analyzeColumns`.
	 *
	 * Line reconstruction sorts by (page, column, y), so a two-column page is read one column
	 * at a time rather than interleaved across the gutter. Absent means single column.
	 */
	column?: number;
}

export interface RawExtraction {
	text: string;
	lines: RawLine[];
	pageCount: number;
	hasMultipleColumns: boolean;
	hasTables: boolean;
	hasImages: boolean;
}

export type ParseErrorCode =
	| 'UNSUPPORTED_TYPE'
	| 'TOO_LARGE'
	| 'ENCRYPTED'
	| 'NO_TEXT_LAYER'
	| 'CORRUPT'
	| 'EMPTY'
	| 'WORKER_TIMEOUT';

/** Typed rather than free-form so the UI can render an actionable hint per code. */
export interface ParseIssue {
	code: ParseErrorCode | ParseWarningCode;
	message: string;
	hint?: string;
}

export type ParseWarningCode =
	| 'NO_EMAIL'
	| 'NO_EXPERIENCE_SECTION'
	| 'NO_EDUCATION_SECTION'
	| 'MULTI_COLUMN_SUSPECTED'
	| 'LONG_DOCUMENT'
	| 'NON_ENGLISH_SUSPECTED'
	| 'LIGATURE_DAMAGE'
	| 'FEW_SECTIONS';

export interface ParseResult {
	success: boolean;
	resume: ParsedResume | null;
	errors: ParseIssue[];
	warnings: ParseIssue[];
}
