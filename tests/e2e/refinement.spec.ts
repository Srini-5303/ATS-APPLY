import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

async function openScanner(page: Page) {
	await page.goto('/scanner');
	await expect(page.getByTestId('uploader')).toHaveAttribute('data-ready', 'true');
}

async function upload(page: Page) {
	await page
		.getByTestId('file-input')
		.setInputFiles(join(FIXTURES, 'pdf', 'single-column-clean.pdf'));
}

/**
 * The refinement contract (ADR 0001 §2, §9).
 *
 * The deterministic scores are computed client-side and rendered before the network is
 * touched, so every failure mode of the refinement call has to be invisible to the user
 * beyond a label. These tests drive each failure mode deliberately.
 */
test.describe('LLM refinement', () => {
	test('renders deterministic scores before the network is touched', async ({ page }) => {
		// Hang the endpoint forever: results must still appear.
		await page.route('**/api/analyze', () => {
			/* never resolves */
		});

		await openScanner(page);
		await upload(page);

		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('score-card')).toHaveCount(6);
		await expect(page.getByTestId('provenance')).toContainText('Refining');
	});

	test('keeps the baseline when the server reports fallback', async ({ page }) => {
		await openScanner(page);
		await upload(page);
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		const before = await page.getByTestId('average-score').textContent();

		await page.route('**/api/analyze', async (route) => {
			const body = JSON.parse(route.request().postData() ?? '{}') as { baseline?: unknown };
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					results: body.baseline,
					_provider: 'rule-based',
					_fallback: true,
					_cached: false
				})
			});
		});

		await page.getByTestId('rescan').click();

		await expect(page.getByTestId('provenance')).toContainText('unavailable');
		await expect(page.getByTestId('average-score')).toHaveText(before ?? '');
	});

	test('applies a refinement when the server returns one', async ({ page }) => {
		await page.route('**/api/analyze', async (route) => {
			const body = JSON.parse(route.request().postData() ?? '{}') as {
				baseline?: { overallScore: number }[];
			};
			// Shift every platform down by 10 to make the effect unmistakable.
			const results = (body.baseline ?? []).map((r) => ({
				...r,
				overallScore: Math.max(0, r.overallScore - 10)
			}));

			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					results,
					_provider: 'gemini:test',
					_fallback: false,
					_cached: false
				})
			});
		});

		await openScanner(page);
		await upload(page);

		await expect(page.getByTestId('provenance')).toContainText('Refined by AI', {
			timeout: 30_000
		});
	});

	test('surfaces a rate limit without losing the scores', async ({ page }) => {
		await page.route('**/api/analyze', async (route) => {
			await route.fulfill({
				status: 429,
				contentType: 'application/json',
				headers: { 'Retry-After': '45' },
				body: JSON.stringify({ error: 'Too many requests', retryAfter: 45 })
			});
		});

		await openScanner(page);
		await upload(page);

		await expect(page.getByTestId('provenance')).toContainText('rate limited', {
			timeout: 30_000
		});
		await expect(page.getByTestId('score-card')).toHaveCount(6);
	});

	test('survives a malformed response', async ({ page }) => {
		await page.route('**/api/analyze', async (route) => {
			await route.fulfill({ status: 200, contentType: 'application/json', body: 'not json' });
		});

		await openScanner(page);
		await upload(page);

		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('provenance')).toContainText('unavailable');
	});

	test('sends only extracted text, never the file', async ({ page }) => {
		let sentBody = '';
		await page.route('**/api/analyze', async (route) => {
			sentBody = route.request().postData() ?? '';
			await route.fulfill({ status: 500, body: '' });
		});

		await openScanner(page);
		await upload(page);
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('provenance')).toContainText('unavailable');

		// PRD §17.1: the binary never leaves the browser, only the text it yielded.
		expect(sentBody).not.toContain('%PDF');
		expect(sentBody).toContain('ALEX MORGAN');
	});
});

/**
 * The two stages have to be legible, not merely correct.
 *
 * Rules run first and the AI adjusts afterwards, but on screen that used to be one line of
 * grey text: numbers appeared, numbers quietly changed, and nothing said a second pass had
 * happened at all.
 */
test.describe('scoring stages', () => {
	test('shows the rules stage complete while the AI stage is still running', async ({ page }) => {
		await page.route('**/api/analyze', () => {
			/* never resolves */
		});

		await openScanner(page);
		await upload(page);
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		const ledger = page.getByTestId('provenance');
		await expect(ledger).toContainText('Rules');
		await expect(ledger).toContainText('scored in your browser');
		await expect(ledger).toContainText('Refining');

		// Nothing was adjusted yet, so no card may claim it was.
		await expect(page.getByTestId('ai-adjustment')).toHaveCount(0);
	});

	test('names how many platforms the AI moved, and marks which ones', async ({ page }) => {
		await openScanner(page);
		await upload(page);
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		// The endpoint returns fully reconciled results, not raw adjustments — the server has
		// already applied and bounded them. Move exactly two platforms, echo the rest back
		// untouched.
		await page.route('**/api/analyze', async (route) => {
			const body = JSON.parse(route.request().postData() ?? '{}') as {
				baseline?: { platformId: string; overallScore: number }[];
			};

			const moves: Record<string, number> = { workday: -7, lever: 4 };
			const results = (body.baseline ?? []).map((r) => ({
				...r,
				overallScore: r.overallScore + (moves[r.platformId] ?? 0)
			}));

			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					results,
					_provider: 'groq:test',
					_fallback: false,
					_cached: false
				})
			});
		});

		await page.getByTestId('rescan-top').click();

		await expect(page.getByTestId('provenance')).toContainText('adjusted 2 of 6', {
			timeout: 30_000
		});
		await expect(page.getByTestId('ai-adjustment')).toHaveCount(2);
		await expect(page.getByTestId('ai-adjustment').first()).toHaveText('-7');
	});
});

test.describe('scanner controls', () => {
	test('offers re-scoring at the top of the results, not only the foot', async ({ page }) => {
		await openScanner(page);
		await upload(page);
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		// The loop people repeat is edit the posting, score again. Making them scroll past six
		// cards to reach the button is the whole reason this exists.
		await expect(page.getByTestId('rescan-top')).toBeVisible();
		await expect(page.getByTestId('rescan')).toBeVisible();
	});
});

test.describe('extraction panel', () => {
	test('reports what the parser read', async ({ page }) => {
		await openScanner(page);
		await upload(page);

		const panel = page.getByTestId('extraction-panel');
		await expect(panel).toBeVisible({ timeout: 30_000 });
		await expect(panel).toContainText('What the parser saw');

		await panel.getByText('What the parser saw').click();

		await expect(page.getByTestId('extraction-counts')).toContainText('Words');
		await expect(page.getByTestId('extraction-sections')).toContainText('experience');
		await expect(page.getByTestId('extraction-skills')).toBeVisible();
	});

	test('stays shut on a clean parse and opens itself when there is a finding', async ({ page }) => {
		// Uploading scores immediately, so a collapsed panel on that path would never be read.
		// It earns the vertical space only when it has something to say.
		await openScanner(page);
		await upload(page);

		const clean = page.getByTestId('extraction-panel');
		await expect(clean).toBeVisible({ timeout: 30_000 });
		await expect(clean).toHaveAttribute('data-findings', 'false');
		await expect(clean).not.toHaveAttribute('open', '');

		await page.getByTestId('start-over').click();
		await expect(page.getByTestId('uploader')).toHaveAttribute('data-ready', 'true');
		await page
			.getByTestId('file-input')
			.setInputFiles(join(FIXTURES, 'pdf', 'two-column-true.pdf'));

		const flagged = page.getByTestId('extraction-panel');
		await expect(flagged).toBeVisible({ timeout: 30_000 });
		await expect(flagged).toHaveAttribute('data-findings', 'true');
		await expect(flagged).toHaveAttribute('open', '');
		await expect(flagged).toContainText('multiple columns');
	});
});

test.describe('health check', () => {
	test('reports provider configuration without leaking keys', async ({ request }) => {
		const response = await request.get('/healthz');
		expect(response.ok()).toBe(true);

		const body = (await response.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(body).toHaveProperty('refinementAvailable');

		// A health check that echoes secrets is worse than none.
		expect(JSON.stringify(body)).not.toMatch(/AIza|gsk_|sk-/);
	});
});
