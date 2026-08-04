# 0002 — Quirks apply to the dimension they measure

Status: accepted
Supersedes: nothing. Extends ADR 0001 §5.

## Context

Every quirk in PRD §7.9 was summed into one scalar and added to the overall score after the
weighted sum:

```ts
const overallScore = clampScore(weighted + adjustment);
```

That produced a report where the six platforms had six different overall scores sitting above
four identical dimension bars. On a strong resume only `formatting` and `keywordMatch` moved
at all; `sections`, `experience`, `education` and `quantification` were the same number six
times.

The signal was not missing. It was misattributed:

| Quirk                                                       | Measures       | Landed on |
| ----------------------------------------------------------- | -------------- | --------- |
| `successfactors.no-experience-dates`                        | experience     | overall   |
| `successfactors.no-structured-experience`                   | experience     | overall   |
| `lever.narrative-bullets`                                   | experience     | overall   |
| `taleo.low-skill-density`                                   | keywords       | overall   |
| `workday.non-standard-headers`                              | sections       | overall   |
| `taleo.missing-sections`, `successfactors.missing-sections` | sections       | overall   |
| `greenhouse.strong-quantification`                          | quantification | overall   |

A user reading the card could see that Taleo scored lower than Greenhouse but not which of the
six measurements disagreed, because none of them did.

Three of the six dimension scorers — `scoreExperience`, `scoreEducation`,
`scoreQuantification` — take only `analysis` and no profile. That part is deliberate and
stays: an ATS does not have its own opinion about whether a bullet starts with an action verb.
Platform-specific judgement belongs in the quirk table, which is data.

## Decision

`QuirkRule` gains an optional `dimension`. When set, the delta applies to that dimension's
sub-score and reaches the overall through the weighted sum. When absent — `workday.page-truncation`
costs whole pages of content, not one dimension's worth — it applies to the overall as before.

Three rules make this behave:

1. **Per-dimension bound.** `DIMENSION_QUIRK_MIN/MAX` (−25 / +15) applies to each bar
   separately rather than to the sum, so a harsh penalty on one dimension cannot be cancelled
   by a bonus on an unrelated one.

2. **Spill-through.** Whatever the bar cannot absorb still counts against the total. A resume
   with no sections at all sits at 0 on that bar, so Taleo's −24 for three missing sections
   would land on a floor and vanish — leaving the platform that punishes this hardest scoring
   _above_ the one that barely cares. The shortfall passes through to the overall at full
   strength, which is where it landed before routing existed.

3. **Inactive-dimension fallback.** When there is no job description and no identifiable
   industry, the keyword slot is dropped and its weight redistributed (ADR 0001 §1). A quirk
   routed there would contribute exactly nothing. `taleo.low-skill-density` is the whole reason
   Taleo scores low in general mode, so its delta falls back to the overall rather than
   disappearing.

Two new quirks use the mechanism for education, which was otherwise flat at 90 on every
platform: `taleo.abbreviated-degree` (−10) and `successfactors.abbreviated-degree` (−6). A
literal or OCR-based parser indexes the string it reads, and `M.S.` is not the token
`Master of Science`. Greenhouse and Lever declare no such rule because an LLM-based parser
resolves the two forms.

## Consequences

**Scores moved and the golden files were regenerated.** Direction is systematic: a dimension
delta now reaches the overall multiplied by that platform's weight for it, typically 0.05–0.35,
so mid-range penalties soften. Weak fixtures rose (`skills-three-column-list` Taleo 49 → 55),
strong ones fell slightly (`single-column-clean` iCIMS 84 → 81). One fixture crossed a
threshold: SuccessFactors on `skills-three-column-list` went 64 → 67 against a passing score of
65, flipping `passes` from false to true.

This is defensible — a quantification bonus _should_ be worth what the platform weights
quantification at, rather than a flat number of overall points regardless — but it is a real
loss of severity in the unsaturated middle. The lever for correcting it is the magnitudes in
the profile data, which is where calibration belongs. All ADR 0001 calibration anchors still
hold: the three-line stub stays inside 10–25, a strong resume inside 75–95, and the corpus
orders worst-to-best unchanged.

**What did not change.** The dimension scorers are still pure functions of `(analysis)` or
`(analysis, profile)` with no `switch (profile.id)` anywhere. Adding a seventh platform is
still one data file and one registry line.

**Still flat, legitimately.** On a resume with every standard section present, `sections` is
100 for all six because every profile's `requiredSections` is a subset of what is there. That
is a correct reading, not a defect — it differentiates the moment a section is missing.
