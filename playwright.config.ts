import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: CI,
	retries: CI ? 2 : 0,
	// Spread rather than `: undefined` — exactOptionalPropertyTypes rejects an explicit
	// undefined for an optional property.
	...(CI ? { workers: 1 } : {}),
	reporter: CI ? ([['html'], ['github']] as const) : 'list',

	use: {
		baseURL: 'http://localhost:4173',
		trace: 'on-first-retry',
		video: 'on-first-retry'
	},

	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }
	],

	webServer: {
		command: 'pnpm build:app && pnpm preview',
		port: 4173,
		reuseExistingServer: !CI,
		timeout: 180_000
	}
});
