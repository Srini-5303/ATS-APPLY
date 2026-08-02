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
