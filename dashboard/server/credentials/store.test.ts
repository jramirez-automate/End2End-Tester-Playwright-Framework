import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { revealField, setField } from "./store.js";

/** XDG_CONFIG_HOME is redirected so tests never touch the real ~/.config store. */
let tmp: string;
let savedXdg: string | undefined;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "store-test-"));
	savedXdg = process.env["XDG_CONFIG_HOME"];
	process.env["XDG_CONFIG_HOME"] = path.join(tmp, "xdg");
});

afterEach(() => {
	if (savedXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
	else process.env["XDG_CONFIG_HOME"] = savedXdg;
	rmSync(tmp, { recursive: true, force: true });
});

describe("setField — concurrent writes to the same file", () => {
	it("does not lose a field when two saves race (read-modify-write must serialize)", async () => {
		await Promise.all([
			setField(".env.dev", "APP_USERNAME", "alice"),
			setField(".env.dev", "APP_PASSWORD", "s3cret"),
		]);
		expect(await revealField(".env.dev", "APP_USERNAME")).toBe("alice");
		expect(await revealField(".env.dev", "APP_PASSWORD")).toBe("s3cret");
	});

	it("applies many concurrent field writes without dropping any", async () => {
		const keys = ["A", "B", "C", "D", "E", "F"];
		await Promise.all(keys.map((k) => setField(".env.dev", `KEY_${k}`, `v_${k}`)));
		for (const k of keys) {
			expect(await revealField(".env.dev", `KEY_${k}`)).toBe(`v_${k}`);
		}
	});
});
