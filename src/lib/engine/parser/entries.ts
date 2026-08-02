import type {
	CertificationEntry,
	EducationEntry,
	ExperienceEntry,
	ProjectEntry,
	ResumeSection
} from '../types/parser';
import { extractDateRange, hasDate } from './dates';
import { isBulletLine, stripBullet } from './text';

/** Structured entry extraction (PRD §5.8). */

/** Splits a section's lines into one block per entry. */
function splitEntries(content: string[]): string[][] {
	const blocks: string[][] = [];
	let current: string[] = [];

	for (const raw of content) {
		const line = raw.trim();
		if (line === '') {
			if (current.length > 0) blocks.push(current);
			current = [];
			continue;
		}

		// A dated, non-bullet line starts a new role — that is the conventional entry header.
		const startsNewEntry = !isBulletLine(line) && hasDate(line) && current.length > 0;
		const currentHasBullets = current.some((l) => isBulletLine(l));

		if (startsNewEntry && currentHasBullets) {
			// Carry back any trailing header lines. A role is often written as
			//   Software Engineer
			//   Twilio | 2018 - 2020
			// and the split fires on the dated line, so without this the title is orphaned
			// into the previous block and the new role reports its employer as its title.
			const carried: string[] = [];
			while (current.length > 0) {
				const last = current.at(-1);
				if (last === undefined || isBulletLine(last) || hasDate(last)) break;
				carried.unshift(last);
				current.pop();
			}

			blocks.push(current);
			current = [...carried, line];
			continue;
		}

		current.push(line);
	}

	if (current.length > 0) blocks.push(current);
	return blocks;
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

/** "City, ST" or "City, Country", matched inside a header line before it is split. */
const LOCATION_PATTERN =
	/\b\p{Lu}[\p{L}.'-]+(?:\s+\p{Lu}[\p{L}.'-]+)*,\s*(?:[A-Z]{2}\b|\p{Lu}\p{Ll}+)/u;

/**
 * "Senior Software Engineer, Stripe" is a documented header format (PRD §5.8) and is
 * structurally identical to "San Francisco, CA" — so a bare comma pattern swallows the whole
 * title and leaves the role with no title and no company.
 *
 * A job title or a company suffix in the candidate means it is a header, not a place.
 */
function findLocation(headerText: string): string | null {
	const candidate = LOCATION_PATTERN.exec(headerText)?.[0];
	if (!candidate) return null;
	if (TITLE_HINT.test(candidate) || COMPANY_HINT.test(candidate)) return null;
	return candidate;
}

export function extractExperience(sections: ResumeSection[]): ExperienceEntry[] {
	const content = sections.filter((s) => s.type === 'experience').flatMap((s) => s.content);

	return splitEntries(content)
		.map((block) => {
			const headerLines = block.filter((l) => !isBulletLine(l));
			const bullets = block.filter((l) => isBulletLine(l)).map(stripBullet);

			const dateLine = headerLines.find((l) => hasDate(l));
			const dates = dateLine ? extractDateRange(dateLine) : null;

			// Pull the location out before splitting: `headerParts` also splits on ", ", which
			// would tear "San Francisco, CA" into two unrecognisable fragments.
			const headerText = headerLines.slice(0, 2).join(' | ');
			const location = findLocation(headerText);
			const withoutLocation = location ? headerText.replace(location, '') : headerText;

			const parts = headerParts(withoutLocation);
			const remaining = parts;

			const title = remaining.find((p) => TITLE_HINT.test(p)) ?? remaining[0] ?? null;
			const company =
				remaining.find((p) => p !== title && COMPANY_HINT.test(p)) ??
				remaining.find((p) => p !== title) ??
				null;

			return { title, company, location, dates, bullets };
		})
		.filter((e) => e.title !== null || e.bullets.length > 0);
}

const DEGREE =
	/\b(ph\.?d\.?|doctor(?:ate)?|d\.?phil|master(?:'s)?(?:\s+of\s+\w+)?|m\.?b\.?a|m\.?sc?|m\.?a|m\.?eng|bachelor(?:'s)?(?:\s+of\s+\w+)?|b\.?sc?|b\.?a|b\.?eng|b\.?tech|associate(?:'s)?|a\.?a|a\.?s|diploma|certificate)\b\.?/i;

const GPA = /\bgpa\b[:\s]*([0-4](?:\.\d{1,2})?)(?:\s*\/\s*([0-5](?:\.\d{1,2})?))?/i;

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
	const header = block[0] ?? '';

	if (degree) {
		// The segment containing the degree, minus the degree token itself.
		const segment = header.split(/\s*[|•·]\s*/).find((s) => s.includes(degree));
		if (segment) {
			const rest = segment
				.replace(degree, '')
				.replace(/^\s*(?:in|of)\s+/i, '')
				.replace(/[,;]\s*$/, '')
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

	return splitEntries(content)
		.map((block) => {
			const text = block.join(' ');

			const degreeMatch = DEGREE.exec(text);
			const degree = degreeMatch?.[0] ?? null;

			const field = extractField(block, degree);

			const parts = block.flatMap(headerParts);
			const institution =
				parts.find((p) => COMPANY_HINT.test(p) && !DEGREE.test(p)) ??
				parts.find((p) => !DEGREE.test(p) && p !== field && !GPA.test(p)) ??
				null;

			const dateLine = block.find((l) => hasDate(l));
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
			const headerLines = block.filter((l) => !isBulletLine(l));
			const bullets = block.filter((l) => isBulletLine(l)).map(stripBullet);
			const text = block.join(' ');

			const header = headerLines[0] ?? '';
			const name = header.split(/\s*[|(–—]\s*/)[0]?.trim() ?? null;

			// Tech stack comes from a parenthesised list or a "Technologies:" prefix.
			// The labelled form is matched per line: run against the joined block it swallows
			// the following bullet too ("Go, Redis - Real-time ingest").
			const parenthesised = /\(([^)]+)\)/.exec(header)?.[1];
			const labelled = block
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
			const line = stripBullet(raw).trim();
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
