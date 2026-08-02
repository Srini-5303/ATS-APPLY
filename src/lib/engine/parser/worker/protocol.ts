import type { PdfGeometry } from '../pdf';
import type { ParseErrorCode } from '../../types/parser';

/**
 * Message protocol between the main thread and the parse worker.
 *
 * The worker is transport only — the parse functions it calls stay pure and directly
 * callable, so they remain testable in Vitest node without spinning up a worker.
 */

export interface ParseRequest {
	id: string;
	kind: 'pdf' | 'docx';
	/** Transferred, not copied. */
	buffer: ArrayBuffer;
}

export type ParseResponse =
	| { id: string; ok: true; geometry: PdfGeometry }
	| { id: string; ok: false; code: ParseErrorCode; message: string };
