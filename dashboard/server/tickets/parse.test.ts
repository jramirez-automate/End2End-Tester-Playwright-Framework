import { describe, expect, it } from "vitest";
import {
	buildBundle,
	parseBugRecord,
	parseCoverage,
	parsePipelineStatus,
	parseRun,
	parseVerdict,
	stepOrder,
	tallyEnv,
	type EnvRun,
} from "./parse.js";

describe("parseVerdict", () => {
	it.each([
		["Pass", "pass"],
		["Fail", "fail"],
		["Skipped", "skipped"],
		[undefined, "not-run"],
		["Interrupted", "unknown"],
	] as const)("%s → %s", (input, expected) => {
		expect(parseVerdict(input)).toBe(expected);
	});
});

describe("parseRun", () => {
	it("reads an evidence-reporter results file", () => {
		const run = parseRun(
			{
				env: "dev",
				cases: [
					{
						title: "adds an item",
						group: "Cart",
						file: "src/tests/cart/cart.spec.ts",
						status: "Pass",
						media: ["adds-an-item-dev.png"],
					},
				],
			},
			"dev",
		);
		expect(run).toEqual({
			env: "dev",
			cases: [
				{
					title: "adds an item",
					group: "Cart",
					file: "src/tests/cart/cart.spec.ts",
					status: "Pass",
					media: ["adds-an-item-dev.png"],
				},
			],
		});
	});

	it("takes the env from the file name when the file has none, and drops untitled cases", () => {
		expect(parseRun({ cases: [{ status: "Pass" }] }, "staging")).toEqual({
			env: "staging",
			cases: [],
		});
		expect(parseRun("nope", "dev")).toBeUndefined();
	});
});

const run = (
	env: string,
	cases: Array<[title: string, status: string, file?: string]>,
): EnvRun => ({
	env,
	cases: cases.map(([title, status, file]) => ({
		title,
		group: "Cart",
		...(file ? { file } : {}),
		status,
		media: [`${title}-${env}.png`],
	})),
});

describe("buildBundle", () => {
	const plan = {
		cases: [
			{
				tc: "TC-001",
				name: "Verify an item can be added",
				steps: ["Open the shop", "Add the backpack"],
				expected: "The badge reads 1",
				test: "adds an item",
			},
			{
				tc: "TC-002",
				name: "Verify (API) 404",
				layer: "api",
				steps: ["GET /x"],
				expected: "404",
				test: "returns 404",
			},
			{ tc: "TC-003", name: "Checked by hand", manual: true, steps: ["Look"], expected: "Fine" },
		],
	};

	it("puts a cell per env on each planned case its test ran in", () => {
		const bundle = buildBundle(plan, [
			run("dev", [["adds an item", "Pass", "src/tests/cart/cart.spec.ts"]]),
			run("staging", [["adds an item", "Fail"]]),
		]);
		const first = bundle.cases[0]!;
		expect(first).toMatchObject({
			tc: "TC-001",
			case: "Verify an item can be added",
			layer: "ui",
			expectedResult: "The badge reads 1",
		});
		expect(first.cells["dev"]).toEqual({
			result: "Pass",
			verdict: "pass",
			media: ["adds an item-dev.png"],
		});
		expect(first.cells["staging"]?.verdict).toBe("fail");
		expect(bundle.envs).toEqual(["dev", "staging"]);
		expect(bundle.group).toBe("Cart");
	});

	it("keeps planned cases that did not run, and marks manual ones", () => {
		const bundle = buildBundle(plan, []);
		expect(bundle.cases.map((c) => c.tc)).toEqual(["TC-001", "TC-002", "TC-003"]);
		expect(bundle.cases[1]?.layer).toBe("api");
		expect(bundle.cases[2]?.by).toBe("manual");
		expect(bundle.cases[0]?.cells).toEqual({});
	});

	it("lists tests that ran without a planned case after the plan", () => {
		const bundle = buildBundle(plan, [
			run("dev", [
				["adds an item", "Pass"],
				["an unplanned check", "Pass", "src/tests/x/y.api.spec.ts"],
			]),
		]);
		expect(bundle.cases.at(-1)).toMatchObject({ tc: "", case: "an unplanned check", layer: "api" });
	});

	it("builds rows from the runs alone when there is no plan", () => {
		expect(
			buildBundle(undefined, [
				run("dev", [
					["b", "Pass"],
					["a", "Fail"],
				]),
			]).cases.map((c) => c.case),
		).toEqual(["a", "b"]);
	});
});

describe("tallyEnv", () => {
	const { cases } = buildBundle(undefined, [
		run("dev", [
			["a", "Pass"],
			["b", "Fail"],
			["c", "Skipped"],
		]),
		run("staging", [
			["a", "Pass"],
			["c", "Skipped"],
		]),
	]);

	it("rolls an env up and fails it on any failure", () => {
		expect(tallyEnv(cases, "dev")).toEqual({ pass: 1, fail: 1, other: 1, verdict: "fail" });
	});

	it("is partial when passes sit beside skips", () => {
		expect(tallyEnv(cases, "staging")?.verdict).toBe("partial");
	});

	it("is undefined for an env with no results", () => {
		expect(tallyEnv(cases, "prod")).toBeUndefined();
	});
});

describe("parseBugRecord", () => {
	it("reads what publish.mjs bug writes", () => {
		expect(
			parseBugRecord({ raisedFrom: "ABC-1", tc: "TC-002", media: ["x-dev-FAILED.png"] }),
		).toEqual({
			raisedFrom: "ABC-1",
			tc: "TC-002",
			media: ["x-dev-FAILED.png"],
		});
	});

	it("rejects a record with no parent ticket", () => {
		expect(parseBugRecord({ tc: "TC-002" })).toBeUndefined();
	});
});

describe("parsePipelineStatus", () => {
	it("keeps the latest line per step and skips torn lines", () => {
		const status = parsePipelineStatus(
			[
				'{"step":3,"status":"started","ts":"2026-10-09T00:00:00Z"}',
				'{"step":3,"status":"done","ts":"2026-10-09T00:10:00Z"}',
				'{"step":4,"status":"blocked","ts":"2026-10-09T00:11:00Z","reason":"needs seed"}',
				'{"step":5,"stat',
			].join("\n"),
		);
		expect(status.steps).toEqual([
			{ step: "3", status: "done", ts: "2026-10-09T00:10:00Z" },
			{ step: "4", status: "blocked", ts: "2026-10-09T00:11:00Z", note: "needs seed" },
		]);
		expect(status.progress).toEqual({
			step: "4",
			status: "blocked",
			complete: false,
			updatedAt: "2026-10-09T00:11:00Z",
			note: "needs seed",
		});
	});

	it("marks a completed pipeline done", () => {
		const status = parsePipelineStatus(
			'{"step":7,"status":"done"}\n{"pipeline":"complete","ts":"t"}',
		);
		expect(status.progress).toMatchObject({ step: "7", status: "done", complete: true });
	});

	it("orders sub-steps like 1b after their parent and before the next step", () => {
		const status = parsePipelineStatus(
			[
				'{"step":2,"status":"done"}',
				'{"step":"1b","status":"done"}',
				'{"step":1,"status":"done"}',
			].join("\n"),
		);
		expect(status.steps.map((s) => s.step)).toEqual(["1", "1b", "2"]);
		expect(stepOrder("x")).toBeNull();
	});
});

describe("parseCoverage", () => {
	it("keys the 5-column ledger by ticket, first row wins, keyless rows skipped", () => {
		const md = [
			"| Ticket | Area | Specs | Environments | Notes |",
			"| --- | --- | --- | --- | --- |",
			"| DEMO-003 | Posts API | `src/tests/posts/posts.api.spec.ts` | demo | API example. |",
			"| [ABC-9](https://j/ABC-9) | Cart | `a.spec.ts` | dev, staging | |",
			"| DEMO-003 | older | - | - | - |",
			"| — | Sign in | `src/tests/auth/sign-in.spec.ts` | demo | `@smoke`. |",
			"| ABC-1 | short row |",
		].join("\n");
		const entries = parseCoverage(md);
		expect([...entries.keys()]).toEqual(["DEMO-003", "ABC-9"]);
		expect(entries.get("DEMO-003")).toMatchObject({ area: "Posts API", envs: "demo" });
		expect(entries.get("ABC-9")?.envs).toBe("dev, staging");
	});
});
