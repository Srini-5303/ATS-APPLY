# How Resumes Are Scored — Per-Platform Breakdown

An analysis of the scoring logic in `ats-screener-main/src/lib/engine/`, covering how each of the
6 simulated ATS platforms (Workday, Taleo, SuccessFactors, iCIMS, Greenhouse, Lever) arrives at a
score.

There are **two independent scoring paths**, and they differentiate the platforms in completely
different ways.

---

## Path 1 — LLM scoring (primary)

`src/routes/scanner/+page.svelte:88` calls `scoreLLM()`, which POSTs to `/api/analyze`. The server
sends the prompt built by `buildFullScoringPrompt()` (`src/lib/engine/llm/prompts.ts:5`) to Gemini,
falling back to Groq.

That prompt embeds a research-derived specification for each platform:

- parser vendor (Workday proprietary, Taleo OCR, iCIMS HireAbility ALEX, Greenhouse in-house LLM,
  Lever proprietary, SuccessFactors Textkernel)
- what specifically breaks that parser
- matching strategy (literal vs. stemming vs. semantic vs. taxonomy normalization)
- native scoring mechanisms (e.g. Taleo's Req Rank / ACE, Greenhouse's Talent Matching)
- auto-reject behavior

The model returns all 6 `ScoreResult` objects directly.

**Key point:** the per-platform weights described in Path 2 are _not used at all_ on this path.
Differentiation comes from prompt instructions plus the calibration anchors and "CRITICAL RULES"
block (`prompts.ts:170-193`), e.g.:

- "Taleo and Greenhouse should NEVER be within 5 points of each other"
- "a 15-25 point spread between the highest and lowest scoring system is expected"
- "Taleo should score notably LOWER than average for most resumes"

`normalizeScoreResult()` (`src/lib/engine/llm/client.ts:97`) only clamps numbers to 0-100 and
coerces types — it does not recompute or validate any score. `passesFilter` is whatever the model
returned, judged against thresholds stated in the prompt (`prompts.ts:196-201`).

---

## Path 2 — Deterministic engine (fallback)

Used when every LLM provider fails or is rate-limited (`scanner/+page.svelte:101`).

`scoreResume()` (`src/lib/engine/scorer/engine.ts:10`) maps over `ALL_PROFILES` and for each profile
computes:

```
overall = clamp(0, 100, round( Σ(dimensionScore × weight) − Σ quirkPenalties ))
passesFilter = overall >= profile.passingScore
```

### The 6 dimension scorers

These are shared by all platforms; only three things vary per platform (`parsingStrictness`,
`keywordStrategy`, `requiredSections`).

| Dimension          | File                   | Computation                                                                                                                                                                                                                                                                                                          |
| ------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **formatting**     | `format-scorer.ts`     | Starts at 100, subtracts `basePenalty × parsingStrictness`. Base penalties: multi-column 15, tables 12, images 8, >2 pages 5, <150 words 10, >1500 words 3, special-char ratio >5% 8, >3 all-caps lines 3, >2 bullet styles 2. **`parsingStrictness` is the per-platform hook.**                                     |
| **keywordMatch**   | `keyword-matcher.ts`   | `(exactMatches + synonymMatches × 0.8) / totalJdTerms × 100`. **`keywordStrategy` is the per-platform hook** — `exact` stops after set membership; `fuzzy` adds the synonym DB; `semantic` adds substring/prefix matching (min length 3) plus a raw full-text search. Returns a flat **100 when no JD is supplied**. |
| **sections**       | `section-scorer.ts`    | `presentRequired / requiredSections × 100`. **`requiredSections` is per-platform.**                                                                                                                                                                                                                                  |
| **experience**     | `experience-scorer.ts` | `min(1, quantRatio/0.4)×40 + min(1, actionVerbRatio/0.7)×30 + bulletCount(≥8→30, ≥5→25, ≥3→20, else 10)`. Returns 0 if there are no bullets. Quantification detected by 9 regexes; action verbs matched against a 98-word set, first word only.                                                                      |
| **education**      | `education-scorer.ts`  | Additive: degree 30, institution 20, graduation year 15, field of study 15, GPA 10, honors 10. Flat 20 if the section is absent.                                                                                                                                                                                     |
| **quantification** | `engine.ts:86`         | `quantifiedBullets / totalBullets × 100` — re-derived from the experience scorer's output, so quantification is counted twice at different weights.                                                                                                                                                                  |

### Per-platform configuration

Sources: `src/lib/engine/scorer/profiles/*.ts`

|                        | Workday                                | Taleo   | SuccessFactors | iCIMS                          | Greenhouse            | Lever               |
| ---------------------- | -------------------------------------- | ------- | -------------- | ------------------------------ | --------------------- | ------------------- |
| vendor                 | Workday, Inc.                          | Oracle  | SAP SE         | iCIMS, Inc.                    | Greenhouse Software   | Lever (Employ Inc.) |
| `parsingStrictness`    | 0.90                                   | 0.85    | 0.85           | 0.60                           | 0.40                  | 0.35                |
| `keywordStrategy`      | exact                                  | exact   | exact          | fuzzy                          | semantic              | semantic            |
| weight: formatting     | .25                                    | .20     | .25            | .15                            | .10                   | .08                 |
| weight: keywordMatch   | .30                                    | **.35** | .25            | .30                            | .25                   | .22                 |
| weight: sections       | .15                                    | .15     | **.20**        | .15                            | .10                   | .10                 |
| weight: experience     | .15                                    | .15     | .15            | .20                            | .25                   | **.30**             |
| weight: education      | .10                                    | .10     | .10            | .10                            | .10                   | .10                 |
| weight: quantification | .05                                    | .05     | .05            | .10                            | **.20**               | **.20**             |
| `requiredSections`     | contact, experience, education, skills | same 4  | same 4         | contact, experience, education | experience, education | experience          |
| `passingScore`         | 70                                     | 65      | 65             | 60                             | 55                    | 50                  |

All six weight sets sum to exactly 1.0.

The strictness multiplier is where most of the spread comes from: a resume triggering every
formatting penalty (63 base points) loses ~14 overall points on Workday but only ~1.8 on Lever.

### Quirks (post-weighting adjustments)

Applied in `computeQuirkAdjustment()` (`engine.ts:105`). A **negative `penalty` value is a bonus**
(the code subtracts it). Each quirk also pushes a message into the suggestions list.

**Workday** (`workday.ts:22`)

- `-5` if more than 2 sections classified as `unknown`
- `-8` if page count > 2 (stacks on top of the formatting penalty for the same condition)

**Taleo** (`taleo.ts:22`)

- `-10` if a JD is present and fewer than 5 skills were detected
- `-8` if more than one of the 4 standard sections is missing

**SuccessFactors** (`successfactors.ts:22`)

- `-10` if no `19xx`/`20xx` year appears anywhere in the resume, else `-8` if no experience bullets
  were parsed (first match wins — only one of the two can fire)
- `-5 × (number of missing standard sections)`

**iCIMS** (`icims.ts:22`)

- `+5` bonus if 10 or more skills are listed

**Greenhouse** (`greenhouse.ts:22`)

- `+8` bonus if ≥40% of bullets are quantified — note this uses a _narrower_ regex than the
  experience scorer (only `%`, `$`, `Nx`/`N times`)
- `+3` bonus for a projects section

**Lever** (`lever.ts:22`)

- `+5` bonus if average bullet length is 60-150 characters
- `+3` bonus for a summary section

Net effect: Taleo and SuccessFactors can lose roughly 18-30 points to quirks alone, while
Greenhouse and Lever can _only_ gain (max +11 and +8). The deterministic path is therefore
structurally biased toward a strict-enterprise / lenient-startup spread before weights even apply.

### Suggestions

`generateSuggestions()` (`engine.ts:124`) emits rule-based strings triggered by thresholds:
formatting <70 (per-issue advice), keyword <60 with missing terms (plus an extra note for `exact`
platforms), any missing section, quantification ratio <0.3, action-verb ratio <0.5, education <50 —
then appends every quirk message.

### Score tiers (display only)

`classification.ts:14`: ≥80 Excellent (green), ≥60 Good (yellow), ≥40 Needs Work (orange),
<40 Poor (red). Independent of each platform's `passingScore`.

---

## Observations worth flagging

1. **No job description → keyword score is a flat 100** (`keyword-matcher.ts:19`). Taleo, with the
   highest keyword weight (.35), receives the largest free boost, inverting the intended
   "Taleo is hardest" ordering in no-JD mode.

2. **Taleo's pass threshold disagrees between the two paths** — 65 in `taleo.ts:53` vs. 75 in
   `prompts.ts:197`. An identical score passes on the fallback path and fails on the LLM path.

3. **Missing sections are penalized twice** on Taleo and SuccessFactors — once through the weighted
   `sections` dimension, again through a quirk.

4. **Quantification is double-counted** on every platform: once inside `experience.score` (worth up
   to 40 of its 100 points) and again as its own weighted dimension.

5. **Greenhouse's quantification bonus and the experience scorer disagree** on what counts as
   quantified, so a resume can score well on one and miss the bonus on the other.

---

## File map

```
src/lib/engine/scorer/
  engine.ts              # scoreResume / scoreAgainstProfile, weighting, quirks, suggestions
  types.ts               # ScoringInput, ScoreResult, ATSProfile, ATSQuirk
  format-scorer.ts       # formatting dimension (uses parsingStrictness)
  keyword-matcher.ts     # keyword dimension (uses keywordStrategy)
  section-scorer.ts      # sections dimension (uses requiredSections)
  experience-scorer.ts   # experience dimension + action verb / quantification patterns
  education-scorer.ts    # education dimension + degree level table
  classification.ts      # score → tier/label/color
  profiles/
    workday.ts  taleo.ts  successfactors.ts  icims.ts  greenhouse.ts  lever.ts
    index.ts             # ALL_PROFILES (ordered by market share/strictness), getProfile()

src/lib/engine/llm/
  prompts.ts             # buildFullScoringPrompt — the platform specs + calibration rules
  client.ts              # scoreLLM, normalizeScoreResult (clamp only)
  fallback.ts            # generateFallbackAnalysis — JD-analysis fallback, not ATS scoring
```
