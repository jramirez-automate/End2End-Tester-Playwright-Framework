import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildConfig, currentBranch, discoverEnvs, envCapsFor } from "./config.js";

const ENV_KEYS = [
	"CLAUDE_BIN",
	"DASHBOARD_MODEL",
	"DASHBOARD_EFFORT",
	"DASHBOARD_BASE_BRANCH",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	// Avoid the `which claude` probe in resolveClaudeBin.
	process.env["CLAUDE_BIN"] = "mock";
	delete process.env["DASHBOARD_MODEL"];
	delete process.env["DASHBOARD_EFFORT"];
	delete process.env["DASHBOARD_BASE_BRANCH"];
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe("buildConfig — model/effort defaults", () => {
	it("defaults model to sonnet and effort to undefined", () => {
		const config = buildConfig();
		expect(config.model).toBe("sonnet");
		expect(config.effort).toBeUndefined();
	});

	it("reads DASHBOARD_MODEL and DASHBOARD_EFFORT", () => {
		process.env["DASHBOARD_MODEL"] = "opus";
		process.env["DASHBOARD_EFFORT"] = "high";
		const config = buildConfig();
		expect(config.model).toBe("opus");
		expect(config.effort).toBe("high");
	});

	it("treats an empty DASHBOARD_MODEL as 'inherit the CLI default' (no model)", () => {
		process.env["DASHBOARD_MODEL"] = "";
		expect(buildConfig().model).toBe("");
	});
});

describe("buildConfig — baseBranch default", () => {
	it("defaults to the dashboard checkout's own branch (it always contains the e2e suite)", () => {
		const config = buildConfig();
		const checkoutBranch = currentBranch(config.repoRoot);
		expect(checkoutBranch).not.toBeNull();
		expect(config.baseBranch).toBe(checkoutBranch);
	});

	it("lets DASHBOARD_BASE_BRANCH override the default", () => {
		process.env["DASHBOARD_BASE_BRANCH"] = "release/next";
		expect(buildConfig().baseBranch).toBe("release/next");
	});
});

describe("buildConfig — e2eRoot resolution", () => {
	it("points e2eRoot at the checkout that actually holds the suite (playwright.config.ts)", () => {
		// This is a standalone repo: src/tests/, src/evidence/, .env.* and playwright.config.ts
		// live at the repo root, not in a subfolder. e2eRoot must land on them.
		const config = buildConfig();
		expect(existsSync(path.join(config.e2eRoot, "playwright.config.ts"))).toBe(true);
	});

	it("resolves repoRoot to the git checkout, not an ancestor above it", () => {
		const config = buildConfig();
		expect(currentBranch(config.repoRoot)).not.toBeNull();
	});
});

describe("currentBranch", () => {
	it("returns null for a directory that is not a git repo", () => {
		const tmp = mkdtempSync(path.join(tmpdir(), "config-test-"));
		try {
			expect(currentBranch(tmp)).toBeNull();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("returns the checked-out branch of a git repo", () => {
		const tmp = mkdtempSync(path.join(tmpdir(), "config-test-"));
		try {
			const init = spawnSync("git", ["init", "-b", "feature/ABC-12345"], {
				cwd: tmp,
				encoding: "utf8",
			});
			expect(init.status).toBe(0);
			expect(currentBranch(tmp)).toBe("feature/ABC-12345");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("discoverEnvs", () => {
	it("is demo plus each .env.<name>, in promotion order, without the publish or example files", () => {
		const root = mkdtempSync(path.join(tmpdir(), "envs-"));
		try {
			for (const f of [
				".env.prod",
				".env.uat",
				".env.dev",
				".env.publish",
				".env.publish.example",
				".env.example",
			]) {
				writeFileSync(path.join(root, f), "");
			}
			expect(discoverEnvs(root, "")).toEqual(["demo", "dev", "prod", "uat"]);
			expect(discoverEnvs(root, "staging, prod")).toEqual(["staging", "prod"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("envCapsFor", () => {
	it("runs each env one at a time unless DASHBOARD_ENV_CAPS raises it", () => {
		expect(envCapsFor(["demo", "dev"], "")).toEqual({ demo: 1, dev: 1 });
		expect(envCapsFor(["demo", "dev"], "dev=3, demo=0, bad")).toEqual({ demo: 1, dev: 3 });
	});
});
