import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunRecord } from "../../shared/types.js";
import { Registry } from "./registry.js";

let tmp: string;

function makeRun(id: string, state: RunRecord["state"]): RunRecord {
	return {
		id,
		ticket: "ABC-12345",
		env: "dev",
		state,
		steps: [],
		worktreePath: "/tmp/x",
		e2eRoot: "/tmp/x",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		costUsd: 0,
		turns: 0,
		gate: null,
	};
}

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "registry-test-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("Registry.remove", () => {
	it("drops the run from memory, deletes its dir, and prunes the index on disk", async () => {
		const registry = new Registry(tmp);
		await registry.save(makeRun("keep1", "failed"));
		await registry.save(makeRun("gone", "failed"));
		await registry.save(makeRun("keep2", "completed"));

		const removed = await registry.remove("gone");

		expect(removed).toBe(true);
		expect(registry.get("gone")).toBeUndefined();
		expect(
			registry
				.list()
				.map((r) => r.id)
				.sort(),
		).toEqual(["keep1", "keep2"]);
		expect(existsSync(registry.runDir("gone"))).toBe(false);
		const index = JSON.parse(readFileSync(path.join(tmp, "registry.json"), "utf8")) as {
			ids: string[];
		};
		expect(index.ids).not.toContain("gone");
		expect(index.ids.sort()).toEqual(["keep1", "keep2"]);
	});

	it("returns false for an unknown id and leaves the store untouched", async () => {
		const registry = new Registry(tmp);
		await registry.save(makeRun("keep1", "failed"));
		expect(await registry.remove("nope")).toBe(false);
		expect(registry.list().map((r) => r.id)).toEqual(["keep1"]);
	});

	it("survives a reload — a removed run does not come back on next boot", async () => {
		const registry = new Registry(tmp);
		await registry.save(makeRun("keep1", "failed"));
		await registry.save(makeRun("gone", "failed"));
		await registry.remove("gone");

		const reloaded = new Registry(tmp);
		await reloaded.load();
		expect(reloaded.get("gone")).toBeUndefined();
		expect(reloaded.list().map((r) => r.id)).toEqual(["keep1"]);
	});
});
