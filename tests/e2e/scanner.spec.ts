import { readFile } from 'node:fs/promises';
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

	test('warns on every dimension bar that falls below 75', async ({ page }) => {
		await openScanner(page);
		await upload(page, 'single-column-clean');
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		// Derived from the number printed beside each bar rather than from a fixed expectation,
		// so this keeps holding when calibration moves the scores.
		const rows = page.getByTestId('score-card').first().locator('.bars li');
		const count = await rows.count();
		expect(count).toBe(6);

		let weakSeen = 0;
		for (let i = 0; i < count; i += 1) {
			const row = rows.nth(i);
			const score = Number(await row.locator('.bar-value').innerText());
			const weak = (await row.locator('.fill').getAttribute('data-weak')) === 'true';

			expect(weak, `bar scoring ${String(score)} should be marked weak only below 75`).toBe(
				score < 75
			);
			if (weak) weakSeen += 1;
		}

		// A fixture with every bar at or above 75 would make the assertion above vacuous.
		expect(weakSeen).toBeGreaterThan(0);
	});

	test('switches between the card and detail views', async ({ page }) => {
		await openScanner(page);
		await upload(page, 'single-column-clean');
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		// Cards are the default: six numbers side by side is the comparison people come for.
		await expect(page.getByTestId('view-cards')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('score-card')).toHaveCount(6);
		await expect(page.getByTestId('platform-detail')).toHaveCount(0);

		await page.getByTestId('view-detail').click();

		await expect(page.getByTestId('view-detail')).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByTestId('platform-detail')).toHaveCount(6);
		await expect(page.getByTestId('score-card')).toHaveCount(0);

		// The first opens so the view is never a wall of shut rows with nothing to read.
		await expect(page.getByTestId('platform-detail').first()).toHaveAttribute('open', '');
	});

	test('explains each dimension with the evidence behind its score', async ({ page }) => {
		await openScanner(page);
		await upload(page, 'single-column-clean');
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });
		await page.getByTestId('view-detail').click();

		const first = page.getByTestId('platform-detail').first();

		// Every dimension gets a row, each carrying the engine's own evidence rather than the
		// bare number the card already showed.
		for (const dimension of [
			'formatting',
			'keywordMatch',
			'sections',
			'experience',
			'education',
			'quantification'
		]) {
			await expect(first.locator(`[data-dimension="${dimension}"]`)).toBeVisible();
		}

		await expect(first.locator('[data-dimension="sections"]')).toContainText('Found:');
		await expect(first.locator('[data-dimension="experience"]')).toContainText('action verb');
		await expect(first.locator('[data-dimension="quantification"]')).toContainText(
			'concrete figure'
		);
	});

	test('files advice under the dimension it would move', async ({ page }) => {
		// A weak resume is what makes advice appear at all.
		await openScanner(page);
		await upload(page, 'three-line-stub');
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });
		await page.getByTestId('view-detail').click();

		const first = page.getByTestId('platform-detail').first();
		await expect(first.getByTestId('dimension-advice').first()).toBeVisible();

		// Advice sits inside a dimension row, not in a flat list at the foot of the panel.
		const inRows = await first.locator('[data-dimension] [data-testid="dimension-advice"]').count();
		expect(inRows).toBeGreaterThan(0);
	});

	test('exports a PDF carrying the same evidence the detail view shows', async ({ page }) => {
		await openScanner(page);
		await upload(page, 'single-column-clean');
		await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });

		const [download] = await Promise.all([
			page.waitForEvent('download', { timeout: 60_000 }),
			page.getByTestId('export-pdf').click()
		]);

		const path = await download.path();
		const pdf = await readFile(path, 'latin1');

		expect(pdf.startsWith('%PDF')).toBe(true);

		// jsPDF writes uncompressed content streams, so the rendered strings are searchable in
		// the bytes. Section 1 was always there; 3 is the per-dimension breakdown, which used to
		// exist only on screen while the downloaded report showed bare numbers.
		for (const section of [
			'1. PLATFORM COMPATIBILITY SCORES',
			'3. PLATFORM DETAIL',
			'5. METHODOLOGY'
		]) {
			expect(pdf, `missing section: ${section}`).toContain(section);
		}

		// Evidence, not just the score.
		expect(pdf).toMatch(/bullets open with a strong action verb/);
		expect(pdf).toContain('Found: experience, education, skills');
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
