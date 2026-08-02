/**
 * Pulls a JSON object out of a model response.
 *
 * Models wrap JSON in code fences, prepend "Here is the analysis:", and occasionally emit two
 * objects. A naive `indexOf('{')` .. `lastIndexOf('}')` spans everything between the first and
 * last brace, which silently merges two objects into invalid text — so this scans for the
 * first *balanced* object instead, tracking string state so a brace inside a value cannot
 * close it.
 */

export function extractJson(raw: string): unknown {
	const text = stripFences(raw);
	const block = firstBalancedObject(text);
	if (block === null) return null;

	try {
		return JSON.parse(block);
	} catch {
		return null;
	}
}

function stripFences(text: string): string {
	// ```json ... ``` or bare ``` ... ```
	const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(text);
	return (fenced?.[1] ?? text).trim();
}

function firstBalancedObject(text: string): string | null {
	const start = text.indexOf('{');
	if (start === -1) return null;

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const char = text[i];

		if (escaped) {
			escaped = false;
			continue;
		}

		if (char === '\\') {
			escaped = true;
			continue;
		}

		if (char === '"') {
			inString = !inString;
			continue;
		}

		// Braces inside a string value are data, not structure.
		if (inString) continue;

		if (char === '{') depth += 1;
		else if (char === '}') {
			depth -= 1;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}

	// Unbalanced — a truncated response. Fail cleanly so the caller falls through to the next
	// provider rather than throwing.
	return null;
}
