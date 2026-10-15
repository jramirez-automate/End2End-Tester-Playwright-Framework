import { describe, expect, it } from "vitest";
import type { HistoryOutcome, HistoryRun } from "../../shared/types.js";
import { buildOverview, isFlaky, parseHistoryRun, passRate, testStats } from "./aggregate.js";

function run(
	id: string,
	env: string,
	startedAt: string,
	tests: Array<[string, HistoryOutcome, number]>,
): HistoryRun {
	return {
		version: 1,
		id,
		startedAt,
		durationMs: 1000,
		env,
		args: [],
		evidence: false,
		ci: false,
		status: "passed",
		tests: tests.map(([key, outcome, durationMs]) => ({
			key,
			title: key,
			file: "a.spec.ts",
			tags: [],
			outcome,
			status: outcome === "failed" ? "failed" : "passed",
			attempts: outcome === "flaky" ? 2 : 1,
			durationMs,
		})),
	};
}

// Newest first, as HistoryStore returns them.
const runs = [
	run("r3", "dev", "2026-10-09T03:00:00Z", [
		["create tier", "failed", 4000],
		["delete tier", "passed", 1000],
	]),
	run("r2", "staging", "2026-10-09T02:00:00Z", [["create tier", "flaky", 6000]]),
	run("r1", "dev", "2026-10-09T01:00:00Z", [
		["create tier", "passed", 2000],
		["delete tier", "skipped", 0],
	]),
];

describe("parseHistoryRun", () => {
	it("rejects unknown versions and drops malformed tests", () => {
		expect(parseHistoryRun({ version: 2, id: "x", startedAt: "t", env: "dev" })).toBeNull();
		const parsed = parseHistoryRun({
			version: 1,
			id: "x",
			startedAt: "t",
			env: "dev",
			tests: [
				{ key: "k", title: "t", outcome: "passed" },
				{ key: "k2", outcome: "exploded" },
				"junk",
			],
		});
		expect(parsed?.tests.map((t) => t.key)).toEqual(["k"]);
	});
});

describe("passRate", () => {
	it("counts flaky as passing and excludes skipped", () => {
		expect(passRate([{ passed: 1, failed: 1, flaky: 1, skipped: 5, total: 8 }])).toBeCloseTo(2 / 3);
		expect(passRate([{ passed: 0, failed: 0, flaky: 0, skipped: 2, total: 2 }])).toBe(0);
	});
});

describe("testStats", () => {
	it("aggregates per test key, newest run sets last, skips don't count", () => {
		const stats = testStats(runs);
		const create = stats.find((s) => s.key === "create tier");
		expect(create).toMatchObject({
			runs: 3,
			failed: 1,
			flaky: 1,
			avgDurationMs: 4000,
			maxDurationMs: 6000,
		});
		expect(create?.lastOutcome).toBe("failed");
		expect(stats.find((s) => s.key === "delete tier")).toMatchObject({
			runs: 1,
			avgDurationMs: 1000,
		});
	});

	it("flags flaky when retried-to-pass or mixed pass/fail, not when always failing", () => {
		expect(isFlaky({ ...testStats(runs)[0]!, flaky: 0, failed: 1, runs: 3 })).toBe(true);
		expect(isFlaky({ ...testStats(runs)[0]!, flaky: 0, failed: 3, runs: 3 })).toBe(false);
	});
});

describe("buildOverview", () => {
	const overview = buildOverview("/h", runs);

	it("summarizes each env from its newest run", () => {
		expect(overview.envs.map((e) => [e.env, e.lastRun.id, e.recentRuns])).toEqual([
			["dev", "r3", 2],
			["staging", "r2", 1],
		]);
		// dev: r3 1/2 + r1 1/1 executed → 2/3
		expect(overview.envs[0]?.passRate).toBeCloseTo(2 / 3);
	});

	it("lists recent failures newest first and slowest by average", () => {
		expect(overview.recentFailures.map((f) => [f.runId, f.test.key])).toEqual([
			["r3", "create tier"],
		]);
		expect(overview.slowest[0]?.key).toBe("create tier");
		expect(overview.flaky.map((s) => s.key)).toEqual(["create tier"]);
	});
});
