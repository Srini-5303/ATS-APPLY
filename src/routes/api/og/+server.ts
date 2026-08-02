import { parseShareParams } from '$lib/share';
import type { RequestHandler } from './$types';

/**
 * Open Graph card for share links.
 *
 * Rendered as SVG rather than via @vercel/og: the satori pipeline pulls in a font binary and
 * a WASM renderer for what is four numbers and two words here, and SVG is served and cached
 * by every crawler that matters.
 *
 * Parameters are clamped by `parseShareParams` before they reach the markup, so a crafted URL
 * cannot produce an impossible card — or inject anything, since only integers are
 * interpolated.
 */

export const config = { runtime: 'edge' };

const WIDTH = 1200;
const HEIGHT = 630;

export const GET: RequestHandler = ({ url }) => {
	const { score, passing } = parseShareParams(url.searchParams);

	const accent = score >= 75 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f87171';

	// Every interpolated value is an integer from the clamp above.
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(WIDTH)}" height="${String(HEIGHT)}" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="#0a0a1a"/>
			<stop offset="100%" stop-color="#14142e"/>
		</linearGradient>
		<linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0%" stop-color="#22d3ee"/>
			<stop offset="100%" stop-color="#a855f7"/>
		</linearGradient>
	</defs>

	<rect width="${String(WIDTH)}" height="${String(HEIGHT)}" fill="url(#bg)"/>
	<rect width="${String(WIDTH)}" height="8" fill="url(#brand)"/>

	<text x="80" y="140" font-family="system-ui, sans-serif" font-size="30" fill="#8e8ea8"
		letter-spacing="4">ATS SCREENER</text>

	<text x="80" y="330" font-family="ui-monospace, monospace" font-size="200"
		font-weight="700" fill="${accent}">${String(score)}</text>
	<text x="${String(80 + String(score).length * 118)}" y="330" font-family="system-ui, sans-serif"
		font-size="56" fill="#8e8ea8">/100</text>

	<text x="80" y="420" font-family="system-ui, sans-serif" font-size="42" fill="#f4f4f8">
		${String(passing)} of 6 platforms would let this resume through
	</text>

	<text x="80" y="530" font-family="system-ui, sans-serif" font-size="28" fill="#b8b8cc">
		Workday · Taleo · iCIMS · Greenhouse · Lever · SuccessFactors
	</text>
</svg>`;

	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml',
			// Deterministic for a given pair of numbers, so it caches hard.
			'Cache-Control': 'public, max-age=3600, s-maxage=86400, immutable',
			// The one route exempt from same-origin CORP, so crawlers can fetch it (PRD §14.1).
			'Cross-Origin-Resource-Policy': 'cross-origin'
		}
	});
};
