import { expect, test } from '@playwright/test';

test('landing page renders and links to the scanner', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('link', { name: /scan your resume/i })).toBeVisible();
});

test('security headers are applied', async ({ page }) => {
	const response = await page.goto('/');

	expect(response?.headers()['x-content-type-options']).toBe('nosniff');
	expect(response?.headers()['x-frame-options']).toBe('DENY');
});
