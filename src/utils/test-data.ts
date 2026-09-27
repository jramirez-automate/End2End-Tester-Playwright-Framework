let sequence = 0;

/**
 * Unique name for records a test creates.
 * e2eName("Item") → "E2E-Item-1751871234567-1a3f1"
 *
 * The E2E- prefix makes leftovers from a crashed run easy to find and delete.
 */
export function e2eName(kind: string): string {
	sequence += 1;
	const random = Math.random().toString(36).slice(2, 6);
	return `E2E-${kind}-${Date.now()}-${sequence}${random}`;
}

function toAlphaId(n: number): string {
	let x = Math.max(0, Math.floor(n));
	let out = "";
	do {
		out = String.fromCharCode(97 + (x % 26)) + out;
		x = Math.floor(x / 26);
	} while (x > 0);
	return out;
}

/**
 * Letters-only unique name for fields that reject digits and punctuation.
 * e2eAlphaName("Item") → "EeItem...."
 */
export function e2eAlphaName(kind: string): string {
	sequence += 1;
	const kindAlpha = kind.replace(/[^A-Za-z]/g, "") || "Name";
	const stamp = toAlphaId(Date.now());
	const seq = toAlphaId(sequence);
	const rand = Array.from({ length: 4 }, () =>
		String.fromCharCode(97 + Math.floor(Math.random() * 26)),
	).join("");
	return `Ee${kindAlpha}${stamp}${seq}${rand}`;
}
