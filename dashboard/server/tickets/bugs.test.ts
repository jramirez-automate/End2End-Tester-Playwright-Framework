import { describe, expect, it } from "vitest";
import type { TicketCase, TicketSummary } from "../../shared/types.js";
import { deriveBugs, retestVerdict } from "./bugs.js";

const summary = (
	key: string,
	envs: TicketSummary["envs"] = {},
	updatedAt = "2026-10-01T00:00:00Z",
): TicketSummary => ({
	key,
	kind: "ticket",
	envs,
	caseCount: 0,
	findingCount: 0,
	hasSummary: false,
	inCoverage: false,
	updatedAt,
});

const failingCase: TicketCase = {
	tc: "TC-002",
	case: "Verify checkout refuses missing details",
	steps: ["Open the cart", "Select Continue"],
	expectedResult: "An error reads First Name is required",
	cells: { dev: { result: "Fail", verdict: "fail", media: ["checkout-dev-FAILED.png"] } },
};

describe("retestVerdict", () => {
	it("fails on any failing env, passes on any pass, else nothing", () => {
		expect(
			retestVerdict(summary("B-1", { dev: { pass: 1, fail: 1, other: 0, verdict: "fail" } })),
		).toBe("fail");
		expect(
			retestVerdict(summary("B-1", { dev: { pass: 2, fail: 0, other: 0, verdict: "pass" } })),
		).toBe("pass");
		expect(retestVerdict(summary("B-1"))).toBeUndefined();
		expect(retestVerdict(undefined)).toBeUndefined();
	});
});

describe("deriveBugs", () => {
	it("names a bug after the parent case it was raised from, with that case's steps", () => {
		const bugs = deriveBugs(
			new Map([
				["BUG-7", { raisedFrom: "ABC-1", tc: "TC-002", media: ["checkout-dev-FAILED.png"] }],
			]),
			new Map([
				["ABC-1", summary("ABC-1")],
				["BUG-7", summary("BUG-7")],
			]),
			new Map([["ABC-1", [failingCase]]]),
		);
		expect(bugs).toEqual([
			{
				key: "BUG-7",
				title: "Verify checkout refuses missing details",
				raisedFrom: [{ ticket: "ABC-1", tc: "TC-002" }],
				description: "Expected: An error reads First Name is required",
				replicate: ["Open the cart", "Select Continue"],
				media: [{ ticket: "BUG-7", name: "checkout-dev-FAILED.png" }],
				hasFolder: true,
				updatedAt: "2026-10-01T00:00:00Z",
			},
		]);
	});

	it("rolls a retest up from the bug's own results", () => {
		const bugs = deriveBugs(
			new Map([["BUG-7", { raisedFrom: "ABC-1", media: [] }]]),
			new Map([
				["BUG-7", summary("BUG-7", { dev: { pass: 1, fail: 0, other: 0, verdict: "pass" } })],
			]),
			new Map(),
		);
		expect(bugs[0]?.retest).toBe("pass");
	});

	it("ignores a record that names its own folder as the parent", () => {
		expect(
			deriveBugs(new Map([["ABC-1", { raisedFrom: "ABC-1", media: [] }]]), new Map(), new Map()),
		).toEqual([]);
	});

	it("sorts newest first", () => {
		const bugs = deriveBugs(
			new Map([
				["BUG-1", { raisedFrom: "ABC-1", media: [] }],
				["BUG-2", { raisedFrom: "ABC-1", media: [] }],
			]),
			new Map([
				["BUG-1", summary("BUG-1", {}, "2026-10-01T00:00:00Z")],
				["BUG-2", summary("BUG-2", {}, "2026-10-05T00:00:00Z")],
			]),
			new Map(),
		);
		expect(bugs.map((b) => b.key)).toEqual(["BUG-2", "BUG-1"]);
	});
});
