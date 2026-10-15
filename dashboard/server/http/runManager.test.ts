import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunRecord, RunState } from "../../shared/types.js";
import { buildConfig } from "../config.js";
import { Registry } from "../runs/registry.js";
import { ApiError, RunManager } from "./api.js";

let tmp: string;
let savedClaudeBin: string | undefined;

function makeRun(id: string, state: RunState): RunRecord {
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

async function makeManager(): Promise<{ manager: RunManager; registry: Registry }> {
	const registry = new Registry(tmp);
	const manager = new RunManager(buildConfig(), registry);
	return { manager, registry };
}

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "manager-test-"));
	savedClaudeBin = process.env["CLAUDE_BIN"];
	process.env["CLAUDE_BIN"] = "mock"; // avoid the `which claude` probe in buildConfig
});

afterEach(() => {
	if (savedClaudeBin === undefined) delete process.env["CLAUDE_BIN"];
	else process.env["CLAUDE_BIN"] = savedClaudeBin;
	rmSync(tmp, { recursive: true, force: true });
});

describe("RunManager.delete", () => {
	it("removes an ended run and emits a run-removed event", async () => {
		const { manager, registry } = await makeManager();
		await registry.save(makeRun("dead", "failed"));
		const removedIds: string[] = [];
		manager.on("run-removed", (payload: { id: string }) => removedIds.push(payload.id));

		await manager.delete("dead");

		expect(manager.get("dead")).toBeUndefined();
		expect(removedIds).toEqual(["dead"]);
	});

	it("refuses to delete an active run with a 409", async () => {
		const { manager, registry } = await makeManager();
		await registry.save(makeRun("live", "running"));
		await expect(manager.delete("live")).rejects.toMatchObject({ statusCode: 409 });
		expect(manager.get("live")).toBeDefined();
	});

	it("throws a 404 for an unknown run", async () => {
		const { manager } = await makeManager();
		const err = await manager.delete("ghost").then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).statusCode).toBe(404);
	});
});

describe("RunManager.create — no duplicate active runs", () => {
	it("rejects a second run for a ticket that already has an active run, and creates nothing", async () => {
		const { manager, registry } = await makeManager();
		await registry.save(makeRun("live", "running"));
		const err = await manager.create({ ticket: "ABC-12345", env: "dev" }).then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).statusCode).toBe(409);
		expect((err as ApiError).message).toMatch(/active run for ABC-12345 already exists/);
		// The guard fires before any spawn, so the registry is unchanged.
		expect(manager.list().filter((r) => r.ticket === "ABC-12345")).toHaveLength(1);
	});
});

describe("RunManager.abort — idempotent on ended runs", () => {
	it("resolves without error when the run has already ended", async () => {
		const { manager, registry } = await makeManager();
		await registry.save(makeRun("done", "failed"));
		await expect(manager.abort("done")).resolves.toBeUndefined();
		// State is untouched — abort on a dead run is a no-op, not a resurrection.
		expect(manager.get("done")?.state).toBe("failed");
	});
});

describe("RunManager — workspace-gone guard", () => {
	it("resume gives a clean 'workspace no longer exists' error instead of a spawn ENOENT", async () => {
		const { manager, registry } = await makeManager();
		await registry.save({
			...makeRun("orphan", "failed"),
			sessionId: "sess-123",
			worktreePath: path.join(tmp, "worktrees", "ABC-GONE"), // never created
		});
		expect(() => manager.resume("orphan")).toThrowError(/workspace.*no longer exists/i);
	});

	it("runAction gives a clean 'workspace no longer exists' error instead of a spawn ENOENT", async () => {
		const { manager, registry } = await makeManager();
		await registry.save({
			...makeRun("orphan2", "failed"),
			worktreePath: path.join(tmp, "worktrees", "ABC-GONE2"), // never created
		});
		const err = await manager.runAction("orphan2", "rerun-failing", {}).then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).statusCode).toBe(409);
		expect((err as ApiError).message).toMatch(/workspace.*no longer exists/i);
	});
});
