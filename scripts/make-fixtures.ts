/**
 * Generates the committed PDF fixture corpus.
 *
 * Run manually (`pnpm fixtures`), review the output, commit the binaries. Never run at test
 * time — see tests/fixtures/README.md for why.
 *
 * Each fixture exists to pin a specific layout heuristic. The two that matter most are
 * `two-column-true` (a real 0.3in gutter, which PRD §5.3's literal >150px rule would miss)
 * and `right-aligned-dates` (a single-column layout that the same rule would falsely flag).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocx, type DocxSpec } from './lib/docx-builder';
import { buildPdf, PAGE_HEIGHT, type PageSpec, type TextItem } from './lib/pdf-builder';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'tests', 'fixtures', 'pdf');
const DOCX_OUT = join(HERE, '..', 'tests', 'fixtures', 'docx');

const LEFT = 72; // 1in margin
const TOP = PAGE_HEIGHT - 72;
const LEADING = 14;

/** Lays out lines top-down from `startY`, returning positioned items. */
function column(
	lines: (string | null)[],
	x: number,
	startY: number,
	leading = LEADING
): TextItem[] {
	const items: TextItem[] = [];
	let y = startY;
	for (const line of lines) {
		// null is a blank line: advance without emitting an item.
		if (line !== null) items.push({ x, y, text: line });
		y -= leading;
	}
	return items;
}

const STRONG_RESUME: (string | null)[] = [
	'ALEX MORGAN',
	'alex.morgan@example.com | (415) 555-0142 | San Francisco, CA',
	'linkedin.com/in/alexmorgan | github.com/alexmorgan',
	null,
	'SUMMARY',
	'Senior backend engineer with 8 years building distributed systems at scale.',
	null,
	'EXPERIENCE',
	'Senior Software Engineer | Stripe | San Francisco, CA | Jan 2021 - Present',
	'- Reduced p99 checkout latency by 42% by rewriting the settlement pipeline in Go',
	'- Led migration of 120 services to Kubernetes, cutting deploy time from 45 to 6 minutes',
	'- Mentored 5 engineers; 3 were promoted within 18 months',
	'- Designed an idempotency layer processing $2.4 billion in annual volume',
	null,
	'Software Engineer | Twilio | San Francisco, CA | Jun 2018 - Dec 2020',
	'- Built a rate limiter serving 1,200,000 requests per minute at 99.99% availability',
	'- Cut infrastructure spend by $340,000 per year through capacity right-sizing',
	'- Automated release verification, eliminating 20 hours of manual QA per week',
	'- Shipped 14 customer-facing API endpoints adopted by 3,000 accounts',
	null,
	'EDUCATION',
	'B.S. Computer Science | University of California, Berkeley | 2018',
	'GPA: 3.8 | Dean’s List',
	null,
	'SKILLS',
	'Go, Python, TypeScript, PostgreSQL, Redis, Kubernetes, Docker, AWS, Terraform,',
	'Kafka, gRPC, GraphQL, React, CI/CD, distributed systems, observability'
];

const fixtures: Record<string, PageSpec[]> = {
	// Baseline happy path. Single column, clean structure, quantified bullets.
	'single-column-clean': [{ items: column(STRONG_RESUME, LEFT, TOP) }],

	// A genuine two-column layout: 0.3in (~22 unit) gutter. Must be detected. PRD §5.3's
	// literal ">150px gap" rule would miss this entirely.
	'two-column-true': [
		{
			items: [
				...column(
					[
						'ALEX MORGAN',
						'Senior Engineer',
						null,
						'CONTACT',
						'alex@example.com',
						'(415) 555-0142',
						'San Francisco',
						null,
						'SKILLS',
						'Go',
						'Python',
						'Kubernetes',
						'PostgreSQL',
						'AWS'
					],
					LEFT,
					TOP
				),
				...column(
					[
						'EXPERIENCE',
						'Senior Software Engineer',
						'Stripe | 2021 - Present',
						'- Cut p99 latency by 42%',
						'- Migrated 120 services',
						null,
						'Software Engineer',
						'Twilio | 2018 - 2020',
						'- Served 1,200,000 req/min',
						null,
						'EDUCATION',
						'B.S. Computer Science',
						'UC Berkeley, 2018'
					],
					// Left column ends near x=230; this starts at 252 → a 22-unit gutter.
					252,
					TOP
				)
			]
		}
	],

	// Single column with right-aligned dates. Produces two x-clusters with a wide gap, so a
	// naive clustering rule flags it as two-column. Must NOT be detected.
	'right-aligned-dates': [
		{
			items: [
				...column(
					[
						'ALEX MORGAN',
						'alex.morgan@example.com',
						null,
						'EXPERIENCE',
						'Senior Software Engineer, Stripe',
						'- Reduced p99 checkout latency by 42%',
						'- Led migration of 120 services to Kubernetes',
						null,
						'Software Engineer, Twilio',
						'- Built a rate limiter serving 1.2M requests per minute',
						null,
						'EDUCATION',
						'B.S. Computer Science, UC Berkeley'
					],
					LEFT,
					TOP
				),
				// Dates flushed right at x=470, far from the body text.
				{ x: 470, y: TOP - LEADING * 4, text: 'Jan 2021 - Present' },
				{ x: 470, y: TOP - LEADING * 8, text: 'Jun 2018 - Dec 2020' },
				{ x: 470, y: TOP - LEADING * 12, text: '2018' }
			]
		}
	],

	// A three-column skills list. One table-like line only — must NOT set hasTables.
	'skills-three-column-list': [
		{
			items: [
				...column(['ALEX MORGAN', null, 'SKILLS'], LEFT, TOP),
				{ x: LEFT, y: TOP - LEADING * 3, text: 'Go' },
				{ x: 240, y: TOP - LEADING * 3, text: 'Python' },
				{ x: 400, y: TOP - LEADING * 3, text: 'Kubernetes' },
				...column(
					[
						null,
						'EXPERIENCE',
						'Senior Software Engineer, Stripe, 2021 - Present',
						'- Reduced p99 checkout latency by 42%'
					],
					LEFT,
					TOP - LEADING * 4
				)
			]
		}
	],

	// The §8.2 low anchor: almost no structure, and crucially zero bullets — this is the
	// input that produced NaN under PRD §7.7's unguarded 0/0 (ADR 0001 §4).
	'three-line-stub': [
		{
			items: column(['Alex Morgan', 'alex@example.com', 'Looking for a job'], LEFT, TOP)
		}
	],

	// A scanned page has no text layer at all. Must produce a specific NO_TEXT_LAYER error
	// rather than silently scoring zero.
	'scanned-image-only': [{ items: [], image: { x: 72, y: 400, width: 468, height: 300 } }],

	// Image larger than the 50-unit glyph threshold → hasImages true.
	'with-logo-image': [
		{
			items: column(STRONG_RESUME.slice(0, 12), LEFT, TOP - 80),
			image: { x: 72, y: TOP - 60, width: 120, height: 60 }
		}
	],

	// All XObjects below the 50-unit threshold → hasImages false.
	'glyph-only-image': [
		{
			items: column(STRONG_RESUME.slice(0, 12), LEFT, TOP),
			image: { x: 500, y: TOP, width: 12, height: 12 }
		}
	],

	// Exceeds two pages → Workday truncation quirk plus the page-count penalty.
	'three-page': [
		{ items: column(STRONG_RESUME, LEFT, TOP) },
		{ items: column(STRONG_RESUME, LEFT, TOP) },
		{ items: column(STRONG_RESUME.slice(0, 14), LEFT, TOP) }
	],

	// 8pt text on 9.6pt leading. Breaks a fixed 3px y-tolerance; the tolerance has to be
	// derived from median glyph height instead (ADR 0001 §11).
	'small-font-tight-leading': [
		{
			items: STRONG_RESUME.flatMap((line, i) =>
				line === null ? [] : [{ x: LEFT, y: TOP - i * 9.6, text: line, size: 8 }]
			)
		}
	],

	// Curly punctuation and accented characters, which WinAnsi does carry.
	//
	// This deliberately does NOT test ligatures: base-14 fonts have no glyph for U+FB01 and
	// friends, so an earlier version of this fixture had them silently dropped at generation
	// time and was asserting nothing. Ligature folding is a pure string transform and is
	// covered directly in tests/unit/parser/text.spec.ts.
	'unicode-punctuation': [
		{
			items: column(
				[
					'Zoë Fitzgerald-O’Brien',
					'zoe@example.com | +44 20 7946 0958 | London, UK',
					null,
					'EXPERIENCE',
					'Office Manager | Müller & Co | 2019 – 2024',
					'- Oversaw workflow for a 40-person office',
					'- Reduced filing errors by 35%',
					'- Ran the “fast track” intake programme for 120 clients',
					null,
					'EDUCATION',
					'M.A. Linguistics | Universität München | 2019',
					'GPA: 3.9 | Dean’s List'
				],
				LEFT,
				TOP
			)
		}
	],

	// Eight ALL-CAPS headers: good ATS practice, but PRD §7.4's uncapped all-caps penalty
	// punishes it. Pins the cap added in ADR 0001 §10.
	'all-caps-headers': [
		{
			items: column(
				[
					'ALEX MORGAN',
					null,
					'SUMMARY',
					'Backend engineer.',
					null,
					'EXPERIENCE',
					'Engineer, Stripe, 2021 - Present',
					null,
					'EDUCATION',
					'B.S. CS, Berkeley, 2018',
					null,
					'SKILLS',
					'Go, Python',
					null,
					'PROJECTS',
					'Open source contributor',
					null,
					'CERTIFICATIONS',
					'AWS Solutions Architect',
					null,
					'AWARDS',
					'Employee of the year',
					null,
					'LANGUAGES',
					'English, Spanish'
				],
				LEFT,
				TOP
			)
		}
	]
};

const RESUME_PARAGRAPHS = STRONG_RESUME.map((l) => l ?? '');

const docxFixtures: Record<string, DocxSpec> = {
	// Baseline. mammoth flattens layout, so this is the DOCX equivalent of a clean parse.
	clean: { paragraphs: RESUME_PARAGRAPHS },

	// A real <w:tbl>, which must surface as hasTables.
	'with-table': {
		paragraphs: ['ALEX MORGAN', '', 'SKILLS'],
		table: [
			['Language', 'Level'],
			['Go', 'Expert'],
			['Python', 'Advanced']
		]
	},

	// An embedded image, which must surface as hasImages.
	'with-image': { paragraphs: RESUME_PARAGRAPHS.slice(0, 12), includeImage: true },

	// Empty body. mammoth silently drops text inside text boxes, so a resume built entirely
	// from them extracts to nothing — asserted rather than discovered in production.
	'empty-body': { paragraphs: [] }
};

function main(): void {
	mkdirSync(OUT, { recursive: true });

	for (const [name, pages] of Object.entries(fixtures)) {
		const bytes = buildPdf(pages);
		writeFileSync(join(OUT, `${name}.pdf`), bytes);
		console.log(`  ${name}.pdf  ${String(bytes.length)} bytes, ${String(pages.length)} page(s)`);
	}

	mkdirSync(DOCX_OUT, { recursive: true });

	for (const [name, spec] of Object.entries(docxFixtures)) {
		const bytes = buildDocx(spec);
		writeFileSync(join(DOCX_OUT, `${name}.docx`), bytes);
		console.log(`  ${name}.docx  ${String(bytes.length)} bytes`);
	}

	console.log(
		`\n${String(Object.keys(fixtures).length)} PDF + ${String(Object.keys(docxFixtures).length)} DOCX fixtures written`
	);
}

main();
