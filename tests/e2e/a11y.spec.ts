import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/**
 * Accessibility gate (PRD §17.3).
 *
 * These fail the build rather than warn. A11y that is only checked manually stops being
 * checked, and colour-contrast in particular regresses silently — the glass tokens in §13 are
 * low-contrast by design and need holding to account.
 */
async function scan(page: Page, context?: string) {
	const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);

	const results = await builder.analyze();

	// Surface the actual selectors: "3 violations" is not actionable in CI output.
	const summary = results.violations.map((v) => ({
		id: v.id,
		impact: v.impact,
		nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 3)
	}));

	expect(summary, `axe violations${context ? ` on ${context}` : ''}`).toEqual([]);
}

async function openScanner(page: Page) {
	await page.goto('/scanner');
	await expect(page.getByTestId('uploader')).toHaveAttribute('data-ready', 'true');
}

test.describe('accessibility', () => {
	test('landing page', async ({ page }) => {
		await page.goto('/');
		await scan(page, 'landing');
	});

	test('scanner before upload', async ({ page }) => {
		await openScanner(page);
		await scan(page, 'scanner/idle');
	});

	test('scanner with the job description panel open', async ({ page }) => {
		await openScanner(page);
		await page.getByTestId('jd-toggle').click();
		await scan(page, 'scanner/jd-open');
	});

	test('scanner showing results', async ({ page }) => {
		await openScanner(page);
		await page
			.getByTestId('file-input')
			.setInputFiles(join(FIXTURES, 'pdf', 'single-column-clean.pdf'));
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		await scan(page, 'scanner/results');
	});

	test('scanner showing a parse error', async ({ page }) => {
		await openScanner(page);
		await page
			.getByTestId('file-input')
			.setInputFiles(join(FIXTURES, 'pdf', 'scanned-image-only.pdf'));
		await expect(page.getByTestId('upload-error')).toBeVisible();

		await scan(page, 'scanner/error');
	});

	test('empty history', async ({ page }) => {
		await page.goto('/history');
		await scan(page, 'history/empty');
	});

	test('error page', async ({ page }) => {
		await page.goto('/this-route-does-not-exist');
		await scan(page, '404');
	});
});

test.describe('keyboard navigation', () => {
	test('reaches the uploader and opens the picker without a mouse', async ({ page }) => {
		await openScanner(page);

		// Focus lands on the real <input type="file">, not a wrapper with role="button". That
		// is what makes Enter and Space work natively, with no custom key handling and no
		// nested-interactive violation.
		const input = page.getByTestId('file-input');
		await input.focus();
		await expect(input).toBeFocused();

		const chooser = page.waitForEvent('filechooser');
		await page.keyboard.press('Enter');
		expect(await chooser).toBeTruthy();
	});

	test('draws a focus ring on the drop zone when the input is focused', async ({ page }) => {
		// The input is visually hidden, so without this the keyboard user has no idea where
		// they are.
		await openScanner(page);
		await page.getByTestId('file-input').focus();

		const outline = await page
			.getByTestId('uploader')
			.evaluate((el) => getComputedStyle(el).outlineStyle);

		expect(outline).not.toBe('none');
	});

	test('exposes a working skip link', async ({ page }) => {
		await page.goto('/scanner');
		await page.keyboard.press('Tab');

		const skip = page.getByRole('link', { name: /skip to content/i });
		await expect(skip).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(page.locator('#main')).toBeVisible();
	});

	test('announces results to assistive technology', async ({ page }) => {
		await openScanner(page);
		await page
			.getByTestId('file-input')
			.setInputFiles(join(FIXTURES, 'pdf', 'single-column-clean.pdf'));

		// The dashboard is a live region so a screen reader hears the scores arrive.
		await expect(page.getByTestId('dashboard')).toHaveAttribute('aria-live', 'polite');
	});

	test('gives every score card a text alternative to the ring', async ({ page }) => {
		await openScanner(page);
		await page
			.getByTestId('file-input')
			.setInputFiles(join(FIXTURES, 'pdf', 'single-column-clean.pdf'));
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		// The SVG ring is aria-hidden, so the score has to be readable some other way.
		await expect(page.getByText(/Workday scores \d+ out of 100/)).toBeAttached();
	});
});
