/** Shared env-file parsing + masking (status report and credentials editor). */

export interface ParsedEnvEntry {
	key: string;
	value: string;
}

/** Tiny KEY=VALUE parser: skips comments/blank lines, strips surrounding quotes. */
export function parseEnvEntries(content: string): ParsedEnvEntry[] {
	const entries: ParsedEnvEntry[] = [];
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line
			.slice(0, eq)
			.trim()
			.replace(/^export\s+/, "");
		if (key === "") continue;
		entries.push({ key, value: stripQuotes(line.slice(eq + 1).trim()) });
	}
	return entries;
}

export function stripQuotes(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		if ((first === '"' || first === "'") && value.endsWith(first)) {
			const inner = value.slice(1, -1);
			// Double-quoted values expand escape sequences (dotenv semantics); single
			// quotes are literal. This mirrors the escaping done by setEnvValue.
			return first === '"' ? unescapeDoubleQuoted(inner) : inner;
		}
	}
	return value;
}

function unescapeDoubleQuoted(s: string): string {
	return s.replace(/\\(["\\nrt])/g, (_, c: string) =>
		c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
	);
}

function escapeDoubleQuoted(v: string): string {
	return v.replace(/[\\"\n\r\t]/g, (c) =>
		c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : `\\${c}`,
	);
}

/**
 * A recognizability hint that never exposes a meaningful fraction of a secret:
 * first 2 + "…" + last 2 only when at least 8 chars stay hidden (length ≥ 12),
 * otherwise a bare "•••". A 7-char token showing 4 of its chars was too much.
 */
export function maskValue(value: string): string {
	if (value.length >= 12) return `${value.slice(0, 2)}…${value.slice(-2)}`;
	return "•••";
}

/**
 * Set (or append) KEY=value in env-file content, preserving comments, blank
 * lines and ordering. Values with spaces or quotes get double-quoted.
 */
export function setEnvValue(content: string, key: string, value: string): string {
	const encoded = /[\s"'#]/.test(value) ? `"${escapeDoubleQuoted(value)}"` : value;
	const lines = content.split(/\r?\n/);
	const re = new RegExp(
		`^\\s*(?:export\\s+)?${key.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`,
	);
	let replaced = false;
	const next = lines.map((line) => {
		if (!replaced && re.test(line)) {
			replaced = true;
			return `${key}=${encoded}`;
		}
		return line;
	});
	if (!replaced) {
		while (next.length > 0 && next.at(-1)?.trim() === "") next.pop();
		next.push(`${key}=${encoded}`, "");
	}
	return next.join("\n");
}
