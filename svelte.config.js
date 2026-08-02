import adapterVercel from '@sveltejs/adapter-vercel';
import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// PRD §18.6 documents both a Vercel deployment and a self-hosted `node build/index.js` /
// Docker path. Those need different adapters, so select at build time (ADR 0001 notes this
// contradiction).
//
// The Vercel adapter symlinks its function bundle, which fails with EPERM on Windows unless
// Developer Mode is on or the shell is elevated. So local Windows builds default to the node
// adapter; CI and Vercel (both Linux) still get the real target. Set ADAPTER explicitly to
// override either way.
function pickAdapter() {
	if (process.env.ADAPTER === 'node') return adapterNode();
	if (process.env.ADAPTER === 'vercel') return adapterVercel();
	const isLocalWindows = process.platform === 'win32' && !process.env.CI && !process.env.VERCEL;
	return isLocalWindows ? adapterNode() : adapterVercel();
}

const adapter = pickAdapter();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter,
		alias: {
			$components: 'src/lib/components',
			$engine: 'src/lib/engine',
			$stores: 'src/lib/stores',
			$styles: 'src/lib/styles',
			$utils: 'src/lib/utils'
			// Deliberately no $server alias: server-only modules must be imported as
			// `$lib/server/...` so SvelteKit's illegal-import guard still fires and keeps
			// API keys out of the client bundle.
		}
	}
};

export default config;
