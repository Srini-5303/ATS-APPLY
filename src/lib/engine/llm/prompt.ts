import { ALL_PROFILES } from '../scorer/profiles';
import { DIMENSIONS, type ScoreResult } from '../types/scoring';

/**
 * Prompt construction for the refinement pass.
 *
 * Two things here are deliberate and load-bearing:
 *
 * 1. **The platform specifications and pass thresholds are generated from `ALL_PROFILES`.**
 *    PRD §8.2 restated them as prose and immediately disagreed with §7.9 — Taleo 75 vs 65,
 *    Greenhouse 50 vs 55. Generating the text makes that class of drift impossible
 *    (ADR 0001 §3).
 *
 * 2. **The model adjusts a baseline rather than inventing scores.** The deterministic engine
 *    has already produced calibrated numbers; the model's job is to apply judgement the rules
 *    cannot, bounded to ±MAX_ADJUSTMENT with stated evidence. This removes the 20–40 point
 *    discontinuity between the LLM and fallback paths, and plays to what models are actually
 *    good at (ADR 0001 §2).
 */

export const MAX_ADJUSTMENT = 15;

const RESUME_CHAR_CAP = 6000;
const JD_CHAR_CAP = 4000;

function platformSpecs(): string {
	return ALL_PROFILES.map((p) => {
		const weights = Object.entries(p.weights)
			.map(([k, v]) => `${k} ${v.toFixed(2)}`)
			.join(', ');

		return [
			`### ${p.system} (${p.vendor})`,
			`- Parser: ${p.meta.parserType}`,
			`- Philosophy: ${p.meta.philosophy}`,
			`- Parsing strictness: ${p.parsingStrictness.toFixed(2)} (1.00 = least forgiving)`,
			`- Keyword matching: ${p.keywordStrategy}`,
			`- Expects sections: ${p.requiredSections.join(', ')}`,
			`- Weights: ${weights}`
		].join('\n');
	}).join('\n\n');
}

function baselineTable(baseline: ScoreResult[]): string {
	return baseline
		.map((r) => {
			const dims = DIMENSIONS.map((d) => `${d}=${String(r.breakdown[d].score)}`).join(' ');
			return `- ${r.system}: overall ${String(r.overallScore)} (${dims})`;
		})
		.join('\n');
}

function truncate(text: string, cap: number): string {
	return text.length <= cap ? text : `${text.slice(0, cap)}\n[truncated]`;
}

export interface PromptInput {
	resumeText: string;
	jobDescription?: string;
	baseline: ScoreResult[];
}

export function buildRefinementPrompt({
	resumeText,
	jobDescription,
	baseline
}: PromptInput): string {
	const targeted = Boolean(jobDescription?.trim());

	return `You are an expert on how enterprise Applicant Tracking Systems parse and rank resumes.

A deterministic rule-based engine has already scored this resume against six platforms. Your
job is to REFINE those scores using judgement the rules cannot apply — reading quality,
seniority signals, whether achievements are credible and specific, and whether the experience
genuinely fits the target role.

## Hard rules

- Adjust each platform's overall score by AT MOST ${String(MAX_ADJUSTMENT)} points in either direction.
- Every adjustment must cite specific evidence from the resume. No generic advice.
- If the baseline looks right, return it unchanged. Not adjusting is a valid answer.
- Do not invent a score from scratch. You are correcting a measurement, not replacing it.
- Do not restate the baseline's own reasoning back as a suggestion.

## Mode

${
	targeted
		? 'TARGETED — score how well this resume matches the specific job description below.'
		: 'GENERAL — no job description. Score overall ATS readiness for the candidate’s apparent field.'
}

## The six platforms

${platformSpecs()}

## Baseline scores to refine

${baselineTable(baseline)}

## Resume

${truncate(resumeText, RESUME_CHAR_CAP)}
${targeted ? `\n## Job description\n\n${truncate(jobDescription ?? '', JD_CHAR_CAP)}` : ''}

## Output

Return ONLY valid JSON, no prose and no code fence, in exactly this shape:

{
  "results": [
    {
      "system": "Workday",
      "adjustment": -5,
      "reason": "One sentence citing specific evidence from the resume.",
      "suggestions": [
        {
          "summary": "Short actionable instruction",
          "details": ["Concrete detail referencing the candidate's actual content"],
          "impact": "critical|high|medium|low"
        }
      ]
    }
  ]
}

Include an entry for all six platforms, using exactly these names:
${ALL_PROFILES.map((p) => p.system).join(', ')}.`;
}

/**
 * Pass thresholds, exposed for documentation and tests.
 *
 * `passesFilter` is always recomputed from the profile server-side — the model is never asked
 * for it and its answer would be discarded anyway (ADR 0001 §3).
 */
export function passThresholds(): Record<string, number> {
	return Object.fromEntries(ALL_PROFILES.map((p) => [p.system, p.passingScore]));
}
