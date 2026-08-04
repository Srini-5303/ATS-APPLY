# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev              # Start dev server (http://localhost:5173)
pnpm check            # Type-check with svelte-check
pnpm check:watch      # Type-check in watch mode

# Build
pnpm build            # Full production build (app + docs)
pnpm build:app        # App only (skips Astro docs)

# Quality
pnpm lint             # ESLint check
pnpm lint:fix         # ESLint auto-fix
pnpm format           # Prettier write
pnpm format:check     # Prettier check (no write)

# Testing
pnpm test             # Unit + integration tests (Vitest)
pnpm test:watch       # Watch mode
pnpm test:coverage    # Coverage report
pnpm test:e2e         # Playwright E2E (requires pnpm preview running first)

# Full gate — run before any PR
pnpm validate         # check + lint + format:check + test + build
```

## Architecture

**ATS Screener** simulates how 6 enterprise ATS platforms (Workday, Taleo, iCIMS, Greenhouse, Lever, SuccessFactors) parse and score resumes. Built with SvelteKit 5 (Svelte 5 runes), TypeScript strict mode, pdfjs-dist for client-side PDF parsing, and Firebase for auth/storage.

### Core Design Principle

The scoring engine (`src/lib/engine/`) is **fully decoupled from the UI** — pure TypeScript with no Svelte/DOM dependencies. This makes it independently testable and reusable.

### Data Flow

1. **Upload** → `ResumeUploader.svelte` → dynamic import of `parseResume()` (runs in Web Worker, file never leaves browser)
2. **Scan** → `scanner/+page.svelte` builds `ScoringInput` → POST `/api/analyze`
   - **Primary path:** Gemini API → structured `LLMAnalysis`
   - **Fallback:** Groq API, then pure rule-based `scoreResume()` engine
3. **Results** stored in `scoresStore` → Firestore (Firebase mode) or localStorage (anonymous)

### Engine Modules (`src/lib/engine/`)

- `parser/` — PDF (pdfjs-dist) and DOCX (mammoth) extraction, section detection, contact/date parsing. Entry: `parseResume()`
- `scorer/` — Deterministic scoring against 6 ATS profiles. Entry: `scoreResume()`. Each profile in `scorer/profiles/` defines weights for formatting, keywords, sections, experience, education
- `nlp/` — Tokenizer, conservative stemmer, synonym expansion (8+ industries), skills taxonomy
- `llm/` — Gemini client, Groq fallback, prompt templates, `LLMAnalysis` types
- `job-parser/` — Extracts structured requirements from job description text

### Stores (`src/lib/stores/`)

Svelte 5 rune-based stores (`.svelte.ts` files):

- `resume.svelte.ts` — parsed file + parsing status
- `scores.svelte.ts` — score results, LLM analysis, scan history, JD state
- `auth.svelte.ts` — user, auth mode (firebase/none)
- `settings.svelte.ts` — user preferences
- `jd-library.svelte.ts` — saved job descriptions

### Auth Modes (mutually exclusive, set by env vars)

| Mode     | Trigger                          | History Storage                 |
| -------- | -------------------------------- | ------------------------------- |
| Firebase | `PUBLIC_FIREBASE_PROJECT_ID` set | Firestore                       |
| None     | No env vars                      | localStorage (capped 5 entries) |

Auth mode resolved server-side in `src/lib/server/auth/config.ts` → passed to client via layout server load.

### Key Aliases (`svelte.config.js`)

```
$components  →  src/lib/components
$engine      →  src/lib/engine
$stores      →  src/lib/stores
$styles      →  src/lib/styles
$utils       →  src/lib/utils
```

### API Routes

- `POST /api/analyze` — LLM proxy (rate-limited: 10 RPM / 200 RPD per IP). Returns `LLMAnalysis` JSON
- `GET /api/admin/rate-limit-stats` — Admin stats (requires `ADMIN_TOKEN` header)
- `POST /api/log-error` — Client error reporting
- `GET /api/og` — OG image generation

### Code Style

- **Svelte 5 runes** — use `$state`, `$derived`, `$effect`; no legacy `writable`/`readable`
- **Tabs** for indentation, single quotes, no trailing commas, print width 100
- **Scoped CSS** in `.svelte` files; CSS custom properties for theming (dark glassmorphic design)
- **No `console.log`** — use `src/lib/log.ts` structured logger
- **TypeScript strict** — no `any` without justification

### Testing Layout

```
tests/
  unit/
    integration/   # Full pipeline (parse → score → report)
    parser/        # Parser unit tests
    nlp/           # NLP module tests
    api/           # API endpoint tests
    llm/           # LLM integration tests
  e2e/             # Playwright tests (Chromium, Firefox, mobile-Chrome)
```

E2E tests run against the preview server (`pnpm preview`, port 4173). Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` if browsers are already installed.

### Docs Site

`docs/` is a separate Astro Starlight site. `pnpm build:docs` builds it and copies output to `static/docs/`. It is not part of the SvelteKit app's routing except via `src/routes/docs/[...slug]`.

### Environment Variables

See `.env.example` for the full list. Key groups:

- **LLM:** `GEMINI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_BASE_URL`
- **Firebase:** `PUBLIC_FIREBASE_*` (project ID, API key, auth domain, etc.)
- **Ops:** `ADMIN_TOKEN`, `PUBLIC_SCAN_LOG_SAMPLE_RATE`, `PUBLIC_ERROR_SAMPLE_RATE`
