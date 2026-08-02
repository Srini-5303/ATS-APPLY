import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pdf');

/**
 * The Phase 0 spike, verified in a real browser against a production build.
 *
 * pdf.js + Vite + SSR + module workers is the highest-uncertainty integration in the
 * project, and it characteristically works in `vite dev` then 404s the worker in a built
 * app — so this runs against `pnpm preview`, not the dev server.
 */
/**
 * Navigates and waits for hydration. Without this, setInputFiles fires a change event at an
 * input whose handler Svelte has not attached yet, and the test silently observes nothing.
 */
async function openSpike(page: Page) {
	await page.goto('/dev/pdf-spike');
	await expect(page.getByTestId('spike-input')).toBeEnabled();
}

test.describe('pdf.js in a module worker', () => {
	test('extracts text from a real PDF in the browser', async ({ page }) => {
		const consoleErrors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') consoleErrors.push(msg.text());
		});
		page.on('pageerror', (err) => consoleErrors.push(err.message));

		await openSpike(page);
		await page.getByTestId('spike-input').setInputFiles(join(FIXTURES, 'single-column-clean.pdf'));

		await expect(page.getByTestId('spike-result')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('spike-pages')).toHaveText('1');

		const items = Number(await page.getByTestId('spike-items').textContent());
		expect(items).toBeGreaterThan(20);

		// A worker that fails to resolve shows up here first.
		expect(consoleErrors).toEqual([]);
	});

	test('reports page count across a multi-page PDF', async ({ page }) => {
		await openSpike(page);
		await page.getByTestId('spike-input').setInputFiles(join(FIXTURES, 'three-page.pdf'));

		await expect(page.getByTestId('spike-pages')).toHaveText('3', { timeout: 30_000 });
	});

	test('surfaces a typed error for a PDF with no text layer', async ({ page }) => {
		await openSpike(page);
		await page.getByTestId('spike-input').setInputFiles(join(FIXTURES, 'scanned-image-only.pdf'));

		await expect(page.getByTestId('spike-error')).toContainText('NO_TEXT_LAYER', {
			timeout: 30_000
		});
	});

	test('never sends the file over the network', async ({ page }) => {
		// The product's headline claim (PRD §17.1). Asserted rather than assumed.
		const uploads: string[] = [];
		page.on('request', (req) => {
			if (req.postData()?.includes('%PDF')) uploads.push(req.url());
		});

		await openSpike(page);
		await page.getByTestId('spike-input').setInputFiles(join(FIXTURES, 'single-column-clean.pdf'));
		await expect(page.getByTestId('spike-result')).toBeVisible({ timeout: 30_000 });

		expect(uploads).toEqual([]);
	});
});
