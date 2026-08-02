import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const BACKEND_JD = readFileSync(join(ROOT, 'jd', 'backend-senior.txt'), 'utf8');
const MARKETING_JD = readFileSync(join(ROOT, 'jd', 'marketing-manager.txt'), 'utf8');

async function openScanner(page: Page) {
	await page.goto('/scanner');
	await expect(page.getByTestId('uploader')).toHaveAttribute('data-ready', 'true');
}

async function uploadResume(page: Page) {
	await page.getByTestId('file-input').setInputFiles(join(ROOT, 'pdf', 'single-column-clean.pdf'));
	await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30_000 });
}

async function averageScore(page: Page): Promise<number> {
	return Number(await page.getByTestId('average-score').textContent());
}

test.describe('targeted scoring', () => {
	test('asks for a resume before claiming any coverage', async ({ page }) => {
		// "0 of 12 covered" with nothing uploaded reads as a failing score rather than a
		// missing input.
		await openScanner(page);
		await page.getByTestId('jd-toggle').click();
		await page.getByTestId('jd-input').fill(BACKEND_JD);

		await expect(page.getByTestId('jd-preview')).toContainText('Upload your resume');
		await expect(page.getByTestId('jd-covered')).toBeHidden();
	});

	test('previews which requirements the resume already covers', async ({ page }) => {
		await openScanner(page);
		await page.getByTestId('jd-toggle').click();
		await page.getByTestId('jd-input').fill(BACKEND_JD);
		await uploadResume(page);

		// The preview is debounced, so this also proves the debounce fires.
		const covered = Number(await page.getByTestId('jd-covered').textContent());
		expect(covered).toBeGreaterThan(0);
	});

	test('keeps the posting when results appear', async ({ page }) => {
		// The panel used to be a second component instance inside the results branch, so
		// uploading silently collapsed it and discarded what the user had pasted.
		await openScanner(page);
		await page.getByTestId('jd-toggle').click();
		await page.getByTestId('jd-input').fill(BACKEND_JD);
		await uploadResume(page);

		await expect(page.getByTestId('jd-input')).toHaveValue(/Senior Backend Engineer/);
	});

	test('a matching posting scores higher than a mismatched one', async ({ page }) => {
		await openScanner(page);
		await page.getByTestId('jd-toggle').click();
		await page.getByTestId('jd-input').fill(BACKEND_JD);
		await uploadResume(page);

		const matched = await averageScore(page);

		await page.getByTestId('jd-input').fill(MARKETING_JD);
		await page.getByTestId('rescan').click();

		const mismatched = await averageScore(page);
		expect(matched).toBeGreaterThan(mismatched);
	});

	test('labels the keyword bar for what it actually measures', async ({ page }) => {
		// With no posting the slot measures industry-vocabulary coverage, not JD matching, so
		// calling it "Keywords" would misrepresent the number (ADR 0001 §1).
		await openScanner(page);
		await uploadResume(page);
		await expect(page.getByTestId('score-card').first()).toContainText('Industry terms');

		await page.getByTestId('jd-toggle').click();
		await page.getByTestId('jd-input').fill(BACKEND_JD);
		await page.getByTestId('rescan').click();

		await expect(page.getByTestId('score-card').first()).toContainText('Keywords');
	});

	test('saves and reloads a posting from the library', async ({ page }) => {
		await openScanner(page);
		await page.getByTestId('jd-toggle').click();
		await page.getByTestId('jd-input').fill(BACKEND_JD);

		await page.getByTestId('jd-save').click();
		await page.getByTestId('jd-label').fill('Stripe — Senior Backend');
		await page.getByRole('button', { name: 'Save', exact: true }).click();

		// Survives a reload: the library is the one thing here that persists.
		await page.reload();
		await expect(page.getByTestId('uploader')).toHaveAttribute('data-ready', 'true');
		await page.getByTestId('jd-toggle').click();
		await page.getByRole('button', { name: /Saved \(1\)/ }).click();

		await expect(page.getByTestId('jd-library')).toContainText('Stripe');
	});

	test('never sends the file itself, only the text it yielded', async ({ page }) => {
		// The privacy claim in PRD §17.1 is specifically that the *binary* stays in the
		// browser. Extracted text and the posting do go to /api/analyze for refinement — that
		// is the documented behaviour, and the distinction is the one worth asserting.
		const binaryUploads: string[] = [];
		const textPosts: string[] = [];

		page.on('request', (req) => {
			const body = req.postData();
			if (!body) return;
			if (body.includes('%PDF')) binaryUploads.push(req.url());
			if (body.includes('Senior Backend Engineer')) textPosts.push(new URL(req.url()).pathname);
		});

		await openScanner(page);
		await page.getByTestId('jd-toggle').click();
		await page.getByTestId('jd-input').fill(BACKEND_JD);
		await uploadResume(page);
		await expect(page.getByTestId('provenance')).not.toContainText('Refining', {
			timeout: 30_000
		});

		expect(binaryUploads).toEqual([]);
		// Anything that does go out goes only to the refinement endpoint.
		for (const path of textPosts) expect(path).toBe('/api/analyze');
	});
});
