import type {
	ParseIssue,
	ParseResult,
	ParsedResume,
	RawLine,
	ResumeSection
} from '../types/parser';
import type { PdfGeometry } from './pdf';
import type { DocxExtraction } from './docx';
import { detectSections, sectionText } from './sections';
import { isBulletLine, normalizeText, stripBullet } from './text';
import { extractContact } from './contact';
import {
	extractCertifications,
	extractEducation,
	extractExperience,
	extractProjects
} from './entries';
import { analyzeColumns } from './layout/columns';
import { detectTables } from './layout/tables';
import { reconstructLines } from './layout/lines';

/**
 * Assembles a `ParsedResume` from extracted geometry or plain text.
 *
 * Phase 1 covers lines, sections and skills. Contact extraction, date parsing and structured
 * experience/education entries land in Phase 2 — the fields exist and are empty rather than
 * absent, so the scorer's contract is stable from the start.
 */

function countWords(text: string): number {
	const trimmed = text.trim();
	return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Splits a skills section into individual skills (PRD §5.8). */
export function extractSkills(sections: ResumeSection[]): string[] {
	const raw = sectionText(sections, 'skills');
	if (raw.trim() === '') return [];

	const seen = new Map<string, string>();

	for (const line of raw.split('\n')) {
		// Drop a leading category label such as "Frontend:" or "Languages —".
		const body = stripBullet(line).replace(/^[A-Za-z][A-Za-z /&+#.-]{0,30}\s*[:—-]\s+/, '');

		for (const piece of body.split(/[,;|•·]/)) {
			const skill = piece.trim().replace(/\.$/, '');
			if (skill === '' || skill.length > 40) continue;
			// A fragment with no letters is punctuation noise, not a skill.
			if (!/[a-z]/i.test(skill)) continue;

			const key = skill.toLowerCase();
			if (!seen.has(key)) seen.set(key, skill);
		}
	}

	return [...seen.values()];
}

function collectWarnings(resume: ParsedResume): ParseIssue[] {
	const warnings: ParseIssue[] = [];
	const present = new Set(resume.sections.map((s) => s.type));

	if (!present.has('experience')) {
		warnings.push({
			code: 'NO_EXPERIENCE_SECTION',
			message: 'No experience section was detected.',
			hint: 'Add a heading such as "Experience" or "Work Experience" above your roles.'
		});
	}

	if (!present.has('education')) {
		warnings.push({
			code: 'NO_EDUCATION_SECTION',
			message: 'No education section was detected.',
			hint: 'Add an "Education" heading, even if the entry is brief.'
		});
	}

	if (resume.metadata.hasMultipleColumns) {
		warnings.push({
			code: 'MULTI_COLUMN_SUSPECTED',
			message: 'This resume appears to use a multi-column layout.',
			hint: 'Strict parsers read columns out of order. A single column is safer.'
		});
	}

	if (resume.metadata.pageCount > 2) {
		warnings.push({
			code: 'LONG_DOCUMENT',
			message: `This resume is ${String(resume.metadata.pageCount)} pages.`,
			hint: 'Some systems truncate past page two.'
		});
	}

	if (resume.sections.length <= 1) {
		warnings.push({
			code: 'FEW_SECTIONS',
			message: 'Almost no section structure was detected.',
			hint: 'Use conventional headings so parsers can map your content to fields.'
		});
	}

	return warnings;
}

function assemble(lines: RawLine[], metadata: ParsedResume['metadata']): ParsedResume {
	const sections = detectSections(lines);
	const rawText = lines.map((l) => l.text).join('\n');

	return {
		rawText,
		lines: lines.map((l) => l.text),
		contact: extractContact(lines),
		sections,
		experience: extractExperience(sections),
		education: extractEducation(sections),
		projects: extractProjects(sections),
		certifications: extractCertifications(sections),
		skills: extractSkills(sections),
		summary: sectionText(sections, 'summary').trim() || null,
		metadata: { ...metadata, wordCount: countWords(rawText), lineCount: lines.length }
	};
}

export function parsedResumeFromGeometry(geometry: PdfGeometry): ParseResult {
	// Columns are resolved *before* lines are reconstructed. Reconstructing first would group
	// items by y-coordinate across the gutter, merging the left column's "CONTACT" with the
	// right column's "EXPERIENCE" into one line — after which no section header matches and
	// the resume looks empty. Splitting first keeps our own parse accurate, and the layout is
	// then penalised separately by the formatting dimension.
	const { hasMultipleColumns, ordered } = analyzeColumns(geometry.items, geometry.pageWidth);

	const lines = reconstructLines(ordered, geometry.pageWidth);

	const resume = assemble(lines, {
		fileType: 'pdf',
		pageCount: geometry.pageCount,
		wordCount: 0,
		lineCount: 0,
		hasMultipleColumns,
		hasTables: detectTables(geometry.items, geometry.pageWidth),
		hasImages: geometry.hasImages
	});

	return { success: true, resume, errors: [], warnings: collectWarnings(resume) };
}

export function parsedResumeFromDocx(extraction: DocxExtraction): ParseResult {
	const resume = assemble(extraction.lines, {
		fileType: 'docx',
		// mammoth gives no pagination; a page count would be a guess.
		pageCount: 1,
		wordCount: 0,
		lineCount: 0,
		// No geometry, so no column detection. Reporting false is honest; guessing true would
		// cost the user real formatting points on a layout we cannot actually see.
		hasMultipleColumns: false,
		hasTables: extraction.hasTables,
		hasImages: extraction.hasImages
	});

	return { success: true, resume, errors: [], warnings: collectWarnings(resume) };
}

/** Synchronous path for pasted plain text (PRD §5.1). */
export function parseResumeText(text: string): ParseResult {
	const normalized = normalizeText(text);
	const rawLines = normalized.split('\n');

	const lines: RawLine[] = [];
	let previousWasBlank = true;

	for (const raw of rawLines) {
		const trimmed = raw.trim();
		if (trimmed === '') {
			previousWasBlank = true;
			continue;
		}

		lines.push({
			text: trimmed,
			page: 1,
			y: 0,
			xStart: 0,
			xEnd: trimmed.length,
			// Captured before empty lines are dropped — the signal PRD §5.4 discarded.
			blankBefore: previousWasBlank
		});
		previousWasBlank = false;
	}

	if (lines.length === 0) {
		return {
			success: false,
			resume: null,
			errors: [{ code: 'EMPTY', message: 'No text was found.' }],
			warnings: []
		};
	}

	const resume = assemble(lines, {
		fileType: 'text',
		pageCount: 1,
		wordCount: 0,
		lineCount: 0,
		hasMultipleColumns: false,
		hasTables: false,
		hasImages: false
	});

	return { success: true, resume, errors: [], warnings: collectWarnings(resume) };
}

export { isBulletLine, stripBullet };
