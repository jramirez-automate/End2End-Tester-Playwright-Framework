const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColour ? `\u001b[${code}m${text}\u001b[0m` : text);

export const log = {
	step: (text) => console.log(paint("36", `→ ${text}`)),
	ok: (text) => console.log(paint("32", `✓ ${text}`)),
	warn: (text) => console.warn(paint("33", `! ${text}`)),
	info: (text) => console.log(`  ${text}`),
	plan: (text) => console.log(paint("35", `[dry run] ${text}`)),
};

export function fail(message) {
	console.error(paint("31", `✗ ${message}`));
	process.exit(1);
}

/** Throws with the response body, which is where these APIs explain themselves. */
export async function expectOk(res, what) {
	if (res.ok) return res;
	const body = await res.text().catch(() => "");
	throw new Error(`${what} → ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 500)}` : ""}`);
}
