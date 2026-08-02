import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default defineConfig(
	js.configs.recommended,
	...ts.configs.strictTypeChecked,
	...ts.configs.stylisticTypeChecked,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,

	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte']
			}
		}
	},

	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				parser: ts.parser,
				svelteConfig
			}
		}
	},

	{
		rules: {
			// PRD §18.4: structured logger only. The single exception is log.ts itself.
			'no-console': 'error',
			'@typescript-eslint/consistent-type-imports': [
				'error',
				{ prefer: 'type-imports', fixStyle: 'inline-type-imports' }
			],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			// TypeScript strict already covers this and it fires constantly on Svelte props.
			'@typescript-eslint/no-unnecessary-condition': 'off'
		}
	},

	{
		// PRD §4.2 / CLAUDE.md: the engine is pure TypeScript with zero UI dependencies.
		// Documenting that is not enough — this is what keeps it true past month three.
		files: ['src/lib/engine/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: [
								'svelte',
								'svelte/*',
								'$app/*',
								'$env/*',
								'$lib/server/*',
								'$components/*',
								'$stores/*',
								'$styles/*'
							],
							message:
								'src/lib/engine must stay free of UI, SvelteKit and server-only imports (PRD §4.2). It has to run in the browser, in a Web Worker, in Vitest node, and on Edge.'
						}
					]
				}
			]
		}
	},

	{
		// Keep API keys out of the client bundle: the browser-side LLM client must never
		// reach into the provider implementations, which read private env.
		files: ['src/lib/engine/llm/client.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/providers/**'],
							message:
								'The browser LLM client must not import provider implementations — they carry API keys. Go through /api/analyze.'
						}
					]
				}
			]
		}
	},

	{
		files: ['src/lib/log.ts'],
		rules: { 'no-console': 'off' }
	},

	{
		files: ['tests/**/*.ts', 'scripts/**/*.ts', '*.config.ts', '*.config.js'],
		rules: {
			'no-console': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off'
		}
	},

	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'dist/',
			'coverage/',
			'node_modules/',
			'static/',
			'playwright-report/',
			'test-results/',
			'.vercel/'
		]
	}
);
