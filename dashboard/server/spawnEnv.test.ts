import { describe, expect, it } from "vitest";
import { cleanSpawnEnv } from "./spawnEnv.js";

describe("cleanSpawnEnv", () => {
	it("strips the VSCode Auto-Attach debugger injection that kills nested node CLIs", () => {
		const base = {
			PATH: "/usr/bin",
			NODE_OPTIONS:
				'--require "/Applications/Visual Studio Code.app/.../js-debug/bootloader.js" --inspect-publish-uid=http',
			VSCODE_INSPECTOR_OPTIONS: '{"autoAttachMode":"always"}',
			HOME: "/Users/x",
		};
		const out = cleanSpawnEnv(base);
		expect(out["NODE_OPTIONS"]).toBeUndefined();
		expect(out["VSCODE_INSPECTOR_OPTIONS"]).toBeUndefined();
		// Everything unrelated is preserved.
		expect(out["PATH"]).toBe("/usr/bin");
		expect(out["HOME"]).toBe("/Users/x");
	});

	it("does not mutate the input env", () => {
		const base = { NODE_OPTIONS: "--inspect" };
		cleanSpawnEnv(base);
		expect(base["NODE_OPTIONS"]).toBe("--inspect");
	});

	it("is a no-op for an already-clean env", () => {
		expect(cleanSpawnEnv({ PATH: "/usr/bin", HOME: "/h" })).toEqual({
			PATH: "/usr/bin",
			HOME: "/h",
		});
	});
});
