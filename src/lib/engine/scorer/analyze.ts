import type { BulletFact, ResumeAnalysis, ScoringInput } from '../types/scoring';
import type { SectionType } from '../types/parser';
import { isBulletLine, stripBullet } from '../parser/text';
import { bulletGlyphOf } from '../parser/text';
import { parseJobDescription, scoringTerms } from '../job-parser';
import { uniqueTerms } from '../nlp/tokenizer';
import { buildResumeTermSet } from './matching';
import { startsWithActionVerb } from './constants/action-verbs';
import { QUANT_PATTERNS } from './constants/quantification';

/**
 * Computes everything platform-independent exactly once.
 *
 * Two reasons this exists rather than each dimension recomputing what it needs: tokenising
 * once instead of six times, and — more importantly — guaranteeing all six profiles see
 * identical facts. "Workday and Taleo disagree about the bullet count" becomes structurally
 * impossible.
 */

export function isQuantified(text: string): boolean {
	return QUANT_PATTERNS.some((pattern) => pattern.test(text));
}

function collectBullets(input: ScoringInput): BulletFact[] {
	const texts: string[] = [];

	// Prefer structured entries once Phase 2 populates them; fall back to scanning raw lines
	// so the walking skeleton still measures something real.
	for (const entry of input.experience) texts.push(...entry.bullets);
	for (const project of input.projects) texts.push(...project.bullets);

	if (texts.length === 0) {
		for (const line of input.resumeText.split('\n')) {
			if (isBulletLine(line)) texts.push(stripBullet(line));
		}
	}

	return texts
		.map((raw) => raw.trim())
		.filter((text) => text !== '')
		.map((text) => ({
			text,
			charLength: text.length,
			startsWithActionVerb: startsWithActionVerb(text),
			isQuantified: isQuantified(text)
		}));
}

function specialCharRatio(text: string): number {
	if (text.length === 0) return 0;
	// Anything outside letters, digits and ordinary punctuation. A high ratio usually means
	// decorative glyphs or a mangled encoding, both of which trip strict parsers.
	const special = text.replace(/[a-z0-9\s.,;:!?'"()\-–—/&@#%$+*=[\]{}|\\<>~^_`]/gi, '');
	return special.length / text.length;
}

function countAllCapsLines(lines: string[]): number {
	return lines.filter((line) => {
		const trimmed = line.trim();
		if (trimmed.length < 3) return false;
		if (!/[A-Z]/.test(trimmed)) return false;
		// Must contain letters and be entirely uppercase.
		return trimmed === trimmed.toUpperCase() && /[A-Z]{2,}/.test(trimmed);
	}).length;
}

function countBulletStyles(lines: string[]): number {
	const glyphs = new Set<string>();
	for (const line of lines) {
		const glyph = bulletGlyphOf(line);
		if (glyph) glyphs.add(glyph);
	}
	return glyphs.size;
}

export function buildAnalysis(input: ScoringInput): ResumeAnalysis {
	const lines = input.resumeText.split('\n');
	const bullets = collectBullets(input);

	const quantifiedBulletCount = bullets.filter((b) => b.isQuantified).length;
	const actionVerbBulletCount = bullets.filter((b) => b.startsWithActionVerb).length;

	// Guarded: a resume with no bullets is exactly the input that produced NaN under PRD
	// §7.7's unguarded division (ADR 0001 §4).
	const avgBulletChars =
		bullets.length === 0 ? 0 : bullets.reduce((sum, b) => sum + b.charLength, 0) / bullets.length;

	const sectionSet: ReadonlySet<SectionType> = new Set(input.resumeSections);

	// Canonicalised once here so all six profiles match against identical vocabulary.
	const resumeTerms = buildResumeTermSet(uniqueTerms(input.resumeText), input.resumeSkills);

	const jdTerms = input.jobDescription
		? scoringTerms(parseJobDescription(input.jobDescription))
		: [];

	return {
		input,
		bullets,
		quantifiedBulletCount,
		actionVerbBulletCount,
		avgBulletChars,
		sectionSet,
		unknownSectionCount: input.sectionCounts.unknown,
		specialCharRatio: specialCharRatio(input.resumeText),
		allCapsLineCount: countAllCapsLines(lines),
		bulletStyleCount: countBulletStyles(lines),
		hasStructuredExperience: input.experience.length > 0,
		experienceHasDates:
			input.experience.length > 0 &&
			input.experience.some((e) => e.dates?.start != null || e.dates?.isCurrent === true),
		jdTerms,
		resumeTerms: [...resumeTerms]
	};
}
