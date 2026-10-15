import { describe, expect, it } from "vitest";
import type { HistoryRun, SpecCoverage } from "../../shared/types.js";
import { featureOf, groupFeatures, lastRunByFile, parseSpec } from "./scan.js";

describe("parseSpec", () => {
	it("counts test calls (incl. skip/fixme) but not describe, step or hooks", () => {
		const source = `
			test.describe("Tiers", { tag: ["@smoke", "@ABC-21091"] }, () => {
				test.beforeEach(async () => {});
				test("creates a tier", async () => { await test.step("open", async () => {}); });
				test.fixme("deletes a tier @ABC-22001", async () => {});
				test.skip('legacy', async () => {});
			});`;
		expect(parseSpec(source)).toEqual({
			tests: 3,
			tickets: ["ABC-21091", "ABC-22001"],
			smoke: true,
			seed: false,
		});
	});
});

describe("featureOf", () => {
	it("groups by feature folder; a nested folder keeps its parent as the app", () => {
		expect(featureOf("src/tests/auth/sign-in.spec.ts")).toEqual({
			app: "src/tests",
			feature: "auth",
		});
		expect(featureOf("src/tests/admin/users/add.spec.ts")).toEqual({
			app: "src/tests/admin",
			feature: "users",
		});
		expect(featureOf("src/tests/loose.spec.ts")).toEqual({ app: "src/tests", feature: "(root)" });
	});
});

const run = (id: string, at: string, tests: Array<[string, "passed" | "failed"]>): HistoryRun => ({
	version: 1,
	id,
	startedAt: at,
	durationMs: 0,
	env: "dev",
	args: [],
	evidence: false,
	ci: false,
	status: "passed",
	tests: tests.map(([file, outcome], i) => ({
		key: `${file} › t${i}`,
		title: `t${i}`,
		file,
		tags: [],
		outcome,
		status: outcome,
		attempts: 1,
		durationMs: 1,
	})),
});

describe("lastRunByFile + groupFeatures", () => {
	const a = "src/tests/admin/skills/a.spec.ts";
	const b = "src/tests/admin/skills/b.spec.ts";
	const last = lastRunByFile([
		run("new", "2026-10-09T02:00:00Z", [[a, "failed"]]),
		run("old", "2026-10-09T01:00:00Z", [
			[a, "passed"],
			[b, "passed"],
		]),
	]);

	it("keeps each file's newest run", () => {
		expect(last.get(a)?.runId).toBe("new");
		expect(last.get(a)?.counts.failed).toBe(1);
		expect(last.get(b)?.runId).toBe("old");
	});

	it("rolls specs up into one feature with merged tickets and its newest run", () => {
		const specs: SpecCoverage[] = [
			{
				file: b,
				kind: "ui",
				tests: 2,
				tickets: ["ABC-2"],
				smoke: false,
				seed: false,
				last: last.get(b)!,
			},
			{
				file: a,
				kind: "ui",
				tests: 1,
				tickets: ["ABC-1", "ABC-2"],
				smoke: true,
				seed: false,
				last: last.get(a)!,
			},
		];
		const [skills] = groupFeatures(specs);
		expect(skills).toMatchObject({
			app: "src/tests/admin",
			feature: "skills",
			tests: 3,
			tickets: ["ABC-1", "ABC-2"],
		});
		expect(skills?.last?.runId).toBe("new");
		expect(skills?.specs.map((s) => s.file)).toEqual([a, b]);
	});
});
