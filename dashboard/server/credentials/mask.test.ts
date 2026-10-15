import { describe, expect, it } from "vitest";
import { maskValue, parseEnvEntries, setEnvValue } from "./mask.js";

/** Read a single key back out of env-file content. */
function roundTrip(key: string, value: string): string | undefined {
	const content = setEnvValue("", key, value);
	return parseEnvEntries(content).find((e) => e.key === key)?.value;
}

describe("setEnvValue / parseEnvEntries round-trip", () => {
	it("preserves a plain value", () => {
		expect(roundTrip("APP_USERNAME", "alice")).toBe("alice");
	});

	it("preserves a value containing spaces", () => {
		expect(roundTrip("NOTE", "hello world")).toBe("hello world");
	});

	it("preserves a value containing a '#'", () => {
		expect(roundTrip("TOKEN", "abc#123")).toBe("abc#123");
	});

	it("preserves embedded double quotes", () => {
		expect(roundTrip("MSG", 'say "hi" now')).toBe('say "hi" now');
	});

	it("preserves a value containing newlines (e.g. a PEM key or multiline token)", () => {
		const pem = "-----BEGIN KEY-----\nabc123\ndef456\n-----END KEY-----";
		expect(roundTrip("PRIVATE_KEY", pem)).toBe(pem);
	});

	it("preserves a value containing a literal backslash alongside spaces", () => {
		expect(roundTrip("WINPATH", "C:\\Program Files\\x")).toBe("C:\\Program Files\\x");
	});
});

describe("maskValue", () => {
	it("fully masks short values so no meaningful fraction leaks", () => {
		expect(maskValue("secret")).toBe("•••"); // 6
		expect(maskValue("s3cr3tpwd")).toBe("•••"); // 9
		expect(maskValue("elevenchar!")).toBe("•••"); // 11
	});

	it("reveals only the first and last two of a long value (≥ 12)", () => {
		expect(maskValue("abcdefghijkl")).toBe("ab…kl"); // 12
		expect(maskValue("token-1234567890")).toBe("to…90");
	});
});

describe("setEnvValue — preserves surrounding content", () => {
	it("keeps comments and other keys, replacing only the target", () => {
		const content = "# creds\nAPP_USERNAME=old\nAPP_PASSWORD=keep\n";
		const next = setEnvValue(content, "APP_USERNAME", "new");
		const entries = parseEnvEntries(next);
		expect(entries.find((e) => e.key === "APP_USERNAME")?.value).toBe("new");
		expect(entries.find((e) => e.key === "APP_PASSWORD")?.value).toBe("keep");
		expect(next.startsWith("# creds")).toBe(true);
	});
});
