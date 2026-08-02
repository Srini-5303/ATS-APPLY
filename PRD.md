# Product Requirements Document: ATS Screener

> Version 0.4.0 | Last updated: 2026-08-01  
> Purpose: Complete specification for recreating ATS Screener from scratch.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [User Personas & Use Cases](#2-user-personas--use-cases)
3. [Tech Stack & Rationale](#3-tech-stack--rationale)
4. [System Architecture](#4-system-architecture)
5. [Parser Specification](#5-parser-specification)
6. [NLP Pipeline](#6-nlp-pipeline)
7. [Scoring Engine](#7-scoring-engine)
8. [LLM Integration](#8-llm-integration)
9. [API Specification](#9-api-specification)
10. [Authentication](#10-authentication)
11. [State Management](#11-state-management)
12. [UI Pages & Components](#12-ui-pages--components)
13. [Design System](#13-design-system)
14. [Security](#14-security)
15. [Data Persistence](#15-data-persistence)
16. [Environment Variables](#16-environment-variables)
17. [Non-Functional Requirements](#17-non-functional-requirements)
18. [Build, Test & Deploy](#18-build-test--deploy)

---

## 1. Product Overview

### 1.1 Problem

Job seekers apply through Applicant Tracking Systems (ATS) and are silently rejected before a human ever reads their resume. Existing "ATS checkers" are paywalled, generic, or simulate a fictional composite ATS that doesn't exist. Candidates have no way to know which specific enterprise platforms will reject them, why, or what to fix.

### 1.2 Solution

ATS Screener is a free, open-source web app that simulates how **6 real enterprise ATS platforms** parse, filter, and score a resume. Each platform has a distinct parser tolerance, keyword-matching strategy, and scoring weight profile based on documented research into their actual behavior.

### 1.3 Value Proposition

- Free (no paywall, no registration required in anonymous mode)
- Simulates 6 real platforms: Workday, Taleo, iCIMS, Greenhouse, Lever, SuccessFactors
- Two modes: general ATS readiness (resume only) or targeted match (resume + job description)
- Client-side file parsing — resume never uploaded, only extracted text is sent to LLM
- AI-powered scoring (Gemini / Groq) with deterministic rule-based fallback
- Scan history tracked across sessions; shareable results with dynamic OG image
- Self-hostable with Firebase or fully anonymous modes

### 1.4 Platforms Simulated

| Platform       | Vendor              | Market Share        | Parser Type                | Scoring Philosophy                            |
| -------------- | ------------------- | ------------------- | -------------------------- | --------------------------------------------- |
| Workday        | Workday Inc.        | ~40% Fortune 500    | Proprietary                | Strict, keyword-heavy, format-sensitive       |
| Taleo          | Oracle              | ~25% Fortune 500    | OCR-based (legacy)         | Literal keyword matching, auto-reject capable |
| iCIMS          | iCIMS               | ~15% Fortune 500    | ALEX NLP (grammar-based)   | AI semantic matching, role-fit scoring        |
| Greenhouse     | Greenhouse Software | Common in tech      | Fine-tuned LLM             | No auto-scoring, human-driven scorecards      |
| Lever          | Lever (Employ)      | Startups/mid-market | Proprietary (Sovren)       | Word stemming, no algorithmic scoring         |
| SuccessFactors | SAP                 | ~15% Fortune 500    | Textkernel (95%+ accuracy) | Joule AI stack ranking, profile-first         |

---

## 2. User Personas & Use Cases

### 2.1 Primary: Job Seeker

**Goal**: Understand why their resume fails ATS filters before applying, and get specific fixes.

**Scenarios**:

- Upload resume → view scores across all 6 platforms → identify weakest areas → apply suggestions
- Paste a job description → get targeted gap analysis → see which missing keywords matter most per platform
- Re-scan after editing resume → see score delta vs previous scan

### 2.2 Secondary: Career Coach / Recruiter

**Goal**: Advise clients on ATS optimization without guessing which system is in use.

**Scenarios**:

- Evaluate client's resume against 6 platforms simultaneously
- Export PDF report to share with client
- Use scan history to track improvement across sessions

---

## 3. Tech Stack & Rationale

| Layer               | Technology                | Version | Why                                                                            |
| ------------------- | ------------------------- | ------- | ------------------------------------------------------------------------------ |
| Framework           | SvelteKit 5               | 2.16.0  | SSR + CSR hybrid, file-based routing, ~15KB Svelte runtime                     |
| Language            | Svelte 5 (runes)          | 5.16.0  | `$state`/`$derived`/`$effect` replace writable stores; fine-grained reactivity |
| Type system         | TypeScript strict         | 5.7.0   | Zero implicit `any`; scoring engine is pure TS — type safety critical          |
| Build tool          | Vite 6                    | —       | Fast HMR, ES module worker support, code splitting                             |
| PDF parsing         | pdfjs-dist                | 4.10.38 | Browser-native PDF, Web Worker offload, coordinate-level text extraction       |
| DOCX parsing        | mammoth                   | 1.12.0  | Clean text + HTML extraction; table/image detection via HTML regex             |
| LLM primary         | Gemini 3.5 Flash Lite     | —       | Free tier (500 RPD, 250K TPM), 311 tok/s, covers full prompt in ~20s           |
| LLM fallback        | Groq Llama 3.3 70B        | —       | Free tier, 15s timeout budget, different provider for resilience               |
| LLM local           | Ollama                    | —       | Optional self-host, tried first to keep data local                             |
| Auth (hosted)       | Firebase Auth + Firestore | 12.12.1 | Google OAuth + email/password; Firestore for cross-device history              |
| Deployment          | Vercel (Edge adapter)     | —       | Zero cold-start Edge functions for LLM proxy                                   |
| UI animations       | motion                    | 12.0.0  | Spring/keyframe animations; Spotlight, ParticleField effects                   |
| UI headless         | bits-ui                   | 2.16.0  | Accessible headless primitives (dialogs, dropdowns)                            |
| PDF export          | jsPDF                     | 4.2.1   | Client-side PDF report generation                                              |
| OG image            | @vercel/og                | —       | Dynamic OG image generation for share links                                    |
| Testing (unit)      | Vitest                    | 3.2.4   | Fast, Vite-native, jsdom environment                                           |
| Testing (E2E)       | Playwright                | 1.49.0  | Chromium, Firefox, Mobile Chrome coverage                                      |
| Testing (component) | @testing-library/svelte   | 5.2.0   | DOM assertions for Svelte components                                           |
| Linting             | ESLint 9 (flat config)    | —       | TypeScript-ESLint strict + Svelte plugin                                       |
| Formatting          | Prettier 3                | —       | Tabs, single quotes, 100 char width                                            |
| Docs site           | Astro Starlight           | —       | Separate site built to `static/docs/`                                          |

---

## 4. System Architecture

### 4.1 High-Level Data Flow

```
┌──────────────────────────────────────────────────────────┐
│  Browser                                                  │
│                                                          │
│  Upload PDF/DOCX                                         │
│       │                                                  │
│       ▼ (Web Worker, client-side only)                   │
│  parseResume(file) ──► ParsedResume                       │
│       │                                                  │
│       ▼                                                  │
│  Build ScoringInput ◄── optional JobDescription          │
│       │                                                  │
│       ▼                                                  │
│  POST /api/analyze ──────────────────────────────────►   │
│                                                          │
└──────────────────────────────────────────────────────────┘
                                                           │
┌──────────────────────────────────────────────────────────┐
│  Server (Edge Function)                                   │
│                                                          │
│  Rate limiter (10 RPM / 200 RPD per IP)                  │
│       │                                                  │
│  Cache check (SHA-256(prompt) → 24h TTL, 200-entry LRU)  │
│       │                                                  │
│  LLM provider chain:                                     │
│    Ollama (local, optional, 240s timeout)                │
│    → Gemini 3.5 Flash Lite (30s timeout)                 │
│    → Groq Llama 3.3 70B (15s timeout)                    │
│    → rule-based fallback (synchronous, always available) │
│       │                                                  │
│  Returns: ScoreResult[] (6 platforms)                    │
└──────────────────────────────────────────────────────────┘
                                                           │
┌──────────────────────────────────────────────────────────┐
│  Browser (cont.)                                          │
│                                                          │
│  Normalize + render ScoreDashboard                       │
│  Save ScanHistoryEntry ──► Firestore | localStorage      │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Module Boundaries

```
src/
├── routes/                     SvelteKit pages + API handlers
│   ├── +layout.svelte/.server.ts  Root layout, auth mode resolution
│   ├── scanner/                Main app page
│   ├── history/                Scan history page
│   ├── login/                  Auth UI
│   ├── share/                  Public score snapshot
│   └── api/
│       ├── analyze/            LLM proxy (rate limit, cache, provider chain)
│       ├── admin/              Rate-limit stats (ADMIN_TOKEN protected)
│       ├── og/                 Dynamic OG image
│       ├── log-error/          Client error reporting
│       ├── csp-report/         CSP violation logging
│       └── vitals/             Web Vitals collection
│
├── lib/
│   ├── engine/                 PURE TYPESCRIPT — zero UI dependencies
│   │   ├── parser/             PDF/DOCX parsing, section detection
│   │   ├── scorer/             Scoring engine + 6 ATS platform profiles
│   │   ├── nlp/                Tokenizer, TF-IDF, synonyms, skills taxonomy
│   │   ├── llm/                Gemini client, fallback, prompts, types
│   │   └── job-parser/         Job description extraction
│   │
│   ├── stores/                 Svelte 5 rune-based state management
│   │   ├── resume.svelte.ts
│   │   ├── scores.svelte.ts
│   │   ├── auth.svelte.ts
│   │   ├── settings.svelte.ts
│   │   └── jd-library.svelte.ts
│   │
│   ├── components/             Svelte UI components
│   │   ├── landing/            Hero, Features, HowItWorks, Footer, LogoMarquee
│   │   ├── scoring/            ScoreDashboard, ScoreCard, ScoreBreakdown
│   │   ├── upload/             ResumeUploader, JobDescriptionInput
│   │   └── ui/                 Navbar, AuthButton, UserMenu, animated effects
│   │
│   ├── server/                 Server-only (never imported client-side)
│   │   ├── auth/               Auth mode config, admin token guard
│   │   └── csp.ts              CSP header builder
│   │
│   └── styles/                 Global CSS tokens and reset
│       ├── tokens.css
│       └── global.css
│
└── hooks.server.ts             Security headers
```

### 4.3 Auth Mode Resolution

Auth mode is resolved **server-side** in `+layout.server.ts` and passed to all client pages via layout data. This prevents hydration mismatches and ensures the client never has to discover its own auth mode.

```
PUBLIC_FIREBASE_PROJECT_ID set? → mode = 'firebase'
  └─ No →
  mode = 'none'      (anonymous self-host)
```

---

## 5. Parser Specification

### 5.1 Entry Points

```typescript
// Async, handles File object from <input type="file"> or drag-drop
parseResume(file: File): Promise<ParseResult>

// Synchronous, for pasted plain text
parseResumeText(text: string): ParseResult

interface ParseResult {
  success: boolean;
  resume: ParsedResume | null;
  errors: string[];
  warnings: string[];
}
```

**Dynamic import strategy**: pdfjs-dist (~700KB) and mammoth (~250KB) are dynamically imported only when a file of the matching type is uploaded. This keeps the initial bundle ~1.1MB lighter.

### 5.2 ParsedResume Type

```typescript
interface ParsedResume {
  rawText: string;
  lines: string[];
  contact: ContactInfo;
  sections: ResumeSection[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  skills: string[];
  summary: string | null;
  metadata: {
    fileType: 'pdf' | 'docx' | 'text';
    pageCount: number;
    wordCount: number;
    lineCount: number;
    hasMultipleColumns: boolean;
    hasTables: boolean;
    hasImages: boolean;
  };
}
```

### 5.3 PDF Parser (pdfjs-dist)

**Library**: pdfjs-dist v4.10.38, runs in Web Worker (never blocks main thread).

**Processing pipeline**:

1. Load: `pdfjsLib.getDocument({ data: ArrayBuffer })`
2. Per page: `page.getTextContent()` → extract items with `(x, y, width, height, pageIndex)`
3. Image detection: `page.getOperatorList()` — scan for `paintImageXObject` / `paintImageMaskXObject`; exclude items < 50px (font glyphs)
4. Line reconstruction: group items within **3px y-tolerance**; sort by x within each line
5. Multi-column detection: cluster x-positions (round to 10px), require ≥2 clusters with **>150px gap** between them, each cluster holding >5% of items
6. Table detection: group items by y (3px tolerance), count lines with ≥3 items and ≥2 gaps >30px

**Output**: `{ text: string, lines: string[], pageCount: number, hasMultipleColumns: boolean, hasTables: boolean, hasImages: boolean }`

### 5.4 DOCX Parser (mammoth)

**Library**: mammoth v1.12.0.

1. `mammoth.extractRawText({ arrayBuffer })` → plain text
2. `mammoth.convertToHtml({ arrayBuffer })` → HTML string for structure
3. Table detection: `/\<table[\s>]/i` on HTML
4. Image detection: `/\<img[\s>]/i` on HTML
5. Split text on `\n`, trim each line, filter empty

**Limitation**: No multi-column detection for DOCX (mammoth flattens layout).

### 5.5 Section Detection

**13 section types**: `contact | summary | experience | education | skills | projects | certifications | awards | publications | volunteer | languages | interests | unknown`

**Detection algorithm** (two-pass):

Pass 1 — find all section headers:

1. Strip trailing `[:\-_|]`, lowercase → match against `SECTION_PATTERNS` dictionary (case-insensitive regex per type)
2. Fallback heuristic A: ALL_CAPS + ≤5 words + no 3-digit number sequences + preceded by blank line
3. Fallback heuristic B: line ends with colon + ≤5 words
4. Fallback heuristic C: alpha-only + ≤5 words + blank line before + has content after + NOT a name (2–3 TitleCase words)

Pass 2 — extract content:

- Content between consecutive headers is assigned to the preceding header's section type
- Content before the first detected header → 'contact' section

**Example patterns per type**:

- Experience: `work experience|professional experience|employment history|work history|career history`
- Education: `education|educational background|academic|qualifications`
- Skills: `skills|technical skills|core competencies|proficiencies|expertise`

### 5.6 Contact Extraction

Search scope: first 15 lines. Collapse multiple spaces, handle PDF ligatures.

| Field    | Pattern                                                                |
| -------- | ---------------------------------------------------------------------- |
| Email    | `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/`                     |
| Phone    | `/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/`           |
| LinkedIn | Fuzzy URL match (handles PDF-mangled spaces, missing dots)             |
| GitHub   | HTTPS URL containing `github.com`                                      |
| Website  | HTTPS URL (excluding LinkedIn, GitHub)                                 |
| Name     | 2–5 alphabetic words in first 5 lines, excluding email/phone/URL lines |
| Location | `City, ST` / `City, State` / `City, ST ZIP` / `City, Country`          |

```typescript
interface ContactInfo {
  name: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  github: string | null;
  website: string | null;
  location: string | null;
}
```

### 5.7 Date Extraction

**6 regex patterns** with span tracking to prevent overlapping matches:

| Pattern                   | Example                                         |
| ------------------------- | ----------------------------------------------- |
| Month Year – Month Year   | `Jan 2023 – Dec 2024`                           |
| MM/YYYY – MM/YYYY         | `01/2023 – 12/2024`                             |
| Year – Year               | `2023 – 2024`                                   |
| Season Year – Season Year | `Spring 2023 – Fall 2024`                       |
| Standalone Month Year     | `Jan 2023`                                      |
| Current indicators        | `Present`, `Current`, `Now`, `Ongoing`, `Today` |

**Normalization**:

- `MM/YYYY` → `YYYY-MM` (zero-padded)
- `Month Year` → `YYYY-MM` (lookup table of full + abbreviated month names)
- `Season Year` → `YYYY-MM` (Spring→03, Summer→06, Fall→09, Winter→12)
- `Year only` → `YYYY`

```typescript
interface DateRange {
  start: string | null; // "YYYY-MM" or "YYYY"
  end: string | null;
  isCurrent: boolean;
}
```

### 5.8 Structured Entry Extraction

**Experience entries**:

- Split section on blank lines + lines containing date ranges
- Parse header: `Title | Company`, `Title at Company`, `Title, Company`, two-line format
- First line → date extraction; subsequent non-bullet lines → title/company parsing
- Remaining lines → bullets (strip leading `•`, `-`, `*`, `–`)

**Education entries**:

- Match degree: regex for PhD, Doctor, Master, MBA, MS, MA, Bachelor, BS, BA, B.Eng, Associate, AA, AS, Certificate, Diploma
- Field: word(s) following "in" or "of" keywords
- Institution: remaining text after degree + field extraction
- GPA: `/gpa|g\.p\.a\./i` followed by a decimal number
- Honors: keyword match — `cum laude`, `magna cum laude`, `summa cum laude`, `dean's list`, `honors`, `distinction`

**Projects entries**:

- Tech stack: from `(tech1, tech2)` parentheses or `Technologies:` prefix
- URL: first HTTPS URL in entry
- Bullets: all remaining lines

**Skills extraction**:

- Separators: comma, pipe (`|`), semicolon, bullet
- Category prefixes stripped: `Frontend:`, `Backend:`, etc.
- Case-insensitive deduplication

---

## 6. NLP Pipeline

### 6.1 Tokenizer

```
Input text
  → split on [\s,;|]+
  → strip leading/trailing punctuation (preserve internal hyphens and dots)
  → lowercase
  → filter 122 English stop words (a, an, the, and, or, in, on, at, to, for, of, with, ...)
  → filter length < 2
  → output Token[]
```

```typescript
interface Token {
  raw: string;
  normalized: string;
  position: number;
}
```

### 6.2 TF-IDF

Used for keyword importance weighting in job description analysis.

```
TF(term, doc)  = count(term in doc) / total_tokens(doc)
IDF(term, corpus) = log(N / (1 + document_frequency(term)))  // Laplace smoothing
TF-IDF(term, doc, corpus) = TF × IDF
```

### 6.3 Synonym Database

200+ synonym groups across 12 industries. The **canonical form** is the first variant in each group.

**Technology domain**:

- Programming: `javascript | typescript | js | ts`, `python | py`, `c++ | cpp`, `c# | csharp`, `go | golang`, etc.
- Frameworks: `react | react.js | reactjs`, `angular | angularjs`, `vue | vue.js | vuejs`, `node.js | nodejs | node`, `next.js | nextjs`, etc.
- Databases: `postgresql | postgres | pg`, `mongodb | mongo`, `redis`, `elasticsearch | elastic`, `dynamodb`, etc.
- Cloud/DevOps: `aws | amazon web services`, `gcp | google cloud`, `azure | microsoft azure`, `docker | containers`, `kubernetes | k8s`, etc.
- Data/ML: `machine learning | ml`, `tensorflow | tf`, `pytorch | torch`, `pandas`, `scikit-learn | sklearn`, etc.

**Finance domain**: CPA/CFA/FRM, GAAP/IFRS, AP/AR, P&L, ROI, DCF, M&A, IPO, PE, VC, AML, KYC, SAP/Oracle ERP, Bloomberg

**Healthcare domain**: EHR/EMR/Epic, HIPAA, ICD-10/CPT, RN/LPN/NP/PA, BLS/ACLS, FDA/GMP/GCP

**Marketing domain**: SEO/SEM/PPC, CRM/Salesforce/HubSpot, Google Analytics/GA4, A/B testing/CRO, CLV/NPS/MQL/SQL

**Sales, HR, PM, Legal, Operations, Education, Design domains** also included.

### 6.4 Skills Taxonomy

14 industry categories with nested domains:

```
detectIndustry(text: string): { industry: string; matchCount: number }[]
getIndustrySkills(industry: string): string[]
getSkillDomain(skill: string): string | null
normalizeTerms(terms: string[]): string[]   // deduplicates via canonical forms
```

---

## 7. Scoring Engine

### 7.1 Input Type

```typescript
interface ScoringInput {
  resumeText: string;
  resumeSkills: string[];
  resumeSections: string[]; // detected section type names
  experienceBullets: string[]; // all bullet text across all experience entries
  educationText: string; // raw education section text
  hasMultipleColumns: boolean;
  hasTables: boolean;
  hasImages: boolean;
  pageCount: number;
  wordCount: number;
  jobDescription?: string;
}
```

### 7.2 Output Types

```typescript
interface ScoreResult {
  system: string; // e.g. "Workday"
  vendor: string; // e.g. "Workday Inc."
  overallScore: number; // 0–100
  passesFilter: boolean; // overallScore >= profile.passingScore
  breakdown: ScoreBreakdown;
  suggestions: Suggestion[];
}

interface ScoreBreakdown {
  formatting: {
    score: number;
    issues: string[];
    details: string[];
  };
  keywordMatch: {
    score: number;
    matched: string[];
    missing: string[];
    synonymMatched: string[];
  };
  sections: {
    score: number;
    present: string[];
    missing: string[];
  };
  experience: {
    score: number;
    quantifiedBullets: number;
    totalBullets: number;
    actionVerbCount: number;
    highlights: string[];
  };
  education: {
    score: number;
    notes: string[];
  };
}

interface Suggestion {
  summary: string;
  details: string[];
  impact: 'critical' | 'high' | 'medium' | 'low';
  platforms: string[];
}
```

### 7.3 Overall Score Formula

```
overallScore = clamp(0, 100, round(
  formatting.score    × weights.formatting         +
  keywordMatch.score  × weights.keywordMatch        +
  sections.score      × weights.sectionCompleteness +
  experience.score    × weights.experienceRelevance +
  education.score     × weights.educationMatch      +
  quantificationScore × weights.quantification      +
  quirkAdjustment
))
```

Where `quirkAdjustment` is the sum of platform-specific bonuses/penalties (see §7.9).

### 7.4 Formatting Score

**Model**: Deduction (start at 100, subtract penalties). Each penalty is multiplied by the platform's `parsingStrictness` (0–1).

| Issue                                 | Base Penalty     |
| ------------------------------------- | ---------------- |
| Multi-column layout detected          | 15               |
| Tables detected                       | 12               |
| Images/graphics detected              | 8                |
| Page count > 2                        | 5                |
| Word count < 150                      | 10               |
| Word count > 1500                     | 3                |
| Special character ratio > 5% of chars | 8                |
| All-caps lines > 3                    | 3 per extra line |
| Inconsistent bullet styles            | 2                |

Positive signals (no penalty): clean single-column, no tables, no images, ≤2 pages, word count 300–800.

### 7.5 Keyword Match Score

```
score = min(100,
  (exactMatchCount + synonymMatchCount × 0.8) / totalJdTerms × 100
)
```

**Three matching strategies** (assigned per platform):

| Strategy   | How it works                                                                              |
| ---------- | ----------------------------------------------------------------------------------------- |
| `exact`    | Lowercase normalized tokens must match literally                                          |
| `fuzzy`    | Exact + synonym database lookup + canonical form matching                                 |
| `semantic` | Fuzzy + partial substring (contains, prefix, ≥3-char overlap, multi-word inclusion check) |

If no job description is provided, keyword matching is skipped (returns 100 as a neutral score — no penalty for missing JD).

### 7.6 Section Completeness Score

```
score = present.length / requiredSections.length × 100
```

Required sections per platform vary (see §7.8). Detection uses the section-detector output.

### 7.7 Experience Score (100 pts total)

**Quantification sub-score** (40 pts max):

```
quantRatio = quantifiedBullets / totalBullets
subScore = min(1, quantRatio / 0.4) × 40
```

9 quantification patterns:

- `\d+%` — percentages
- `\$[\d,]+` — dollar amounts
- `\d+\s*(?:x|times)` — multipliers
- `\d+\s*(?:users?|customers?|clients?|employees?|members?|team)` — people counts
- `\d+\s*(?:projects?|products?|applications?|systems?|services?)` — thing counts
- `(?:top|first|#)\s*\d+` — rankings
- `\d+\s*(?:hours?|days?|weeks?|months?|years?)` — time durations
- `\d{1,3}(?:,\d{3})+` — large numbers with commas
- `\d+\s*(?:million|billion|thousand|k|m|b)` — scaled numbers

**Action verb sub-score** (30 pts max):

```
actionVerbRatio = actionVerbBullets / totalBullets
subScore = min(1, actionVerbRatio / 0.7) × 30
```

100 strong action verbs (check if bullet starts with one of): achieved, accelerated, administered, advanced, analyzed, architected, automated, built, centralized, championed, collaborated, conceptualized, consolidated, contributed, converted, coordinated, created, decreased, delivered, designed, developed, directed, drove, eliminated, enabled, engineered, established, exceeded, executed, expanded, facilitated, founded, generated, grew, headed, identified, implemented, improved, increased, influenced, initiated, innovated, integrated, introduced, launched, led, leveraged, managed, maximized, mentored, migrated, modernized, negotiated, operated, optimized, orchestrated, organized, outperformed, overhauled, oversaw, pioneered, planned, presented, prioritized, produced, programmed, proposed, published, raised, recommended, redesigned, reduced, refactored, reformed, re-engineered, reorganized, replaced, researched, resolved, restructured, revamped, revolutionized, scaled, secured, simplified, spearheaded, standardized, streamlined, strengthened, supervised, surpassed, synchronized, trained, transformed, translated, unified, upgraded

**Bullet count sub-score** (30 pts max):

| Bullet Count | Points |
| ------------ | ------ |
| ≥ 8          | 30     |
| 5–7          | 25     |
| 3–4          | 20     |
| < 3          | 10     |

### 7.8 Education Score (100 pts total)

| Component                | Points |
| ------------------------ | ------ |
| Degree detected          | 30     |
| Institution name present | 20     |
| Year / date present      | 15     |
| Field of study present   | 15     |
| GPA present              | 10     |
| Honors present           | 10     |

Degree level scale (used for future relevance scoring):

| Level                      | Value |
| -------------------------- | ----- |
| PhD / Doctor               | 5     |
| Master / MBA / MS / MA     | 4     |
| Bachelor / BS / BA / B.Eng | 3     |
| Associate / AA / AS        | 2     |
| Diploma / Certificate      | 1     |

GPA logic: ≥3.5 → positive note; <3.0 → suggest omitting.

### 7.9 Platform Profiles

#### Weight Vectors

| Platform       | Formatting | Keywords | Sections | Experience | Education | Quantification |
| -------------- | ---------- | -------- | -------- | ---------- | --------- | -------------- |
| Workday        | 0.25       | 0.30     | 0.15     | 0.15       | 0.10      | 0.05           |
| Taleo          | 0.20       | **0.35** | 0.15     | 0.15       | 0.10      | 0.05           |
| iCIMS          | 0.15       | 0.30     | 0.15     | 0.20       | 0.10      | 0.10           |
| Greenhouse     | 0.10       | 0.25     | 0.10     | 0.25       | 0.10      | **0.20**       |
| Lever          | 0.08       | 0.22     | 0.10     | **0.30**   | 0.10      | **0.20**       |
| SuccessFactors | 0.25       | 0.25     | **0.20** | 0.15       | 0.10      | 0.05           |

All rows sum to 1.0.

#### Parser Strictness & Keyword Strategy

| Platform       | Strictness | Keyword Strategy | Pass Threshold | Required Sections                      |
| -------------- | ---------- | ---------------- | -------------- | -------------------------------------- |
| Workday        | 0.90       | exact            | 70             | contact, experience, education, skills |
| Taleo          | 0.85       | exact            | 65             | contact, experience, education, skills |
| iCIMS          | 0.60       | fuzzy            | 60             | contact, experience, education         |
| Greenhouse     | 0.40       | semantic         | 55             | experience, education                  |
| Lever          | 0.35       | semantic         | 50             | experience                             |
| SuccessFactors | 0.85       | exact            | 65             | contact, experience, education, skills |

#### Platform Quirk Adjustments

Applied AFTER the weighted sum, before clamping:

**Workday**:

- Sections with non-standard headers (`unknown` type) > 2: −5 pts
- Page count > 2: −8 pts (truncation risk documented by Workday)

**Taleo**:

- Detected skills count < 5: −10 pts (keyword density check, Boolean search reliance)
- Each missing standard section: −8 pts

**iCIMS**:

- Detected skills ≥ 10: +5 pts (skills taxonomy completeness bonus)

**Greenhouse**:

- Quantification ratio ≥ 40% of bullets: +8 pts
- Projects section present: +3 pts

**Lever**:

- Average bullet character length 60–150: +5 pts (narrative quality signal)
- Professional summary section present: +3 pts

**SuccessFactors**:

- No dates in experience entries: −10 pts
- No structured experience entries detected: −8 pts
- Each missing standard section: −5 pts

### 7.10 Suggestion Generation Logic

Suggestions are generated after scoring and ordered by impact level:

| Condition                    | Suggestion                                                              |
| ---------------------------- | ----------------------------------------------------------------------- |
| `formatting.score < 70`      | Remove multi-column layout, tables, graphics                            |
| `keywordMatch.score < 60`    | Add missing keywords from JD; note exact vs fuzzy strategy per platform |
| Required section missing     | Add that section; explain why ATS expects it                            |
| `quantRatio < 0.30`          | Add specific numbers, percentages, $ amounts                            |
| `actionVerbRatio < 0.50`     | Start bullets with strong action verbs                                  |
| `education.score < 50`       | Include degree, institution, graduation year                            |
| Platform quirk condition met | Platform-specific advice (e.g. keep to 2 pages for Workday)             |

---

## 8. LLM Integration

### 8.1 Architecture

The LLM layer is used **server-side only** (via `/api/analyze`). The client never calls LLM APIs directly. This hides API keys and enables caching and rate limiting.

When LLM is unavailable (rate-limited, timeout, all providers fail), the deterministic `scoreResume()` engine is used as fallback. The UI indicates when fallback mode is active.

### 8.2 Full Scoring Prompt (`buildFullScoringPrompt`)

Structure:

1. Inputs: resume text (capped at 6,000 chars) + optional JD text (capped at 4,000 chars)
2. Mode declaration: "targeted scoring" (with JD) or "general ATS readiness" (without)
3. 6-platform specifications — documented parser behavior, matching strategy, scoring philosophy
4. 5 scoring dimensions with per-dimension instructions
5. Calibration anchors:
   - 3-line / no structure resume: 10–25
   - Generic no-JD resume: 20–40
   - Decent resume: 50–70
   - Well-matched targeted resume: 75–95
6. Critical rules: scores must vary **15–25 points across platforms**; Taleo notably lower; no generic suggestions
7. Pass filter thresholds: Taleo ≥75, Workday ≥70, SuccessFactors ≥65, iCIMS ≥60, Greenhouse/Lever ≥50

**JSON output schema** (6 results, one per platform):

```json
{
  "results": [
    {
      "system": "Workday",
      "vendor": "Workday Inc.",
      "overallScore": 75,
      "passesFilter": true,
      "breakdown": {
        "formatting": { "score": 80, "issues": ["..."], "details": ["..."] },
        "keywordMatch": {
          "score": 70,
          "matched": ["..."],
          "missing": ["..."],
          "synonymMatched": ["..."]
        },
        "sections": { "score": 85, "present": ["..."], "missing": ["..."] },
        "experience": {
          "score": 75,
          "quantifiedBullets": 5,
          "totalBullets": 10,
          "actionVerbCount": 7,
          "highlights": ["..."]
        },
        "education": { "score": 90, "notes": ["..."] }
      },
      "suggestions": [
        {
          "summary": "...",
          "details": ["..."],
          "impact": "high",
          "platforms": ["Workday", "Taleo"]
        }
      ]
    }
  ]
}
```

### 8.3 Additional Prompts

**`buildJDAnalysisPrompt(jobDescription)`**:
Extracts: `requiredSkills[]`, `preferredSkills[]`, `experienceLevel`, `educationRequirement`, `industryContext`, `roleType`, `dealbreakers[]`

**`buildSemanticMatchPrompt(resumeText, jobDescription)`**:
Finds transferable/implied skills not literally present: `{ skill, resumeEvidence, confidence, matchType }`  
matchType: `synonym | transferable | implied | contextual`

**`buildSuggestionsPrompt(scores, resume, jd)`**:
Generates actionable per-platform improvement advice with before/after examples.

### 8.4 Provider Chain

| Priority     | Provider              | Timeout | Max Output Tokens | Auth                    |
| ------------ | --------------------- | ------- | ----------------- | ----------------------- |
| 1 (optional) | Ollama (local)        | 240s    | 16384 context     | `OLLAMA_API_KEY` bearer |
| 2            | Gemini 3.5 Flash Lite | 30s     | 6144              | `GEMINI_API_KEY`        |
| 3            | Groq Llama 3.3 70B    | 15s     | 3072              | `GROQ_API_KEY`          |

**JSON extraction**: Strip markdown code fences (` ```json ... ``` `), find first `{...}` block, `JSON.parse()`.

**Provider fallthrough**: Any HTTP error, timeout, or invalid JSON causes silent fallthrough to the next provider. All failures → rule-based fallback.

### 8.5 Response Caching

- **Key**: SHA-256 hash of the full prompt string (deterministic per resume+JD combination)
- **Store**: In-memory LRU Map, max 200 entries
- **TTL**: 24 hours
- **Eviction**: On cap reached, remove oldest entry (delete + re-insert to maintain LRU order on hit)
- **Response includes**: `_cached: true/false`, `_provider: string`, `_fallback: boolean`

### 8.6 Client-Side LLM Client (`scoreLLM`)

```typescript
type ScoreLLMResult =
  | { status: 'ok'; results: ScoreResult[]; provider: string; fallback: boolean }
  | { status: 'error' }
  | { status: 'rate_limited'; retryAfterSec: number }
  | { status: 'cancelled' };
```

- Client-side timeout: **65 seconds** (covers full provider chain + margin)
- `AbortController` passed to `fetch()`; cancelled on user reset
- 429 response → extract `Retry-After` header → `{ status: 'rate_limited', retryAfterSec }`
- Response normalization: clamp all scores 0–100, convert arrays (matched/missing) to strings, validate schema

---

## 9. API Specification

### 9.1 POST /api/analyze

**Route config**: `maxDuration: 60` (seconds, Vercel edge function limit)

**Request**:

```json
{
  "mode": "full-score",
  "resumeText": "string (max 50,000 chars)",
  "jobDescription": "string (max 20,000 chars, optional)"
}
```

**Processing sequence**:

1. Validate `Content-Type: application/json`
2. Validate request body (mode, resumeText length, jobDescription length)
3. Check minute rate limit (10 RPM per IP)
4. Check daily rate limit (200 RPD per IP)
5. Build prompt via `buildFullScoringPrompt(resumeText, jobDescription?)`
6. Hash prompt (SHA-256) → check LRU cache
7. If cache miss: call provider chain (Ollama → Gemini → Groq)
8. Store result in cache
9. Return JSON response

**Success response (200)**:

```json
{
  "results": [/* ScoreResult × 6 */],
  "_provider": "gemini-3.5-flash-lite",
  "_fallback": false,
  "_cached": false
}
```

**Security headers** added to all responses:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Cache-Control: no-store
```

### 9.2 Error Responses

| Status | Condition                                                     | Body                                                                                   |
| ------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 400    | Invalid input (wrong mode, text too long, missing resumeText) | `{ "error": "..." }`                                                                   |
| 429    | Rate limit exceeded                                           | `{ "error": "rate limit exceeded: ...", "retryAfter": 60 }` + `Retry-After: 60` header |
| 503    | All LLM providers failed                                      | `{ "error": "all LLM providers failed", "fallback": true }`                            |

### 9.3 Rate Limiting

```typescript
// Two separate Maps for minute and daily limits
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const dailyLimits = new Map<string, { count: number; resetAt: number }>();

const MAX_RPM = 10;
const MAX_RPD = 200;
```

**Algorithm**:

1. Check minute window: if `count >= MAX_RPM` and window not expired → 429
2. Check daily window: if `count >= MAX_RPD` and window not expired → 429 (does NOT consume minute slot)
3. Increment both counters
4. Throttled cleanup at 30-second intervals (only when Map > 10,000 entries)

### 9.4 Other API Routes

| Route                         | Method | Auth                 | Purpose                                                            |
| ----------------------------- | ------ | -------------------- | ------------------------------------------------------------------ |
| `/api/admin/rate-limit-stats` | GET    | `ADMIN_TOKEN` header | Current rate limit stats                                           |
| `/api/log-error`              | POST   | None                 | Client error reporting (sampled at `PUBLIC_ERROR_SAMPLE_RATE`)     |
| `/api/csp-report`             | POST   | None                 | CSP violation logging                                              |
| `/api/og`                     | GET    | None                 | Dynamic OG image (query params: score, pass count, platform names) |
| `/api/vitals`                 | POST   | None                 | Web Vitals data (sampled at `PUBLIC_VITALS_SAMPLE_RATE`)           |
| `/healthz`                    | GET    | None                 | Health check (returns 200 OK)                                      |

---

## 10. Authentication

### 10.1 Firebase Mode

**Triggered by**: `PUBLIC_FIREBASE_PROJECT_ID` set.

- Google OAuth (popup/redirect flow)
- Email/password with password reset email
- `onAuthStateChanged` listener in `AuthStore` drives reactive auth state
- Firestore security rules ensure `users/{uid}/scans` is accessible only by owner

**Scan history in Firestore**:

- Collection: `users/{uid}/scans`
- Documents pruned to max 5 (newest-first)
- Optional `scan_logs/{docId}` at admin-accessible collection, sampled at `PUBLIC_SCAN_LOG_SAMPLE_RATE`

### 10.2 Anonymous Mode

**Triggered by**: `PUBLIC_FIREBASE_PROJECT_ID` not set.

- No sign-in required; scanner is always accessible
- History: `localStorage` key `ats_local_scan_history_v1` (5-entry cap)
- No Firestore usage

### 10.3 Auth Store Hydration

The client `AuthStore` is initialized with `mode = 'none'` (or `'firebase'` if `firebaseConfigured`). On mount, the layout calls `hydrateFromServer(data)` to confirm the server-resolved mode. This prevents SSR/CSR hydration mismatches.

---

## 11. State Management

All stores use Svelte 5 rune syntax (`$state`, `$derived`, `$effect`) as class instances exported as singletons.

### 11.1 ResumeStore (`resume.svelte.ts`)

| State         | Type                  | Description             |
| ------------- | --------------------- | ----------------------- |
| `file`        | `File \| null`        | Uploaded file           |
| `parseResult` | `ParseResult \| null` | Output of parseResume() |
| `isParsing`   | `boolean`             | Parse in progress       |
| `error`       | `string \| null`      | Parse error message     |

Computed getters: `resume` (ParsedResume), `isReady` (boolean), `warnings`, `errors`

### 11.2 ScoresStore (`scores.svelte.ts`)

| State                       | Type                           | Description                             |
| --------------------------- | ------------------------------ | --------------------------------------- |
| `results`                   | `ScoreResult[]`                | 6 platform scores                       |
| `llmAnalysis`               | `LLMAnalysis \| null`          | Structured LLM output                   |
| `parsedJD`                  | `ParsedJobDescription \| null` | Parsed job description                  |
| `jobDescription`            | `string`                       | Raw JD text                             |
| `isScoring`                 | `boolean`                      | Scoring in progress                     |
| `llmFallback`               | `boolean`                      | Using rule-based fallback               |
| `llmRetryAtMs`              | `number \| null`               | Absolute timestamp for rate-limit retry |
| `error`                     | `string \| null`               | Scoring error                           |
| `scanHistory`               | `ScanHistoryEntry[]`           | Past scans                              |
| `isFromHistory`             | `boolean`                      | Viewing a historical scan               |
| `previousScanForComparison` | `ScanHistoryEntry \| null`     | For delta banner                        |

```typescript
interface ScanHistoryEntry {
  id: string;
  timestamp: string;
  mode: 'general' | 'targeted';
  averageScore: number;
  passingCount: number;
  results: ScoreResult[];
  fileName?: string;
  jobDescriptionSnippet?: string; // first 200 chars
}
```

Key method behaviors:

- `startScoring()` → creates `AbortController`, snapshots `previousScanForComparison` from current results
- `finishScoring(results, fileName)` → saves to history (Firestore or localStorage)
- `cancelScoring()` → aborts in-flight request via AbortSignal
- `loadFromHistory(entry)` → aborts in-flight, sets `isFromHistory = true`, populates results

### 11.3 AuthStore (`auth.svelte.ts`)

| State     | Type                   | Description               |
| --------- | ---------------------- | ------------------------- |
| `user`    | `User \| null`         | Firebase user object      |
| `mode`    | `'firebase' \| 'none'` | Server-resolved auth mode |
| `loading` | `boolean`              | Auth initialization       |
| `error`   | `string \| null`       | Auth error                |

Computed getters: `isAuthenticated`, `requiresAuth`, `disabled`, `displayName`, `email`, `initials`, `photoURL`

### 11.4 SettingsStore (`settings.svelte.ts`)

```typescript
selectedSystems: string[] = ['Workday', 'Taleo', 'SuccessFactors', 'iCIMS', 'Greenhouse', 'Lever'];
useLLM: boolean = true;
showDetailedBreakdown: boolean = false;
```

### 11.5 JDLibraryStore (`jd-library.svelte.ts`)

Saved job descriptions in `localStorage` under key `ats_jd_library_v1`.

```typescript
interface JDLibraryEntry {
  id: string;
  label: string;
  content: string;
  savedAt: number;
}
```

---

## 12. UI Pages & Components

### 12.1 Routes

#### `/` — Landing Page

Sections: Hero → LogoMarquee → Features → HowItWorks → CallToAction → Footer

- **Hero**: Large gradient headline ("Get Past ATS. Get the Interview."), subheading, "Scan Your Resume" CTA button
- **LogoMarquee**: Infinite-scroll carousel of 6 ATS platform logos
- **Features**: Bento grid of 6 differentiators (free, 6 platforms, client-side privacy, AI-powered, open-source, scan history)
- **HowItWorks**: 4-step flow with icons (Upload → Parse → Score → Results)
- **Schema.org JSON-LD**: `SoftwareApplication` structured data for SEO

#### `/scanner` — Main Application (most complex page, ~961 lines)

**Auth gate**: In Firebase mode, unauthenticated users see "Sign In to Scan" instead of the uploader.

**4-step visual progress indicator**: Upload → Parse → Scan → Results

**Upload section**:

- `ResumeUploader` component (drag-drop + click)
- Collapsible `<details>` textarea for pasting plain text
- `JobDescriptionInput` component (collapsible, optional)
- Warning/error display
- "Scan Resume" / "Re-Scan" / "Start Over" buttons

**Post-parse, pre-scan section**: Shows `ResumeStats` (word count, sections detected, skills found, dates)

**Scanning state**: `ScanningAnimation` component with animated particles

**Results section**: `ScoreDashboard` with fade-in transition

**History section**: Collapsible `ScanHistory` sidebar

**Visual design**: Two blurred gradient orbs (cyan, purple) as background decorations

#### `/history` — Scan History

- Firebase only: requires authentication
- Timeline of past scans (date, mode, average score, pass count)
- Journey stats (improvement over time via `ScoreTimeline`)
- Click any entry → view full ScoreDashboard snapshot
- Clear history button with confirmation dialog

#### `/login` — Authentication

- Firebase mode: Google OAuth button + email/password form + password reset flow
- Email normalization: `trim() + toLowerCase()` before submission

#### `/share` — Public Score Snapshot

- No authentication required
- Accepts query params: score, platform, pass count, delta (from previous scan)
- Dynamic OG image via `/api/og`
- Share-to-Twitter button (pre-filled intent URL)
- Copy link button

### 12.2 Key Component Specifications

#### ScoreDashboard (`scoring/ScoreDashboard.svelte`)

Layout:

1. **Summary card**: Average score (large), pass count badge, mini horizontal bar chart (all 6 platforms)
2. **Quick Wins band**: Top 3 suggestions ranked by impact, deduplicated across platforms
3. **View toggle**: "Grid" (6 cards side-by-side) ↔ "Breakdown" (tabbed detail view)
4. **Comparison band**: Shows score delta vs `previousScanForComparison` (hidden if no previous scan)
5. **Export PDF** button (jsPDF, client-side)
6. **Share to Twitter** button
7. **Fallback mode indicator** (when LLM rate-limited, shows "Using simplified scoring")

#### ScoreCard (`scoring/ScoreCard.svelte`)

- Platform name + vendor subtitle
- **Circular SVG progress ring** (stroke-dasharray animation on mount)
- **Score delta pill**: `+7` or `-3` vs previous scan; hidden if delta is 0 or no previous scan
- **Status badge**: "Likely to Pass" (green) / "May Be Filtered" (red/amber)
- **5 mini horizontal bars**: formatting, keywords, sections, experience, education scores
- **Keyword chips**: matched (green), missing (red/outlined)
- **Spotlight glow effect**: Mouse-tracking radial gradient follows cursor inside card bounds

#### ResumeUploader (`upload/ResumeUploader.svelte`)

- Drag-and-drop zone with `dragover`/`dragleave`/`drop` event handlers
- Click → programmatic `<input type="file">` trigger
- File validation: MIME type (`application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`) + max 10MB
- Keyboard accessible: Enter/Space trigger file picker
- States: idle → uploading → parsing (spinner) → parsed (filename + size + checkmark) → error

#### JobDescriptionInput (`upload/JobDescriptionInput.svelte`)

- Toggle button to expand/collapse
- Textarea (debounced 400ms) → triggers `parseJobDescription()` on change
- **Live preview**: extracted skills, experience level, role type displayed below textarea
- **Match indicator**: which extracted JD skills exist in resume (green chip) vs missing (gray chip)
- **JD Library**: "Save" button → label prompt → stored in `JDLibraryStore`; modal to browse/load/delete saved JDs

### 12.3 Animated UI Components

| Component                       | Effect                                           |
| ------------------------------- | ------------------------------------------------ |
| `Spotlight.svelte`              | Mouse-tracking spotlight beam on dark background |
| `ParticleField.svelte`          | Floating animated particles                      |
| `Meteors.svelte`                | Falling meteor streak animation                  |
| `TypewriterEffect.svelte`       | Character-by-character text reveal               |
| `AnimatedBorderGradient.svelte` | Rotating gradient border                         |
| `FlipWords.svelte`              | Word flip/rotation animation                     |
| `AnimatedCounter.svelte`        | Count-up number animation                        |
| `TextGenerateEffect.svelte`     | Word-by-word text generation                     |
| `EncryptedText.svelte`          | Scramble-then-reveal text effect                 |
| `MovingBorder.svelte`           | Animated border sweep                            |
| `TracingBeam.svelte`            | Scroll-tracking line tracing                     |

### 12.4 Navbar

- Fixed top, glassmorphic background (`backdrop-filter: blur`)
- Left: Logo
- Center: Cmd+K / Ctrl+K → `SearchModal` (full-text docs search)
- Right: Home, Scanner, About, Docs, GitHub links + "Scan Now" CTA + auth slot
- Mobile: hamburger → slide-down menu
- Auth slot: `UserMenu` (if authenticated) or `AuthButton` (if not, and auth required)

---

## 13. Design System

### 13.1 CSS Custom Properties (tokens.css)

**Background**:

```css
--color-bg-primary: #0a0a1a;
--color-bg-secondary: #0f0f2a;
--color-bg-tertiary: #14142e;
```

**Glass morphism**:

```css
--glass-bg: rgba(255, 255, 255, 0.04);
--glass-border: rgba(255, 255, 255, 0.08);
--glass-blur: 20px;
```

**Accent palette**: `--color-cyan-*`, `--color-blue-*`, `--color-purple-*`, `--color-pink-*`, `--color-green-*`, `--color-amber-*`, `--color-red-*`

**Primary gradient**: cyan → blue → purple

**Glow effects**: `--glow-cyan`, `--glow-blue`, `--glow-purple`, `--glow-accent`

**Typography**:

- `--font-sans: 'Geist', system-ui, sans-serif`
- `--font-mono: 'Geist Mono', monospace`
- Size scale: `--text-xs` (0.75rem) through `--text-7xl` (4.5rem)

**Spacing scale**: `--space-1` (0.25rem) through `--space-32` (8rem)

**Border radius**: `--radius-sm` (8px) through `--radius-full` (9999px)

### 13.2 Styling Rules

- All component styles in scoped `<style>` blocks — no global leakage
- No utility class framework (no Tailwind)
- Dark mode only (no light mode toggle)
- CSS Grid and Flexbox for layouts
- Glassmorphic cards: `background: var(--glass-bg)`, `backdrop-filter: blur(var(--glass-blur))`, `border: 1px solid var(--glass-border)`

---

## 14. Security

### 14.1 HTTP Security Headers (hooks.server.ts)

Applied to all responses unless route already sets them:

| Header                              | Value                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `Strict-Transport-Security`         | `max-age=63072000; preload; includeSubDomains` (2 years)                                |
| `Referrer-Policy`                   | `strict-origin-when-cross-origin`                                                       |
| `Permissions-Policy`                | Denies: camera, microphone, geolocation, payment, usb, interest-cohort, browsing-topics |
| `X-Content-Type-Options`            | `nosniff`                                                                               |
| `X-Frame-Options`                   | `DENY`                                                                                  |
| `Cross-Origin-Opener-Policy`        | `same-origin-allow-popups` (allows Firebase popup OAuth)                                |
| `Cross-Origin-Resource-Policy`      | `same-origin` (except `/api/og`)                                                        |
| `X-DNS-Prefetch-Control`            | `on`                                                                                    |
| `X-Permitted-Cross-Domain-Policies` | `none`                                                                                  |

### 14.2 Content Security Policy

Mode: **report-only** (violations logged to `/api/csp-report`, nothing blocked in production).

Firebase-specific origins included only when `mode === 'firebase'` (prevents leaking self-host configuration details).

### 14.3 Input Validation

At API boundary (`/api/analyze`):

- `Content-Type` must be `application/json`
- `resumeText`: non-empty, max 50,000 chars
- `jobDescription`: max 20,000 chars
- `mode`: must be `'full-score'` or `'analyze-jd'`

Share URL parameters: `score` and `passingCount` clamped server-side before rendering (prevents impossible states).

### 14.4 Path Traversal Protection

`/docs/[...slug]` handler validates resolved path with `startsWith(docsDir)` and `realpath()` comparison before serving static files.

### 14.5 Privacy

- Resume files parsed entirely client-side (Web Worker)
- Only extracted text is transmitted to server
- Extracted text sent to Gemini/Groq for scoring
- Firebase Firestore rules: `allow read, write: if request.auth.uid == userId`

---

## 15. Data Persistence

### 15.1 Firestore Schema (Firebase mode)

```
users/
  {uid}/
    scans/
      {docId}/
        id: string
        timestamp: string (ISO 8601)
        mode: 'general' | 'targeted'
        averageScore: number
        passingCount: number
        results: ScoreResult[]   (serialized JSON)
        fileName?: string
        jobDescriptionSnippet?: string  (first 200 chars)

scan_logs/                       (admin visibility, sampled)
  {docId}/
    uid: string
    timestamp: string
    averageScore: number
    mode: string
```

Max 5 scan entries per user (newest-first, older entries deleted on save).

### 15.2 localStorage Schema (self-host modes)

| Key                         | Contents                              | Max Entries |
| --------------------------- | ------------------------------------- | ----------- |
| `ats_local_scan_history_v1` | `ScanHistoryEntry[]` (anonymous mode) | 5           |
| `ats_jd_library_v1`         | `JDLibraryEntry[]`                    | Unlimited   |

---

## 16. Environment Variables

### Group 1: LLM Providers

| Variable          | Required      | Description                                      |
| ----------------- | ------------- | ------------------------------------------------ |
| `GEMINI_API_KEY`  | Yes (primary) | Google Cloud API key                             |
| `GROQ_API_KEY`    | Recommended   | Groq API key (fallback)                          |
| `OLLAMA_BASE_URL` | No            | Local Ollama URL (e.g. `http://localhost:11434`) |
| `OLLAMA_MODEL`    | No            | Model name (default: `llama3.2`)                 |
| `OLLAMA_API_KEY`  | No            | Bearer token for proxied Ollama                  |

At least one of GEMINI, GROQ, or OLLAMA must be configured (server returns 503 otherwise).

### Group 2: Firebase (hosted mode)

| Variable                              | Description                        |
| ------------------------------------- | ---------------------------------- |
| `PUBLIC_FIREBASE_API_KEY`             | Web API key                        |
| `PUBLIC_FIREBASE_AUTH_DOMAIN`         | Auth domain                        |
| `PUBLIC_FIREBASE_PROJECT_ID`          | Project ID (enables Firebase mode) |
| `PUBLIC_FIREBASE_STORAGE_BUCKET`      | Storage bucket                     |
| `PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Messaging sender ID                |
| `PUBLIC_FIREBASE_APP_ID`              | App ID                             |

### Group 3: Operations

| Variable                      | Default | Description                                     |
| ----------------------------- | ------- | ----------------------------------------------- |
| `ADMIN_TOKEN`                 | —       | Bearer token for `/api/admin/rate-limit-stats`  |
| `PUBLIC_SCAN_LOG_SAMPLE_RATE` | `1.0`   | Fraction of scans logged to Firestore (0.0–1.0) |
| `PUBLIC_ERROR_SAMPLE_RATE`    | `0.05`  | Client error reporting sample rate              |
| `PUBLIC_VITALS_SAMPLE_RATE`   | `0.05`  | Web Vitals collection sample rate               |

---

## 17. Non-Functional Requirements

### 17.1 Privacy

- Resume files never uploaded — parsed client-side in Web Worker
- Only extracted text transmitted (not original binary)
- Extracted text sent to LLM provider for scoring; users can disable LLM via settings toggle

### 17.2 Performance

| Metric             | Target                                    |
| ------------------ | ----------------------------------------- |
| Initial JS bundle  | ~15KB Svelte runtime + lazy-loaded routes |
| PDF parser bundle  | ~700KB, lazy-loaded on first PDF upload   |
| DOCX parser bundle | ~250KB, lazy-loaded on first DOCX upload  |
| LLM response time  | ≤30s (Gemini), ≤15s (Groq)                |
| Client-side parse  | Non-blocking (Web Worker)                 |
| LRU cache hit      | <1ms (in-memory)                          |

### 17.3 Accessibility

- Skip link at top of page
- ARIA live regions for scan status updates
- All interactive elements keyboard accessible
- Focus management after modals open/close
- Color contrast meeting WCAG AA (dark theme)
- Screen reader-friendly score cards (aria-label with full score text)

### 17.4 Testing

| Layer     | Tool                    | Coverage                                           |
| --------- | ----------------------- | -------------------------------------------------- |
| Unit      | Vitest                  | Parser, NLP, scorer, API, auth, stores             |
| Component | @testing-library/svelte | Key UI components                                  |
| E2E       | Playwright              | Full user flows (Chromium, Firefox, Mobile Chrome) |

E2E runs against preview server (`pnpm preview`, port 4173). 2 retries in CI.

---

## 18. Build, Test & Deploy

### 18.1 Prerequisites

- Node.js ≥ 20.0.0
- pnpm ≥ 10.32.1

### 18.2 Local Development

```bash
git clone <repo>
cd ats-screener
pnpm install
cp .env.example .env
# Edit .env: add GEMINI_API_KEY at minimum
pnpm dev           # http://localhost:5173
```

### 18.3 Commands

```bash
pnpm dev              # Dev server (HMR)
pnpm build            # Full production build (app + Astro docs)
pnpm build:app        # App only (skips docs)
pnpm build:docs       # Astro docs → static/docs/
pnpm preview          # Preview built app (http://localhost:4173)
pnpm check            # svelte-check (type check)
pnpm check:watch      # Type check in watch mode
pnpm lint             # ESLint
pnpm lint:fix         # ESLint auto-fix
pnpm format           # Prettier write
pnpm format:check     # Prettier check (no write)
pnpm test             # Vitest unit + integration
pnpm test:watch       # Vitest watch mode
pnpm test:coverage    # Vitest coverage report
pnpm test:e2e         # Playwright E2E
pnpm validate         # Full gate: check + lint + format:check + test + build
pnpm gate             # Alias for validate
```

### 18.4 Code Style

- **Indentation**: tabs (not spaces)
- **Quotes**: single
- **Trailing commas**: none
- **Print width**: 100 characters
- **Svelte**: Svelte 5 runes only (`$state`, `$derived`, `$effect`) — no legacy `writable`/`readable`
- **Logging**: use `src/lib/log.ts` structured logger — no `console.log`
- **TypeScript**: strict mode, no `any` without justification
- **Comments**: only when WHY is non-obvious

### 18.5 Commit Conventions (Conventional Commits)

```
feat(scope): description
fix(scope): description
refactor(scope): description
test(scope): description
docs: description
```

### 18.6 Deployment

**Vercel (primary)**:

```bash
pnpm build
# git push origin main → Vercel auto-deploys
```

Adapter: `@sveltejs/adapter-vercel`. LLM proxy runs as Edge function.

**Self-hosted Node.js**:

```bash
pnpm build
node build/index.js
```

**Self-hosted Docker** (example):

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install -g pnpm && pnpm install && pnpm build
ENV GEMINI_API_KEY=your_key
EXPOSE 3000
CMD ["node", "build"]
```

**Two deployment configurations**:

1. **Hosted + Firebase**: set `PUBLIC_FIREBASE_*` vars → user accounts + Firestore history
2. **Self-host + Anonymous**: set only LLM keys → no auth, localStorage history (5-entry cap)

### 18.7 Docs Site (Astro Starlight)

Located in `docs/`. Built separately:

```bash
pnpm build:docs     # builds to docs/dist/, then copied to static/docs/
```

Served by SvelteKit via `/docs/[...slug]` route with path traversal protection.

**Documentation sections**:

- Getting Started (intro, quick start, how it works)
- Platforms (one page per ATS with parser + scoring details)
- Scoring Methodology (dimensions, weights, thresholds)
- API Reference (endpoints, errors, rate limits)
- Self-Hosting (setup, anonymous mode, Docker)
- Legal (privacy policy)
