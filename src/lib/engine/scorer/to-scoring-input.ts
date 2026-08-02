import type { ParsedResume } from '../types/parser';
import type { ScoringInput } from '../types/scoring';
import { countSections } from '../parser/sections';

/**
 * Bridges parser output to scorer input.
 *
 * Passes the structured entries through rather than flattening to strings: PRD §7.1 handed
 * the scorer only `educationText: string` and a flat section-name list, which forced it to
 * re-parse content the parser had already structured and made several §7.9 quirks
 * uncomputable (ADR 0001 §6).
 */
export function toScoringInput(resume: ParsedResume, jobDescription?: string): ScoringInput {
	const base: ScoringInput = {
		resumeText: resume.rawText,
		resumeSkills: resume.skills,
		resumeSections: resume.sections.map((s) => s.type),

		experience: resume.experience,
		education: resume.education,
		projects: resume.projects,
		summary: resume.summary,
		sectionCounts: countSections(resume.sections),

		hasMultipleColumns: resume.metadata.hasMultipleColumns,
		hasTables: resume.metadata.hasTables,
		hasImages: resume.metadata.hasImages,
		pageCount: resume.metadata.pageCount,
		wordCount: resume.metadata.wordCount
	};

	// exactOptionalPropertyTypes: only attach the key when there is a value.
	const trimmed = jobDescription?.trim();
	return trimmed ? { ...base, jobDescription: trimmed } : base;
}
