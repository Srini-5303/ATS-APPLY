import type {
	CertificationEntry,
	EducationEntry,
	ExperienceEntry,
	ProjectEntry,
	ResumeSection,
	SectionLine
} from '../types/parser';
import { extractDateRange, hasDate } from './dates';
import { findPlace } from './location';
import { isBulletLine, stripBullet } from './text';

/** Structured entry extraction (PRD §5.8). */

/**
 * Groups a section's lines into one block per entry, using indentation.
 *
 * Resumes mark entries two ways. Most put an undecorated header line above indented bullets.
 * LaTeX templates instead bullet the header too, at a shallower depth than the achievements
 * beneath it:
 *
 *     x=36  * AI Intern | Databricks            <- entry header
 *     x=44    Brightstar Lottery  2026-Present  <- employer and dates
 *     x=56      o Engineered a pipeline...      <- achievement
 *     x=66        applying chunk-level keys     <- wrapped continuation
 *
 * Treating every bullet the same way turns that whole role into four unrelated achievements
 * with no title. Two distinct bullet depths mean the shallower one marks entries; a single
 * depth means every bullet is content.
 */
interface EntryBlock {
	/** Non-bullet lines plus the entry-level bullet, i.e. title / employer / dates. */
	header: string[];
	/** Achievement bullets, with wrapped continuations folded back in. */
	bullets: string[];
}

/** Lines within this many units of each other are at the same depth. */
const INDENT_TOLERANCE = 4;

function bulletDepths(content: SectionLine[]): number[] {
	const depths: number[] = [];

	for (const line of content) {
		if (!isBulletLine(line.text)) continue;
		if (!depths.some((d) => Math.abs(d - line.indent) <= INDENT_TOLERANCE)) {
			depths.push(line.indent);
		}
	}

	return depths.sort((a, b) => a - b);
}

function splitEntries(content: SectionLine[], bulletsStartEntries = false): EntryBlock[] {
	const depths = bulletDepths(content);

	// Only a nested section uses its outer bullet level as an entry marker — except in
	// education, where each bullet *is* a degree and there are no achievement bullets beneath
	// it to nest against.
	const entryDepth =
		depths.length >= 2 || (bulletsStartEntries && depths.length === 1) ? depths[0] : undefined;

	const blocks: EntryBlock[] = [];

	/**
	 * Appends a new block and returns it. It does not touch `current` — assigning from inside
	 * a closure defeats TypeScript's narrowing, so the caller does that explicitly.
	 */
	const open = (headerLine?: string): EntryBlock => {
		const block: EntryBlock = {
			header: headerLine === undefined ? [] : [headerLine],
			bullets: []
		};
		blocks.push(block);
		return block;
	};

	let current: EntryBlock | null = null;

	for (const line of content) {
		const text = line.text.trim();
		if (text === '') continue;

		const bullet = isBulletLine(text);
		const atEntryDepth =
			entryDepth !== undefined && Math.abs(line.indent - entryDepth) <= INDENT_TOLERANCE;

		// A bullet at the outer depth opens a new entry.
		if (bullet && atEntryDepth) {
			current = open(stripBullet(text));
			continue;
		}

		// Without nesting, fall back to the conventional signal: an undecorated dated line
		// after a block that already has bullets.
		if (
			entryDepth === undefined &&
			!bullet &&
			hasDate(text) &&
			current !== null &&
			current.bullets.length > 0
		) {
			// Carry back any trailing header lines — a role written as "Title" then
			// "Company | dates" would otherwise lose its title to the previous entry.
			const carried: string[] = [];
			while (current.header.length > 0) {
				const last = current.header.at(-1);
				if (last === undefined || hasDate(last)) break;
				carried.unshift(last);
				current.header.pop();
			}
			const next = open();
			next.header.push(...carried, text);
			current = next;
			continue;
		}

		const block = (current ??= open());

		if (bullet) {
			block.bullets.push(stripBullet(text));
			continue;
		}

		// A deeper, unbulleted line directly after a bullet is that bullet's wrapped tail.
		const previous = block.bullets.at(-1);
		if (previous !== undefined && entryDepth !== undefined && line.indent > entryDepth) {
			block.bullets[block.bullets.length - 1] = `${previous} ${text}`;
			continue;
		}

		block.header.push(text);
	}

	return blocks.filter((b) => b.header.length > 0 || b.bullets.length > 0);
}

const HEADER_SEPARATOR = /\s*(?:\||•|·|—|–| - |,\s)\s*/;

/**
 * Splits an entry header into its parts, with the date removed first so a separator inside
 * the date range ("Jan 2023 - Dec 2024") cannot fragment it.
 */
function headerParts(line: string): string[] {
	const withoutDate = line
		.replace(
			/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}|present|current|now)/gi,
			''
		)
		.replace(/\b(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:19|20)\d{2}|present|current|now)/gi, '')
		.replace(/\b\d{1,2}\/(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:\d{1,2}\/(?:19|20)\d{2}|present)/gi, '')
		.replace(/\b(?:19|20)\d{2}\b/g, '');

	return withoutDate
		.split(HEADER_SEPARATOR)
		.map((p) =>
			p
				.trim()
				.replace(/^[|,\-–—•·]+|[|,\-–—•·]+$/g, '')
				.trim()
		)
		.filter((p) => p !== '');
}

const TITLE_HINT =
	/\b(?:engineer|developer|manager|director|analyst|designer|scientist|consultant|architect|administrator|specialist|coordinator|lead|head|officer|president|intern|associate|assistant|advisor|strategist|researcher|technician|accountant|attorney|nurse|teacher|professor)\b/i;

const COMPANY_HINT =
	/\b(?:inc|llc|ltd|corp|corporation|company|co|gmbh|plc|group|labs|technologies|systems|solutions|university|college|hospital|institute)\b\.?/i;

/**
 * "Senior Software Engineer, Stripe" is a documented header format (PRD §5.8) and is
 * structurally identical to "San Francisco, CA", so a job title or company suffix in the
 * candidate rules it out as a place.
 */
function findLocation(headerText: string): string | null {
	return findPlace(headerText, (c) => TITLE_HINT.test(c) || COMPANY_HINT.test(c));
}

/** The employer on a line, with dates, location and an already-claimed title removed. */
function companyFrom(
	line: string,
	location: string | null,
	exclude?: string | null
): string | null {
	const parts = headerParts(location ? line.replace(location, '') : line);
	const candidates = parts.filter((p) => p !== exclude);

	return (
		candidates.find((p) => COMPANY_HINT.test(p)) ??
		candidates.find((p) => !TITLE_HINT.test(p)) ??
		candidates[0] ??
		null
	);
}

export function extractExperience(sections: ResumeSection[]): ExperienceEntry[] {
	const content = sections.filter((s) => s.type === 'experience').flatMap((s) => s.content);

	return splitEntries(content)
		.map((block) => {
			const headerLines = block.header;
			const bullets = block.bullets;

			const titleLine = headerLines[0] ?? '';
			const dateLine = headerLines.find((l) => hasDate(l));
			const dates = dateLine ? extractDateRange(dateLine) : null;

			// Pull the location out before splitting: `headerParts` also splits on ", ", which
			// would tear "San Francisco, CA" into two unrecognisable fragments.
			// Checked per line: a location sits at the end of *its* line, and joining lines
			// first buries it mid-string where the end-of-line rule no longer fires.
			const location = headerLines.reduce<string | null>(
				(found, line) => found ?? findLocation(line),
				null
			);

			const titleParts = headerParts(location ? titleLine.replace(location, '') : titleLine);
			const title = titleParts.find((p) => TITLE_HINT.test(p)) ?? titleParts[0] ?? null;

			// The employer sits with the dates in every layout that separates them — a title
			// line often continues into a technology list, so mining it for the company picks
			// up a stray keyword instead.
			const company =
				(dateLine !== undefined && dateLine !== titleLine
					? companyFrom(dateLine, location)
					: null) ?? companyFrom(titleLine, location, title);

			return { title, company, location, dates, bullets };
		})
		.filter((e) => e.title !== null || e.bullets.length > 0);
}

const DEGREE =
	/\b(ph\.?d\.?|doctor(?:ate)?|d\.?phil|master(?:'s)?(?:\s+of\s+\w+)?|m\.?b\.?a|m\.?sc?|m\.?a|m\.?eng|bachelor(?:'s)?(?:\s+of\s+\w+)?|b\.?sc?|b\.?a|b\.?eng|b\.?tech|associate(?:'s)?|a\.?a|a\.?s|diploma|certificate)\b\.?/i;

const GPA = /\bgpa\b[:\s]*([0-4](?:\.\d{1,2})?)(?:\s*\/\s*([0-5](?:\.\d{1,2})?))?/i;

/** A trailing ", XX" state or country code, which collides with MA / MS / BA / BS degrees. */
const STATE_CODE = /,\s*[A-Z]{2}\b/g;

const HONORS = [
	'summa cum laude',
	'magna cum laude',
	'cum laude',
	"dean's list",
	'deans list',
	'with distinction',
	'with honors',
	'with honours',
	'valedictorian',
	'salutatorian',
	'first class',
	'phi beta kappa'
];

/** Degree level, used for relevance comparisons (PRD §7.8). */
export function degreeLevel(degree: string | null): number {
	if (!degree) return 0;
	const d = degree.toLowerCase();
	if (/ph\.?d|doctor|d\.?phil/.test(d)) return 5;
	if (/master|m\.?b\.?a|m\.?sc?\b|m\.?a\b|m\.?eng/.test(d)) return 4;
	if (/bachelor|b\.?sc?\b|b\.?a\b|b\.?eng|b\.?tech/.test(d)) return 3;
	if (/associate|a\.?a\b|a\.?s\b/.test(d)) return 2;
	if (/diploma|certificate/.test(d)) return 1;
	return 0;
}

const INSTITUTION_WORD = /\b(?:university|college|institute|school|academy|polytechnic)\b/i;

/**
 * Field of study.
 *
 * Tries the degree's own segment first — "B.S. Computer Science | UC Berkeley" puts the field
 * directly after the degree token, with no "in" or "of" anywhere. Falling back to an "in|of"
 * search alone picks up "University **of** California" and reports the field as "California".
 */
function extractField(block: string[], degree: string | null): string | null {
	// The degree is not always on the first line: LaTeX templates put the institution above it.
	const degreeLine = degree ? (block.find((l) => l.includes(degree)) ?? block[0] ?? '') : '';
	const header = degreeLine || (block[0] ?? '');

	if (degree) {
		// The segment containing the degree, minus the degree token itself.
		const segment = header.split(/\s*[|•·]\s*/).find((s) => s.includes(degree));
		if (segment) {
			// Everything from a semicolon, parenthesis or year onward is detail rather than the
			// field: "M.S. in Artificial Intelligence; GPA: 3.75 Sept 2024" must not carry the
			// GPA and dates along with it.
			const rest = (
				segment
					.replace(degree, '')
					.replace(/^\s*(?:in|of)\s+/i, '')
					.split(/[;(]|\b(?:19|20)\d{2}\b/)[0] ?? ''
			)
				.replace(/[,;:]\s*$/, '')
				.trim();

			if (rest !== '' && rest.length <= 60 && !INSTITUTION_WORD.test(rest)) return rest;
		}
	}

	// Otherwise look for an explicit "in <Field>", excluding "University of <Place>".
	for (const match of header.matchAll(
		/\b(in|of)\s+([\p{Lu}][\p{L}&\s-]{2,40}?)(?=\s*[,|(]|\s+at\b|\s+from\b|$)/gu
	)) {
		const preceding = header.slice(0, match.index);
		if (
			match[1]?.toLowerCase() === 'of' &&
			INSTITUTION_WORD.test(preceding.split(/[|•·]/).pop() ?? '')
		) {
			continue;
		}
		const value = match[2]?.trim();
		if (value && !INSTITUTION_WORD.test(value)) return value;
	}

	return null;
}

export function extractEducation(sections: ResumeSection[]): EducationEntry[] {
	const content = sections.filter((s) => s.type === 'education').flatMap((s) => s.content);

	return splitEntries(content, true)
		.map((block) => {
			const lines = [...block.header, ...block.bullets];
			const text = lines.join(' ');

			// Only the trailing state code is removed, not the whole place: "Northeastern
			// University Boston, MA" reads as a Master of Arts because "MA" matches the degree
			// pattern and comes first — but stripping the entire match would take the
			// institution with it.
			const degreeText = text.replace(STATE_CODE, ' ');

			const degreeMatch = DEGREE.exec(degreeText);
			const degree = degreeMatch?.[0] ?? null;

			const field = extractField(lines, degree);

			const parts = lines.flatMap(headerParts);
			const institution =
				parts.find((p) => COMPANY_HINT.test(p) && !DEGREE.test(p)) ??
				parts.find((p) => !DEGREE.test(p) && p !== field && !GPA.test(p)) ??
				null;

			const dateLine = lines.find((l) => hasDate(l));
			const dates = dateLine ? extractDateRange(dateLine) : null;

			const gpaMatch = GPA.exec(text);
			const lower = text.toLowerCase();

			return {
				degree,
				field,
				institution,
				dates,
				gpa: gpaMatch?.[1] ?? null,
				honors: HONORS.filter((h) => lower.includes(h))
			};
		})
		.filter((e) => e.degree !== null || e.institution !== null);
}

export function extractProjects(sections: ResumeSection[]): ProjectEntry[] {
	const content = sections.filter((s) => s.type === 'projects').flatMap((s) => s.content);

	return splitEntries(content)
		.map((block) => {
			const headerLines = block.header;
			const bullets = block.bullets;
			const text = [...block.header, ...block.bullets].join(' ');

			const header = headerLines[0] ?? '';
			const name = header.split(/\s*[|(–—]\s*/)[0]?.trim() ?? null;

			// Tech stack comes from a parenthesised list or a "Technologies:" prefix.
			// The labelled form is matched per line: run against the joined block it swallows
			// the following bullet too ("Go, Redis - Real-time ingest").
			const parenthesised = /\(([^)]+)\)/.exec(header)?.[1];
			const labelled = [...block.header, ...block.bullets]
				.map((line) => /(?:technologies|tech stack|built with|stack)\s*[:—-]\s*(.+)$/i.exec(line))
				.find((m) => m !== null)?.[1];

			const techStack = (parenthesised ?? labelled ?? '')
				.split(/[,;|]/)
				.map((t) => t.trim())
				.filter((t) => t !== '' && t.length <= 30);

			return {
				name: name === '' ? null : name,
				techStack,
				url: /https?:\/\/[^\s,;)]+/.exec(text)?.[0] ?? null,
				bullets
			};
		})
		.filter((p) => p.name !== null || p.bullets.length > 0);
}

export function extractCertifications(sections: ResumeSection[]): CertificationEntry[] {
	const content = sections.filter((s) => s.type === 'certifications').flatMap((s) => s.content);

	return content
		.map((raw) => {
			const line = stripBullet(raw.text).trim();
			if (line === '') return null;

			const parts = headerParts(line);
			const dates = extractDateRange(line);

			return {
				name: parts[0] ?? line,
				issuer: parts[1] ?? null,
				date: dates?.start ?? null
			};
		})
		.filter((c): c is CertificationEntry => c !== null);
}
