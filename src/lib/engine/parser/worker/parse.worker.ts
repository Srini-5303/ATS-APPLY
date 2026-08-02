/// <reference lib="webworker" />

import { extractPdfGeometry, PdfExtractionError } from '../pdf';
import type { ParseRequest, ParseResponse } from './protocol';

/**
 * Parse worker. Keeps pdf.js and mammoth off the main thread so a large upload never blocks
 * the UI (PRD §17.2).
 *
 * Note pdf.js spawns its own worker underneath this one; that is expected and harmless.
 */

function reply(message: ParseResponse): void {
	self.postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<ParseRequest>) => {
	const { id, kind, buffer } = event.data;

	void (async () => {
		try {
			if (kind !== 'pdf') {
				reply({
					id,
					ok: false,
					code: 'UNSUPPORTED_TYPE',
					message: `Unsupported file kind: ${kind}`
				});
				return;
			}

			const geometry = await extractPdfGeometry(buffer);
			reply({ id, ok: true, geometry });
		} catch (err) {
			if (err instanceof PdfExtractionError) {
				reply({ id, ok: false, code: err.code, message: err.message });
				return;
			}
			reply({
				id,
				ok: false,
				code: 'CORRUPT',
				message: err instanceof Error ? err.message : 'Unknown parse failure'
			});
		}
	})();
});
