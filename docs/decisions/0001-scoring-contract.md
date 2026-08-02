# ADR 0001 — Scoring contract resolutions

**Status:** Accepted
**Date:** 2026-08-01
**Context:** `PRD.md` v0.4.0

The PRD is complete on surface area but contains internal contradictions that produce
user-visible nonsense if implemented literally. Several of them change core types, so they
are resolved here before any code is written. Each entry states the problem with the PRD
section that creates it, the decision, and why.

---

## 1. No-JD keyword scoring inflates and saturates

**Problem.** §7.5: "If no job description is provided, keyword matching is skipped (returns
100 as a neutral score)." §7.3 then multiplies that 100 by a weight of 0.22–0.35.

Three consequences, all bad:

- It is a free 22–35 points. Taleo has the _highest_ keyword weight (0.35), so it receives
  the _largest_ free boost — directly inverting §8.2's rule that Taleo should score notably
  lower.
- §7.10's keyword suggestion fires on `keywordMatch.score < 60`, so it can never fire in
  general mode. A resume-only scan yields zero keyword advice, ever.
- Every weight row in §7.9 sums to 1.0. A clean resume with no JD therefore scores
  **exactly 100 on all six platforms** — zero differentiation, which is the entire product
  premise. Worked: formatting 100, keyword 100 (neutral), sections 100, experience 100,
  education 100, quantification 100 → weighted sum 100 for every profile.

**Decision.** In general mode the keyword slot **keeps its weight** but is scored by
**industry-term coverage** instead of JD matching: detect the industry via `detectIndustry`
(§6.4), then measure what fraction of that industry's expected skill vocabulary
(`getIndustrySkills`) appears in the resume. This is a real signal, it is hard to max out,
and it keeps keyword suggestions reachable in general mode.

If industry detection fails (no industry clears the match threshold), drop the keyword term
and renormalise the remaining five weights to sum to 1.0: `w' = w / (1 - w_keyword)`.

**Why.** Preserves the weight vectors as authored, removes the inflation, restores spread,
and gives general mode genuine signal rather than a constant.

---

## 2. Deterministic and LLM paths are two different products

**Problem.** §7 and §8 specify two independent scorers with different calibration anchors
and different pass thresholds. The same resume scores 20–40 points apart depending on
whether the LLM answered — which is a function of rate-limit luck, cache state, and provider
uptime, not of the resume.

**Decision.** **The LLM refines; it never replaces.**

1. The client computes deterministic scores locally and renders them immediately (<100ms).
   `scoreResume()` is pure TypeScript and needs no server.
2. Those scores are sent to the LLM as an anchor. The prompt instructs the model to adjust
   each platform by **at most ±15**, and to state evidence for each adjustment.
3. If the LLM is unavailable, rate-limited, or times out, the user keeps the deterministic
   numbers already on screen. The fallback is seamless because it is the same number,
   unrefined.

**Why.** Eliminates the discontinuity structurally rather than trying to calibrate two
independent systems into agreement. It is also a better use of the model: LLMs are poor at
inventing calibrated absolute scores and good at justified relative adjustment. And the UX
is better — instant results with a labelled refinement beats a 30-second spinner.

---

## 3. Pass thresholds diverge between engine and prompt

**Problem.** §7.9 sets Taleo **65** and Greenhouse **55**. §8.2 item 7 tells the LLM Taleo
**≥75** and Greenhouse **≥50**. A resume can pass deterministically and fail via LLM on
identical input.

**Decision.** `PLATFORM_PROFILES` is the single source of truth. The prompt's threshold list
and platform-specification block are **generated from it** at build time, never hand-written.
`passesFilter` is always recomputed server-side from `profile.passingScore`; the model's
boolean is discarded. A snapshot test pins the generated prompt fragment.

**Why.** Makes the divergence structurally impossible to reintroduce. Hand-maintained prose
duplicating structured data always drifts.

---

## 4. `NaN` propagates from zero-bullet resumes

**Problem.** §7.7: `quantRatio = quantifiedBullets / totalBullets`. For a resume with no
bullets — exactly the "3-line / no structure" case §8.2 calls out as an anchor — this is
`0/0 = NaN`. Then `min(1, NaN/0.4) = NaN`, and `Math.max(0, Math.min(100, NaN))` is also
`NaN`. It reaches the UI and gets persisted. Same for `actionVerbRatio`.

**Decision.** Explicit zero-guards in every ratio, returning documented floors (bullet-count
sub-score 10 per §7.7's `< 3` tier; ratio-derived sub-scores 0). A `fast-check` property
test asserts `Number.isFinite(overallScore)` across generated inputs including empty
strings, zero bullets, and empty section lists.

**Why.** A property test is the right shape here — the failure is a whole class of degenerate
inputs, not one case.

---

## 5. Quantification is weighted twice and is invisible

**Problem.** §7.3's formula has six weighted terms including `quantificationScore`. But
quantification is _also_ 40 of experience's 100 points (§7.7). For Greenhouse that is
`0.25 × 0.40 + 0.20 = 0.30` — quantification drives ~30% of the total score. Meanwhile
§7.2's `ScoreBreakdown` has only five dimensions with no `quantification` field, and §12.2's
score card shows "5 mini horizontal bars" — so the dimension carrying up to 20% of the score
is absent from both the type and the UI.

**Decision.** Quantification becomes a **first-class standalone dimension**:

- Remove it from experience's sub-score. Experience's 100 points redistribute evenly to the
  two remaining sub-scores: **action verbs 50, bullet count 50**.
- Keep §7.9's quantification weight column exactly as authored — those rows already sum to
  1.0, so no weight vector changes.
- Add a sixth `quantification` field to `ScoreBreakdown` and a sixth bar to `ScoreCard`.
- `quantificationScore = min(100, (quantRatio / QUANT_SATURATION_RATIO) × 100)`. The PRD's
  implied 0.4 saturated too early — a resume with 100% quantified bullets scored the same as
  one with 40%. **Settled at 0.75** in the Phase 3 calibration pass: three bullets in four
  must carry a concrete result for full marks.

**Why.** Counted once, visible to the user, and tunable against real fixtures instead of a
guessed constant.

---

## 6. `ScoringInput` cannot express the quirks that depend on it

**Problem.** §7.1's `ScoringInput` lacks the data §7.9's quirks and §7.8's education scoring
require:

| Requirement                                                 | Missing                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| SuccessFactors: "no dates in experience entries"            | structured `ExperienceEntry[]` with `DateRange`                                |
| SuccessFactors: "no structured experience entries detected" | same                                                                           |
| Workday: "sections with `unknown` type > 2"                 | `resumeSections: string[]` cannot express a count                              |
| Greenhouse: "projects section present"                      | ambiguous from a flat string list                                              |
| Lever: "professional summary present"                       | same                                                                           |
| §7.8: degree / institution / year / field / GPA / honors    | only `educationText: string` — forces the scorer to re-parse, duplicating §5.8 |

**Decision.** `ScoringInput` carries the structured subset:

```ts
experience: ExperienceEntry[];
education: EducationEntry[];
projects: ProjectEntry[];
summary: string | null;
sectionCounts: Record<SectionType, number>;
```

**Why.** The parser already produces all of this (§5.8). Passing strings and re-parsing them
in the scorer would duplicate logic and let the two implementations drift.

---

## 7. Section score can exceed 100; `contact` is always present

**Problem.** §7.6: `score = present.length / requiredSections.length × 100`. If `present` is
all detected sections rather than the intersection with required, a resume with 8 sections
scored against Lever's 1 required section yields **800**.

Separately, §5.5 Pass 2 assigns all content before the first header to `contact`. So
`contact` is present for every non-empty resume, which means Workday/Taleo/SuccessFactors
effectively require 3 sections rather than 4, and Taleo's "each missing standard section:
−8" can never fire for it.

**Decision.** `present = required ∩ detected`, result wrapped in `min(100, …)`. Drop
`contact` from `requiredSections` — its presence is unconditional and therefore carries no
information. Contact quality is already assessed in the formatting dimension.

---

## 8. Provider timeouts exceed the function budget

**Problem.** §9.1 sets `maxDuration: 60`. §8.4 gives Ollama a **240s** timeout. §8.6 has the
client wait **65s**.

- Ollama can never complete inside the function budget. The platform kills the request at
  60s, so an Ollama-enabled request is guaranteed to fail _and_ the fallback never runs —
  strictly worse than not trying.
- Serial worst case without Ollama is 30 + 15 = 45s plus prompt build and network, which
  fits under 65s only barely, and only if each provider's timeout is actually enforced with
  a per-request `AbortSignal`.
- The client outliving the server (65s > 60s) means the user sees a network error rather
  than a clean fallback response.

**Decision.** A single **global deadline budget** of 55s computed once at request entry.
Each provider receives `min(itsConfiguredTimeout, remainingBudget − reserve)`; any provider
whose minimum viable time exceeds the remaining budget is skipped entirely. On budget
expiry the deterministic result is returned with `_fallback: true`, always before the
platform kills the function. Client timeout drops to **50s**, below the server budget.
`OLLAMA_TIMEOUT_MS` stays env-configurable (240s default) because it is legitimate for
self-hosted `adapter-node`, but it is always clamped by the deadline.

---

## 9. The 503 fallback path is unreachable by construction

**Problem.** §9.2 returns **503 "all LLM providers failed"**, but §4.1 and §8.1 both state
the rule-based fallback is "always available". If that is true, this 503 cannot happen.

**Decision.** `/api/analyze` always returns **200** with
`{ results, _provider: 'rule-based', _fallback: true }` when every provider fails. 503 is
reserved for genuine server faults. Combined with decision 2, the user never sees an empty
result state.

---

## 10. Section heuristics depend on a signal the extractor destroys

**Problem.** §5.5 heuristics A and C both require the line be "preceded by a blank line".
But §5.4 step 5 explicitly filters empty lines out of DOCX text, and §5.3's PDF line
reconstruction groups items by y-coordinate with no concept of a blank line at all. The
signal does not exist by the time the heuristics run.

**Decision.** The intermediate line representation carries the signal explicitly:

```ts
interface RawLine {
  text: string;
  page: number;
  y: number;
  xStart: number;
  xEnd: number;
  blankBefore: boolean;
}
```

For PDF, `blankBefore` is `true` when the y-gap to the previous line exceeds 1.5× the median
leading. For DOCX it is computed _before_ empty lines are filtered.

Also documented: explicit precedence between the four detection strategies when a line
matches more than one (dictionary match wins, then A, then B, then C).

---

## 11. The multi-column gap threshold is wrong by roughly 5×

**Problem.** §5.3 step 5 requires a ">150px gap" between x-clusters. pdf.js text coordinates
at scale 1.0 are in PDF user-space units of 1/72 inch, so 150 units is **2.08 inches**. A
real two-column resume gutter is 0.2–0.4 inches, i.e. 15–30 units. As specified this
heuristic detects almost no genuine two-column resumes.

Conversely a _single_-column resume with right-aligned dates (`Acme Corp .......... Jan 2023`)
produces exactly two x-clusters with a wide gap — a false positive. So the rule both
under- and over-triggers, in opposite directions. A false positive costs up to 13.5
formatting points on Workday plus a top-ranked suggestion telling the user to fix a layout
that is already correct.

Related defects in the same section: the 3px y-tolerance is not normalised to font size;
"round to 10px" has no cluster-merge step, so bullets at x=90 and text at x=100 land in
different buckets and "≥2 clusters" becomes trivially true; ">5% of items" is far too
permissive; and table detection has no minimum line count, so one 3-column skills line flags
`hasTables`.

**Decision.** Replace the clustering heuristic with a **projection-profile / whitespace-gutter**
method: find a vertical band that no text item crosses, spanning >60% of page height, with
≥15% of items on each side. Normalise all thresholds against
`page.getViewport({ scale: 1 }).width` rather than using absolute pixel values. Derive the
y-tolerance from median item height (`max(2, medianHeight × 0.4)`). Require ≥3 consecutive
table-like lines before setting `hasTables`.

Every threshold is a named exported constant carrying a comment naming the fixture that
justifies its value. The fixture corpus (Phase 2) is what makes this tunable —
`two-column-true.pdf` must be detected and `right-aligned-dates.pdf` must not.

---

## 12. The phone regex matches date ranges

**Problem.** §5.6's pattern is
`/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/`. Every group is optional, so the
effective minimum match is `\d{3}[-.\s]?\d{4}` — seven digits with one optional separator.

Against `"2015 2019"`, an extremely common resume date range: `\d{3}` matches `015`, the
separator matches the space, and `\d{4}` matches `2019`. The date range is extracted as a
phone number. It also matches `115-1234` inside a ZIP+4 such as `02115-1234`.

**Decision.** Anchor with `\b`, require a plausible total digit count (10, or 11 with a
country code), and reject candidates whose digit groups parse as a valid year pair.

Also unified: §5.6 describes a name as "2–5 alphabetic words" while §5.5 heuristic C excludes
"2–3 TitleCase words" as a name. Both use 2–5.

---

---

## Calibration outcome (Phase 3)

Measured across the committed fixture corpus once all six dimensions were live. General mode
(no job description):

| Fixture                  | Average | Spread |
| ------------------------ | ------- | ------ |
| three-line-stub          | 14.0    | 29     |
| all-caps-headers         | 50.8    | 29     |
| two-column-true          | 63.5    | 16     |
| with-logo-image          | 64.2    | 52     |
| skills-three-column-list | 65.8    | 27     |
| right-aligned-dates      | 84.3    | 34     |
| unicode-punctuation      | 85.2    | 31     |
| three-page               | 87.3    | 22     |
| single-column-clean      | 89.8    | 15     |

Both PRD §8.2 anchors are met: the three-line stub lands in the 10–25 band (it scored **58**
under a literal reading of §7.5), and a strong resume lands in 75–95. Spread of 15–52 spans
§8.2's 15–25 requirement.

Targeted mode on `single-column-clean`:

| Job description   | Keyword | Average | Taleo | Lever |
| ----------------- | ------- | ------- | ----- | ----- |
| backend-senior    | 76      | 95.5    | 91    | 100   |
| marketing-manager | 0       | 75.0    | 64    | 86    |

Taleo falls furthest on a keyword mismatch and Lever least, which is the behaviour §8.2 asks
for and the exact inversion of what §7.5-as-written produced.

These numbers are pinned by `tests/fixtures/expected/score/` and by the anchor assertions in
`tests/unit/integration/golden-scores.spec.ts`.

---

## Non-blocking issues, tracked but not resolved here

- **In-memory rate limiting and LRU cache do not work on Vercel Edge** (§9.3, §8.5). Instances
  are ephemeral and unshared, so the stated 10 RPM is really N×10 and cache hit rate is near
  zero. Both are now behind `RateLimiter` / `ResponseCache` interfaces with memory
  implementations in `src/lib/server/`; Vercel KV lands in Phase 7. The limit is not claimed in
  user-facing docs until it is real, and `/api/admin/rate-limit-stats` reports
  `scope: 'isolate'` so the numbers are not mistaken for deployment-wide.
- **Cache key omits provider tier and prompt version** (§8.5) — a weaker Groq answer would be
  served for 24h after Gemini recovers. **Resolved**: the key is
  `SHA-256(promptVersion + ':' + providerTier + ':' + prompt)` and fallback-tier answers get a
  1-hour TTL against the primary tier's 24.
- **`LLMAnalysis` and `ParsedJobDescription` are referenced but never defined** (§11.2,
  CLAUDE.md). **Resolved**: `ParsedJobDescription` is defined in `engine/job-parser`.
  `LLMAnalysis` was deleted rather than defined — under decision 2 the model returns bounded
  adjustments to an existing result set, not a parallel analysis object, so the type had no
  referent.
- **`mode: 'analyze-jd'` is validated in §14.3 but has no contract in §9.1.** **Resolved**:
  removed. Job descriptions are parsed client-side by the deterministic engine; there is no
  second server mode to specify.
- **`/docs/[...slug]` uses `realpath()`** (§14.4) which has no filesystem on Edge. Deferred
  with the docs site; when built, serve statically from `static/docs/` and delete the custom
  route, which removes the traversal vulnerability class entirely.
- **Telemetry endpoints are unauthenticated and client-sampled** (§9.4). Server-side sampling,
  body caps, and rate limits added in Phase 5.
- **`previousScanForComparison` is seeded from in-memory results** (§11.2), so the first scan
  of a session never shows a delta. Seeded from stored history in Phase 6.
- **`/history` is described as Firebase-only** (§12.1) while §15.2 gives anonymous mode a
  localStorage history. It renders in both.
