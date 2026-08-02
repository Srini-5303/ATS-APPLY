import type { AuthMode } from '$lib/server/auth/config';

declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
			requestId?: string;
		}

		interface Locals {
			requestId: string;
		}

		interface PageData {
			authMode: AuthMode;
		}
	}
}

export {};
