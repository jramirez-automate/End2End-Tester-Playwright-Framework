import { describe, expect, it } from "vitest";
import type { BugSummary, JiraIssueInfo, RunRecord, TicketSummary } from "../../shared/types";
import { attentionItems, bugGroup, orderEnvs, stageOf, stagesFor } from "./board";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const pass = (n: number) => ({ pass: n, fail: 0, other: 0, verdict: "pass" as const });
const fail = (p: number, f: number) => ({ pass: p, fail: f, other: 0, verdict: "fail" as const });

function ticket(key: string, extra: Partial<TicketSummary> = {}): TicketSummary {
	return {
		key,
		kind: "ticket",
		envs: {},
		caseCount: 1,
		findingCount: 0,
		hasSummary: false,
		inCoverage: false,
		updatedAt: "2026-10-08T00:00:00Z",
		...extra,
	};
}

const jira = (key: string, status: string, category: JiraIssueInfo["category"]): JiraIssueInfo => ({
	key,
	summary: `${key} summary`,
	status,
	category,
});

const ENVS = ["demo", "dev", "staging", "prod"];

describe("orderEnvs", () => {
	it("keeps the configured order and appends envs only tickets know about", () => {
		const tickets = [
			ticket("A", { envs: { uat: pass(1), dev: pass(1) } }),
			ticket("B", { envs: { qa: pass(1) } }),
		];
		expect(orderEnvs(["dev", "prod"], tickets)).toEqual(["dev", "prod", "qa", "uat"]);
	});
});

describe("stagesFor", () => {
	it("brackets the envs with planning and done", () => {
		expect(stagesFor(["dev", "prod"]).map((s) => s.id)).toEqual([
			"planning",
			"dev",
			"prod",
			"done",
		]);
		expect(stagesFor([]).map((s) => s.id)).toEqual(["planning"]);
	});
});

describe("stageOf", () => {
	it("is the furthest env with a result, done once the last env passes", () => {
		expect(stageOf(ticket("A"), ENVS).stage).toBe("planning");
		expect(stageOf(ticket("A", { envs: { dev: pass(1), staging: fail(1, 1) } }), ENVS).stage).toBe(
			"staging",
		);
		expect(stageOf(ticket("A", { envs: { prod: fail(1, 1) } }), ENVS).stage).toBe("prod");
		expect(stageOf(ticket("A", { envs: { prod: pass(1) } }), ENVS).stage).toBe("done");
	});
});

describe("bugGroup", () => {
	const bug: BugSummary = {
		key: "B-1",
		raisedFrom: [{ ticket: "A" }],
		replicate: [],
		media: [],
		hasFolder: false,
	};

	it("puts a passing retest in fixed even when Jira lags", () => {
		expect(bugGroup({ ...bug, retest: "pass" }, jira("B-1", "In Test", "indeterminate"))).toBe(
			"fixed",
		);
	});

	it("routes QA-ready Jira statuses to retest, failing bundles to retest-failed", () => {
		expect(bugGroup(bug, jira("B-1", "Ready For Test", "indeterminate"))).toBe("retest");
		expect(bugGroup({ ...bug, retest: "fail" }, jira("B-1", "Open", "new"))).toBe("retest-failed");
		expect(bugGroup(bug, jira("B-1", "Closed", "done"))).toBe("fixed");
		expect(bugGroup(bug, undefined)).toBe("open");
	});
});

describe("attentionItems", () => {
	const gateRun = {
		id: "run-1",
		ticket: "ABC-5",
		state: "waiting_gate",
		gate: { question: "Run on another environment?\nmore", step: 4, quickReplies: [] },
		updatedAt: "2026-10-09T11:00:00Z",
	} as unknown as RunRecord;

	const items = attentionItems({
		envs: ENVS,
		now: NOW,
		runs: [gateRun],
		external: [{ key: "ABC-1", progress: { step: "4", status: "blocked", complete: false } }],
		tickets: [
			ticket("ABC-1", {
				pipeline: {
					step: "4",
					status: "blocked",
					complete: false,
					note: "needs seed",
					updatedAt: "2026-10-09T01:00:00Z",
				},
			}),
			ticket("ABC-5", {
				pipeline: {
					step: "4",
					status: "blocked",
					complete: false,
					updatedAt: "2026-10-09T01:00:00Z",
				},
			}),
			ticket("ABC-10", {
				pipeline: {
					step: "3",
					status: "blocked",
					complete: false,
					updatedAt: "2026-07-01T00:00:00Z",
				},
			}),
			ticket("ABC-11", {
				pipeline: {
					step: "3",
					status: "blocked",
					complete: false,
					updatedAt: "2026-10-09T01:00:00Z",
				},
			}),
			ticket("ABC-2", { envs: { staging: fail(7, 1) } }),
			ticket("ABC-3", { envs: { staging: pass(4) } }),
			ticket("ABC-4", { envs: { staging: pass(4) }, updatedAt: "2026-08-01T00:00:00Z" }),
			ticket("ABC-6", { envs: { dev: fail(1, 1) } }),
			ticket("ABC-7"),
			ticket("ABC-8", { envs: { demo: pass(13) } }),
		],
		bugs: [
			{
				key: "ABC-9",
				raisedFrom: [{ ticket: "ABC-2" }],
				replicate: [],
				media: [],
				hasFolder: false,
			},
		],
		jira: {
			"ABC-6": jira("ABC-6", "Closed", "done"),
			"ABC-11": jira("ABC-11", "Closed", "done"),
			"ABC-7": jira("ABC-7", "Ready For Test", "indeterminate"),
			"ABC-9": jira("ABC-9", "In Test", "indeterminate"),
		},
	});
	const of = (kind: string) => items.filter((i) => i.kind === kind).map((i) => i.key);

	it("lists gates first; skips gated, long-abandoned and closed blocked pipelines", () => {
		expect(items[0]).toMatchObject({
			kind: "gate",
			key: "ABC-5",
			href: "/runs/run-1",
			detail: "Run on another environment?",
		});
		expect(of("blocked")).toEqual(["ABC-1"]);
		expect(items.find((i) => i.kind === "blocked")?.detail).toBe(
			"Step 4 blocked — needs seed (session outside the dashboard)",
		);
	});

	it("flags bugs and tickets Jira hands to QA", () => {
		expect(of("bug-retest")).toEqual(["ABC-9"]);
		expect(of("ready-for-test")).toEqual(["ABC-7"]);
		expect(items.find((i) => i.key === "ABC-7")?.detail).toBe(
			"Jira: Ready For Test — no results yet",
		);
	});

	it("keeps failures unless Jira closed the issue", () => {
		expect(of("failing")).toEqual(["ABC-2"]);
		expect(items.find((i) => i.key === "ABC-2")?.detail).toBe("staging 7/8");
	});

	it("asks for the last env on recent earlier passes only, never for a demo pass", () => {
		expect(of("awaiting-final")).toEqual(["ABC-3"]);
		expect(items.find((i) => i.key === "ABC-3")?.detail).toBe("Needs prod");
	});
});
