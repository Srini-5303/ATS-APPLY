import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pdf');

async function openScanner(page: Page) {
	await page.goto('/scanner');
	// The uploader is inert until hydration attaches its handlers.
	await expect(page.getByTestId('uploader')).toHaveAttribute('data-ready', 'true');
}

async function upload(page: Page, fixture: string) {
	await page.getByTestId('file-input').setInputFiles(join(FIXTURES, `${fixture}.pdf`));
}

test.describe('scanner', () => {
	test('scores a resume across six platforms', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));

		await openScanner(page);
		await upload(page, 'single-column-clean');

		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('score-card')).toHaveCount(6);

		for (const platform of ['workday', 'taleo', 'icims', 'greenhouse', 'lever', 'successfactors']) {
			await expect(page.locator(`[data-platform="${platform}"]`)).toBeVisible();
		}

		expect(errors).toEqual([]);
	});

	test('shows differentiated scores, not six identical numbers', async ({ page }) => {
		// The product premise. A literal reading of PRD §7.5 produced exactly 100 on every
		// platform here (ADR 0001 §1).
		await openScanner(page);
		await upload(page, 'single-column-clean');
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		const spread = await page.getByTestId('spread').textContent();
		expect(Number.parseInt(spread ?? '0', 10)).toBeGreaterThan(0);
	});

	test('reports a scanned PDF instead of silently scoring it zero', async ({ page }) => {
		await openScanner(page);
		await upload(page, 'scanned-image-only');

		await expect(page.getByTestId('upload-error')).toContainText('no selectable text');
		await expect(page.getByTestId('dashboard')).toBeHidden();
	});

	test('rejects a non-PDF by content, not just by extension', async ({ page }) => {
		await openScanner(page);
		await page.getByTestId('file-input').setInputFiles({
			name: 'resume.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('this is not a pdf')
		});

		await expect(page.getByTestId('upload-error')).toContainText('does not look like a PDF');
	});

	test('warns about a three-page resume', async ({ page }) => {
		await openScanner(page);
		await upload(page, 'three-page');

		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId('warnings')).toContainText('3 pages');
	});

	test('accepts pasted plain text', async ({ page }) => {
		await openScanner(page);

		// The textarea lives in a collapsed <details>; upload is the primary path.
		await page.getByText('Or paste your resume as text').click();

		await page
			.getByTestId('paste-input')
			.fill(
				[
					'Alex Morgan',
					'alex@example.com',
					'',
					'EXPERIENCE',
					'- Reduced latency by 42% across 120 services',
					'',
					'EDUCATION',
					'B.S. Computer Science, Berkeley, 2018',
					'',
					'SKILLS',
					'Go, Python, Kubernetes'
				].join('\n')
			);
		await page.getByRole('button', { name: 'Use this text' }).click();
		await page.getByTestId('scan-button').click();

		await expect(page.getByTestId('dashboard')).toBeVisible();
		await expect(page.getByTestId('score-card')).toHaveCount(6);
	});

	test('never sends the resume over the network', async ({ page }) => {
		// PRD §17.1's headline claim, asserted rather than assumed.
		const leaked: string[] = [];
		page.on('request', (req) => {
			if (req.postData()?.includes('%PDF')) leaked.push(req.url());
		});

		await openScanner(page);
		await upload(page, 'single-column-clean');
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		expect(leaked).toEqual([]);
	});

	test('resets cleanly for a second scan', async ({ page }) => {
		await openScanner(page);
		await upload(page, 'single-column-clean');
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		await page.getByTestId('start-over').click();

		await expect(page.getByTestId('dashboard')).toBeHidden();
		await expect(page.getByTestId('uploader')).toBeVisible();
	});
});
