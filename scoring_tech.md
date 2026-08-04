# What Kind of AI / ML / NLP Is Actually Used

A technique-level analysis of `ats-screener-main/src/lib/engine/`. Companion to
[SCORING.md](./SCORING.md), which covers _what_ each platform scores; this document covers _how_
the analysis is performed.

---

## Executive summary

**There is no trained machine learning model anywhere in this codebase.** No embeddings, no vector
similarity, no classifier, no model weights, no parameters fitted to data, no fine-tuning.

The "AI" is exactly one thing: an **outbound call to a hosted LLM**, used as a zero-shot structured
JSON generator with a long research-grounded prompt. Everything underneath it is classical,
hand-authored, deterministic NLP — regular expressions, curated lexicons, dictionary lookups, and
geometric heuristics over PDF coordinates.

In one line: **LLM-as-judge on top of a hand-built expert system.**

| Layer                     | Technique class                                             | Trained?                   |
| ------------------------- | ----------------------------------------------------------- | -------------------------- |
| 1. Document analysis      | computational geometry, 1-D histogram clustering            | no                         |
| 2. Information extraction | regex gazetteers + typographic heuristics                   | no                         |
| 3. Lexical NLP            | tokenization, stopword filtering, n-grams, TF-IDF (unused)  | no                         |
| 4. Synonym matching       | hand-curated dictionary normalization                       | no                         |
| 5. Industry detection     | count-based argmax over a skills taxonomy                   | no                         |
| 6. Scoring                | hand-tuned linear model + saturating ramps + step functions | no                         |
| 7. LLM scoring            | zero-shot prompted generation (Gemini / Llama)              | pretrained, not tuned here |

---

## Layer 1 — Document analysis (geometric, not linguistic)

`src/lib/engine/parser/pdf-parser.ts` is the most algorithmically substantial part of the project.
`pdfjs-dist` yields raw text items carrying `(x, y, width, height)` transforms, and the code performs
its own layout reconstruction from those coordinates.

**Line reconstruction** (`pdf-parser.ts:103`)
Sort by page → y descending → x ascending, then group items whose y differs by ≤3px into one line.

**Space insertion** (`pdf-parser.ts:139`)
Gap-based rather than character-based: emit a space when
`gap > (glyphHeight × 0.5)`, i.e. roughly half a character width.

**Column detection** (`pdf-parser.ts:160`)
A **1-D histogram clustering** over x-positions — arguably the only real unsupervised algorithm in
the repo:

1. bin x-positions to the nearest 10px
2. keep bins containing more than 5% of all items ("significant clusters")
3. flag multi-column if any two adjacent surviving bins are more than 150px apart

**Table detection** (`pdf-parser.ts:188`)
Bucket items by y (rounded to 3px) to form candidate rows; a row qualifies if it holds ≥3 items with
≥2 inter-item gaps >30px; ≥3 qualifying rows ⇒ `hasTables`.

**Image detection** (`pdf-parser.ts:44`)
Scans the PDF **operator list** for `paintImageXObject` / `paintImageMaskXObject`, then filters to
images larger than 50×50px. Deliberately avoids `paintXObject`, which would false-positive on LaTeX
PDFs that embed glyphs as XObjects.

These booleans (`hasMultipleColumns`, `hasTables`, `hasImages`, `pageCount`, `wordCount`) drive the
entire `formatting` dimension of the deterministic scorer.

---

## Layer 2 — Information extraction (rule-based IE)

### Section detection — `parser/section-detector.ts`

A hybrid of **regex gazetteers and typographic heuristics**. 13 canonical section types, each with an
alternation pattern, e.g.:

```
experience: /^(experience|work\s*experience|professional\s*experience|
              employment(\s*history)?|work\s*history|relevant\s*experience|
              career\s*history)$/i
```

When no pattern matches, `isSectionHeader()` (`:35`) falls back to layout heuristics:

- all-caps + ≤5 words + no 3+ digit runs + preceded by a blank line
- ends with `:` and is short
- alpha-only + short + blank line before + content after

…plus an explicit **name guard** (`:63`): a 2-3 word title-case string matching `^[A-Z][a-z]+ [A-Z]`
is treated as a person's name, not a header. Content appearing before the first detected header is
assumed to be contact info (`:115`).

Anything unmatched is classified `unknown` — which is precisely what Workday's quirk penalizes.

### Field extraction — `parser/index.ts` and friends

- **Entry segmentation** (`splitIntoEntries:473`) — blank lines, plus date-bearing non-bullet lines,
  act as entry boundaries; a boundary only fires if the accumulating entry already contains bullets
- **Skills** (`extractSkills:431`) — delimiter splitting: strips bullet glyphs, handles
  `Category: skill1, skill2` by taking the post-colon remainder, splits on `[,|;•·▪]`, drops items
  ≥50 chars, dedupes case-insensitively
- **Contact** (`contact-extractor.ts`) — regex for email/phone/LinkedIn, positional heuristics for
  name and location
- **Dates** (`date-extractor.ts`) — regex range extraction and normalization
- **GPA / honors** (`index.ts:344`, `:352`) — regex probes

No sequence labeling, no CRF, no NER model. Pure pattern matching throughout.

---

## Layer 3 — Lexical NLP

### Tokenizer — `nlp/tokenizer.ts`

```
split on /[\s,;|]+/
  → strip leading/trailing punctuation, preserving internal . - # +   (so node.js, c#, c++ survive)
  → lowercase
  → drop a 121-word stopword list
  → drop tokens shorter than 2 chars
```

Also provides `extractNgrams(text, n)` (skipping n-grams that are entirely stopwords) and
`extractTerms()`, which unions unigrams + bigrams + trigrams.

**Notably absent: any stemming or lemmatization.** No Porter, no Snowball, no lemmatizer anywhere in
the repo. `managed` and `managing` are unrelated tokens.

### TF-IDF — `nlp/tfidf.ts` (present but not wired into scoring)

Textbook implementations exist:

- `computeTF` — `count / totalTokens`
- `computeIDF` — `log(N / (1 + df))`, the `+1` guarding division by zero
- `computeTFIDF` — target document against a corpus
- `computeKeywordOverlap` — set intersection ratio
- `extractKeyTerms` — top-N by TF (the comment at `:116` concedes IDF is meaningless on a single doc)

**However, none of this participates in scoring.** `computeTFIDF` and `extractKeyTerms` are only
exported and unit-tested. `computeKeywordOverlap` is consumed solely by `quickKeywordScore`
(`scorer/keyword-matcher.ts:107`), which is itself only called from `tests/unit/scorer/`. Nothing in
`scoreResume()` reaches TF-IDF.

CLAUDE.md lists "Custom TF-IDF" as an engine feature — accurate that it exists, but it is not in the
scoring path.

---

## Layer 4 — "Semantic" matching (dictionary, not vectors)

`nlp/synonyms.ts` is a **hand-curated table of ~200 synonym groups** covering technology, finance,
healthcare, marketing/sales, HR, project management, legal, supply chain, and general professional
terms:

```js
['amazon web services', 'aws'],
['certified public accountant', 'cpa'],
['electronic health record', 'ehr', 'electronic medical record', 'emr'],
```

Every variant is flattened into a `Map` pointing at the group's first entry (the canonical form), so
`getCanonical()` and `areSynonyms()` are O(1) lookups. This is **lexical normalization**, not
semantics — there is no distributional or embedding component.

The three matching strategies in `scorer/keyword-matcher.ts` are therefore:

| Strategy   | Platforms                      | Mechanism                                                                          |
| ---------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `exact`    | Workday, Taleo, SuccessFactors | `Set.has()` on normalized tokens only                                              |
| `fuzzy`    | iCIMS                          | + canonical-form equality via the synonym map                                      |
| `semantic` | Greenhouse, Lever              | + bidirectional substring containment (min length 3) + raw `resumeText.includes()` |

Scoring: `(exactMatches + synonymMatches × 0.8) / totalJdTerms × 100`.

The substring-containment step is a **poor-man's stemmer** — `"managed".includes("manage")` passes —
and is the only place morphological variation is handled at all. There is no embedding model and no
cosine similarity, despite the LLM prompt describing Greenhouse as using "semantic embedding
matching."

---

## Layer 5 — Taxonomy and industry classification

`nlp/skills-taxonomy.ts` is a 593-line categorized skills database, each entry shaped
`{ domain, industry, skills[] }`.

`detectIndustry()` (`:556`) is a **count-based argmax classifier**:

```
for each category:
    count = number of category.skills appearing as substrings of the text
sum counts per industry
return industries sorted by count, descending
```

No priors, no probabilities, no normalization for category size — a large category naturally
accumulates more hits. It is also substring-based against single-letter skills (`r`) and two-letter
ones (`go`, `as`), so `r` matches virtually any text and inflates the `technology` count.

Used by `job-parser/extractor.ts` and `llm/fallback.ts`. Not used by `scoreResume()`.

### Job description parsing — `job-parser/extractor.ts`

Rule-based throughout: tokenize → uni/bi/trigrams → `detectIndustry` → intersect terms against that
industry's skill list → plus 4 hardcoded regex batteries for tech/data/business/certification skills.
Required vs. preferred is decided by a **stateful line scan** (`categorizeSkills:101`): heading
regexes like `/(?:required|must have|minimum|essential)/` flip a flag, and skills mentioned while the
flag is set are bucketed accordingly. Uncategorized skills default to required. Experience level,
education requirement, and role type are each a short regex cascade.

---

## Layer 6 — Feature detectors and the scoring function

### Feature detection

`scorer/experience-scorer.ts` is **gazetteer + regex feature extraction**:

- a **98-word strong-action-verb set**, tested against the _first word only_ of each bullet
- **9 quantification regexes**: `\d+%`, `\$[\d,]+`, `\d+\s*(?:x|times)`, people counts, thing counts,
  rankings (`top 5`, `#1`), durations, large comma-grouped numbers, scaled numbers (`3 million`)

`scorer/education-scorer.ts` uses a **degree-level dictionary** (`phd: 5` … `certificate: 1`) plus
regex probes for institution (a title-case multiword phrase), graduation year, field of study, GPA,
and honors.

### The scoring math

A **hand-tuned linear model** with a few nonlinearities:

| Construct                    | Where                      | Form                                                                                     |
| ---------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| Weighted linear sum          | `engine.ts:82`             | `Σ(dimension × weight)`, 6 coefficients per platform, each set summing to 1.0            |
| Saturating ramp              | `experience-scorer.ts:162` | `min(1, ratio / target) × points` — quantification saturates at 40%, action verbs at 70% |
| Step function                | `experience-scorer.ts:166` | bullet count: ≥8→30, ≥5→25, ≥3→20, else 10                                               |
| Additive rubric              | `education-scorer.ts`      | 30 + 20 + 15 + 15 + 10 + 10                                                              |
| Penalty subtraction          | `format-scorer.ts`         | `100 − Σ penalties`                                                                      |
| Multiplicative platform gain | `format-scorer.ts`         | every penalty × `parsingStrictness` (0.35 – 0.90)                                        |
| Post-hoc rule adjustment     | `engine.ts:105`            | per-platform quirks, applied after weighting                                             |

Every coefficient was chosen by hand from platform research. Nothing is fit to data, nothing is
probabilistic, and nothing is calibrated against real ATS pass/fail outcomes. The result is fully
deterministic — identical input always yields an identical score.

---

## Layer 7 — The one piece of actual AI

`src/routes/api/analyze/providers.ts:187` assembles a provider fallback chain from environment
variables:

1. **Ollama** (local; `OLLAMA_MODEL`, default `llama3.2`) — placed first when configured, so a
   self-hoster with cloud keys still defaults to local inference
2. **Gemini 3.5 Flash Lite** — `generativelanguage.googleapis.com/v1beta`, `temperature: 0.3`,
   `topP: 0.85`, `responseMimeType: 'application/json'`
3. **Groq `llama-3.3-70b-versatile`** — cross-vendor last resort so a Google outage still scores

The technique is **zero-shot structured generation with an expert-persona, research-grounded
prompt**. `buildFullScoringPrompt()` (`llm/prompts.ts:5`, ~240 lines) supplies:

- a per-platform specification (parser vendor, failure modes, matching strategy, native scoring
  mechanism, auto-reject behavior)
- explicit **calibration anchors** — "a 3-line resume with just a name and email MUST score 10-25"
- **differentiation constraints** — "Taleo and Greenhouse should NEVER be within 5 points of each
  other"; "a 15-25 point spread is expected"
- a JSON schema by example

Low temperature for reproducibility; JSON mode to avoid having to salvage markdown fences. **No
function calling, no RAG, no retrieval, no few-shot examples, no fine-tuning.** The model's numbers
are accepted as authoritative — `normalizeScoreResult()` (`llm/client.ts:97`) only clamps to 0-100
and coerces types.

Three further prompts exist for the older `analyzWithLLM` path:

- `buildJDAnalysisPrompt` — structured requirement extraction from a JD
- `buildSemanticMatchPrompt` — asks for typed matches (`synonym` / `transferable` / `implied` /
  `contextual`) with confidence ≥0.6; conceptually the most interesting prompt in the repo
- `buildSuggestionsPrompt` — max 7 impact-sorted improvement suggestions

`llm/fallback.ts` (`generateFallbackAnalysis`) is a rule-based stand-in for _that_ path only — regex
cascades for experience level, education requirement, and role type, plus a 60-word common-word
filter. It does not produce ATS scores.

---

## Gaps between the described model and the implemented one

1. **No stemming anywhere.** The prompt attributes word stemming to Lever ("collaborating" matching
   "collaborate"), but the deterministic path has no stemmer — only substring containment, which
   approximates it accidentally.
2. **No embeddings anywhere.** The prompt attributes embedding-based semantic matching to Greenhouse
   and iCIMS; the implementation offers a dictionary and substring checks.
3. **TF-IDF is implemented but disconnected** from scoring (see Layer 3).
4. **`detectIndustry` substring false positives** from single- and two-letter skills (`r`, `go`).
5. **Two independent scoring paths** with different philosophies produce results in the same UI,
   distinguished only by a fallback flag. See [SCORING.md](./SCORING.md) for their divergences —
   including the Taleo threshold mismatch (65 vs. 75).

---

## Technique inventory by file

```
parser/pdf-parser.ts        computational geometry; x-histogram clustering; operator-list inspection
parser/docx-parser.ts       mammoth text extraction
parser/section-detector.ts  regex gazetteer + typographic heuristics + name guard
parser/index.ts             rule-based entry segmentation and field extraction
parser/contact-extractor.ts regex + positional heuristics
parser/date-extractor.ts    regex range extraction + normalization

nlp/tokenizer.ts            tokenization, 121-word stoplist, n-grams   (no stemmer)
nlp/tfidf.ts                TF, IDF, TF-IDF, set overlap               (not in scoring path)
nlp/synonyms.ts             ~200-group canonical-form dictionary
nlp/skills-taxonomy.ts      categorized skills DB + count-based argmax industry classifier

scorer/format-scorer.ts     penalty accumulation × strictness multiplier
scorer/keyword-matcher.ts   3-tier set / dictionary / substring matching
scorer/section-scorer.ts    set coverage ratio
scorer/experience-scorer.ts 98-verb gazetteer + 9 quantification regexes + saturating ramps
scorer/education-scorer.ts  degree-level dictionary + additive regex rubric
scorer/engine.ts            hand-tuned weighted linear sum + rule-based quirk adjustments

job-parser/extractor.ts     rule-based JD parsing; stateful required/preferred line scan
llm/prompts.ts              zero-shot prompt engineering with calibration anchors
llm/client.ts               transport + clamping only (no recomputation)
llm/fallback.ts             regex cascades for the JD-analysis path
routes/api/analyze/         provider chain, rate limiting, response cache
```
