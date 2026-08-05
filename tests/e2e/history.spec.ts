import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

async function scanOnce(page: Page, fixture = 'single-column-clean') {
	await page.goto('/scanner');
	await expect(page.getByTestId('uploader')).toHaveAttribute('data-ready', 'true');
	await page.getByTestId('file-input').setInputFiles(join(FIXTURES, 'pdf', `${fixture}.pdf`));
	await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });
}

test.describe('scan history', () => {
	test('starts empty and invites a scan', async ({ page }) => {
		await page.goto('/history');
		await expect(page.getByTestId('history-empty')).toBeVisible();
	});

	test('records a scan and shows it', async ({ page }) => {
		await scanOnce(page);
		await page.goto('/history');

		await expect(page.getByTestId('history-list')).toBeVisible();
		await expect(page.getByTestId('history-list').locator('li')).toHaveCount(1);
		await expect(page.getByTestId('history-list')).toContainText('single-column-clean.pdf');
	});

	test('shows a delta on the second scan of a session', async ({ page }) => {
		// PRD §11.2 seeded this from in-memory results only, so the first scan after a page
		// load never showed a delta even when history existed (ADR 0001 non-blocking notes).
		await scanOnce(page, 'single-column-clean');
		await page.goto('/scanner');
		await expect(page.getByTestId('uploader')).toHaveAttribute('data-ready', 'true');
		await page
			.getByTestId('file-input')
			.setInputFiles(join(FIXTURES, 'pdf', 'three-line-stub.pdf'));
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		await expect(page.getByTestId('score-delta')).toBeVisible();
		// A far weaker resume must read as a drop.
		await expect(page.getByTestId('score-delta')).toContainText('-');
	});

	test('opens a stored scan', async ({ page }) => {
		await scanOnce(page);
		await page.goto('/history');
		await page.getByTestId('history-list').locator('button').first().click();

		await expect(page.getByTestId('history-viewer')).toBeVisible();
		await expect(page.getByTestId('score-card')).toHaveCount(6);
	});

	test('claims no AI adjustment on a stored scan', async ({ page }) => {
		// A stored scan carries no record of what the rules alone produced. Reusing the live
		// scan's baseline made the cards report an adjustment that never happened.
		await scanOnce(page, 'single-column-clean');
		await scanOnce(page, 'three-line-stub');

		await page.goto('/history');
		await page.getByTestId('history-list').locator('button').first().click();

		await expect(page.getByTestId('history-viewer')).toBeVisible();
		await expect(page.getByTestId('ai-adjustment')).toHaveCount(0);
	});

	test('summarises the journey once there are two scans', async ({ page }) => {
		await scanOnce(page, 'single-column-clean');
		await scanOnce(page, 'three-line-stub');

		await page.goto('/history');
		await expect(page.getByTestId('journey')).toBeVisible();
		await expect(page.getByTestId('history-list').locator('li')).toHaveCount(2);
	});

	test('clears history behind a confirmation', async ({ page }) => {
		await scanOnce(page);
		await page.goto('/history');

		await page.getByTestId('clear-history').click();
		await expect(page.getByText(/Delete all 1 scans/)).toBeVisible();

		await page.getByRole('button', { name: 'Yes, delete' }).click();
		await expect(page.getByTestId('history-empty')).toBeVisible();
	});

	test('survives a reload', async ({ page }) => {
		await scanOnce(page);
		await page.goto('/history');
		await page.reload();

		await expect(page.getByTestId('history-list').locator('li')).toHaveCount(1);
	});
});

test.describe('share', () => {
	test('renders a shared score', async ({ page }) => {
		await page.goto('/share?s=82&p=4&t=1&d=7');

		await expect(page.getByTestId('share-score')).toHaveText('82');
		await expect(page.getByTestId('share-passing')).toContainText('4 of 6');
	});

	test('clamps impossible values from a crafted URL', async ({ page }) => {
		// Share params are caller-supplied and unverifiable, so they are clamped server-side
		// before anything is rendered (PRD §14.3).
		await page.goto('/share?s=99999&p=42&d=abc');

		await expect(page.getByTestId('share-score')).toHaveText('100');
		await expect(page.getByTestId('share-passing')).toContainText('6 of 6');
	});

	test('says the score is unverified', async ({ page }) => {
		await page.goto('/share?s=100&p=6');
		await expect(page.getByText(/not verified/i)).toBeVisible();
	});

	test('serves an OG image for the card', async ({ request }) => {
		const response = await request.get('/api/og?s=82&p=4');

		expect(response.ok()).toBe(true);
		expect(response.headers()['content-type']).toContain('image/svg');
		expect(await response.text()).toContain('82');
	});

	test('links from the dashboard with the real score', async ({ page }) => {
		await scanOnce(page);

		const href = await page.getByTestId('share-link').getAttribute('href');
		const score = await page.getByTestId('average-score').textContent();

		expect(href).toContain(`s=${score ?? ''}`);
	});
});
