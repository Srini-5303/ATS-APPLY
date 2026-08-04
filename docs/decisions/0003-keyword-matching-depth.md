# 0003 — Stemming, required-term weighting, and what we chose not to build

Status: accepted
Extends: ADR 0001 §1 (keyword scoring), ADR 0002 (quirk routing)

## Context

A technique audit of a sibling implementation (`scoring_tech.md`) catalogued the NLP techniques
available to a system of this shape and named five weaknesses. Three of them applied to us:
no stemming, a TF-IDF module wired to nothing, and no morphological handling of phrases. A
fourth — n-gram phrase extraction — was proposed as an improvement and turned out not to be
one.

## Decisions

### 1. A conservative stemmer, in the semantic strategy only

`nlp/stemmer.ts` strips a short ordered suffix list, undoubles a final consonant after
`ing`/`ed`, and drops a trailing `e` so `manage`, `managed`, `managing` and `management` all
reach `manag`.

It is deliberately not Porter. Porter's later steps rewrite endings aggressively, which is
right for document retrieval and wrong here: a false keyword match tells a candidate they are
covered when they are not, which is worse than reporting the gap. Tokens carrying internal
punctuation (`node.js`, `ci/cd`, `c++`, `.net`) and tokens under four characters pass through
untouched, and `ss`/`us`/`is`/`os` endings are protected so `business` and `analysis` survive.

**A test runs all 265 taxonomy skills through it and fails if any two collapse onto one stem.**
That audit is what justifies using a stemmer at all rather than trusting the rules by eye.

Placement matters twice over:

- **Not in `buildResumeTermSet`.** Folding there would make every matcher see identical input
  and `exact` could no longer differ from `semantic` — the defect that once gave all six
  platforms the same keyword score.
- **Not in `fuzzy`.** Stemming is Lever's documented mechanism; iCIMS's is taxonomy
  normalisation. Keeping them separate leaves a genuine middle tier: curated synonyms, no
  morphology.

Phrases are where it pays. Single-word plurals are largely enumerated in the synonym groups
already; nobody lists every inflection of every phrase, so `distributed system` now answers
`distributed systems` via a stemmed copy of the resume text.

### 2. Required terms outweigh preferred ones

The job parser has always separated `requiredSkills` from `preferredSkills` — a stateful scan
for "Requirements" against "Nice to have", with a term appearing in both counted as required.
`scoringTerms()` then flattened both into one array, so missing a hard requirement cost
exactly as much as missing a bonus.

`ResumeAnalysis` now carries `jdRequiredTerms`, and `scoreTargeted` weights required terms at
`REQUIRED_TERM_WEIGHT = 2`. **Both sides of the ratio are weighted**, so a resume matching
every required term and no optional one still scores well rather than being capped by the
count of things it was never asked for.

2 rather than something larger: a posting's "Nice to have" list is still signal a recruiter
screens on, and a weight high enough to make optional terms nearly free would let a resume
ignore half the posting and score in the nineties.

### 3. Every non-exact match is discounted

`creditedCount` applied `SYNONYM_CREDIT` to synonym hits. Partial-overlap hits fell through
the attribution check and scored as though they were literal — the _weakest_ mechanism paid no
penalty while the strongest curated one did. All loose matches now discount equally.

### 4. TF-IDF deleted

`nlp/tfidf.ts` was implemented, unit-tested and imported by nothing, while CLAUDE.md
advertised it as an engine feature.

IDF needs a corpus of job descriptions that does not exist at runtime — the repo has two
fixtures. Term frequency within a single posting is usable but is a weak proxy for exactly the
signal decision 2 now captures explicitly and better. Keeping a tested-but-unreachable module
that the docs promise is worse than either using it or removing it, so it is removed. It is
recoverable from git if a corpus ever exists.

## Rejected: n-gram phrase extraction

The obvious next move — extract bigrams and trigrams from the job description so multi-word
requirements outside the taxonomy are visible — was measured before being built.

On `backend-senior.txt` a stopword-delimited pass adds **46 phrases beyond what we extract
today, of which roughly four are real skills**: `event streaming platform`, `api design`,
`backend services`, `computer science`. The rest is `move billions`, `strong proficiency`,
`another event`, `equivalent practical`, `solid understanding`, `deep experience`. It also
emits fragments of phrases we already match correctly — `conversion rate` and
`rate optimization` alongside the intact `conversion rate optimization`.

Those 42 unmatched terms would inflate the keyword denominator on every targeted scan and fill
the user-facing missing-keywords list with nonsense. The taxonomy scan already catches every
genuine multi-word skill in both fixtures.

**The real gap was taxonomy coverage, not extraction.** The four legitimate phrases the audit
surfaced were added as synonym groups, which costs nothing at scoring time and carries no
noise.

## Consequences

Golden scores moved in both directions, and the directions are the informative part.

**Targeted mode fell** — `single-column-clean` against `backend-senior`, Workday 92 → 89 —
because the resume misses required terms and those now cost double. A suggestion appeared with
it: "Add the requirements this posting names that your resume does not."

**General mode rose slightly, and unevenly**: exact platforms +1 (the new taxonomy entries),
Greenhouse and Lever +3 (stemming as well). The gap between the strictest and most lenient
keyword matcher widened, which is the product's premise working rather than a regression.

All ADR 0001 calibration anchors hold.
