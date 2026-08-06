import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'tests', 'fixtures');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1400 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto('http://localhost:5173/scanner', { waitUntil: 'networkidle' });
await page.getByTestId('uploader').waitFor();
await page.getByTestId('file-input').setInputFiles(join(FIXTURES, 'pdf', 'single-column-clean.pdf'));
await page.getByTestId('dashboard').waitFor({ timeout: 30000 });

await page.getByTestId('jd-toggle').click();
await page
	.getByTestId('jd-input')
	.fill(readFileSync(join(FIXTURES, 'jd', 'backend-senior.txt'), 'utf8'));
await page.getByTestId('rescan-top').click();
await page.waitForTimeout(5000);

await page.getByTestId('view-detail').click();
await page.waitForTimeout(300);
await page.getByTestId('platform-detail').first().screenshot({ path: 'shot-platform.png' });

console.log('captured');
await browser.close();
