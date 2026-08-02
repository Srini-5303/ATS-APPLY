import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],

	worker: {
		// The parser runs in an app-level module worker (ADR 0001 §10 / PRD §5.1).
		format: 'es'
	},

	test: {
		// Three projects rather than one. pdf.js under jsdom is a known trap — it wants
		// DOMMatrix, Path2D and structuredClone — so the engine tests run in node against
		// the legacy build instead of polyfilling a browser environment.
		projects: [
			{
				extends: true,
				test: {
					name: 'engine',
					environment: 'node',
					include: [
						'tests/unit/parser/**/*.{test,spec}.ts',
						'tests/unit/nlp/**/*.{test,spec}.ts',
						'tests/unit/scorer/**/*.{test,spec}.ts',
						'tests/unit/llm/**/*.{test,spec}.ts',
						'tests/unit/job-parser/**/*.{test,spec}.ts',
						'tests/unit/integration/**/*.{test,spec}.ts'
					]
				}
			},
			{
				extends: true,
				test: {
					name: 'server',
					environment: 'node',
					include: ['tests/unit/api/**/*.{test,spec}.ts']
				}
			},
			{
				extends: true,
				plugins: [svelteTesting()],
				test: {
					name: 'component',
					environment: 'jsdom',
					setupFiles: ['tests/setup/component.ts'],
					include: ['tests/component/**/*.{test,spec}.ts', 'tests/unit/stores/**/*.{test,spec}.ts']
				}
			}
		],

		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'lcov'],
			include: ['src/lib/**/*.{ts,svelte}'],
			exclude: ['src/lib/**/*.d.ts', 'src/lib/**/index.ts'],
			thresholds: {
				lines: 70,
				branches: 65,
				// The engine is the product; it gets the strict bar.
				'src/lib/engine/**': {
					lines: 90,
					branches: 85
				}
			}
		}
	}
});
