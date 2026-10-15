import { describe, expect, it } from "vitest";
import type { TicketSummary } from "../../shared/types";
import { filterTickets } from "./tracker";

const base = {
	kind: "ticket" as const,
	caseCount: 1,
	findingCount: 0,
	hasSummary: true,
	inCoverage: true,
	updatedAt: "2026-10-09T00:00:00Z",
};
const tickets: TicketSummary[] = [
	{
		...base,
		key: "ABC-1",
		title: "Create tier pricing",
		envs: { staging: { pass: 3, fail: 0, other: 0, verdict: "pass" } },
	},
	{
		...base,
		key: "ABC-2",
		title: "Add options splits groups",
		envs: { dev: { pass: 1, fail: 1, other: 0, verdict: "fail" } },
		pipeline: { step: "4", status: "blocked", complete: false },
	},
	{
		...base,
		key: "VEL-3",
		envs: { prod: { pass: 2, fail: 0, other: 0, verdict: "pass" } },
		pipeline: { step: "7", status: "done", complete: true },
	},
];

const keys = (list: TicketSummary[]) => list.map((t) => t.key);

describe("filterTickets", () => {
	it("matches every search term against key and title", () => {
		expect(keys(filterTickets(tickets, "tier", "all"))).toEqual(["ABC-1"]);
		expect(keys(filterTickets(tickets, "abc options", "all"))).toEqual(["ABC-2"]);
		expect(keys(filterTickets(tickets, "vel-3", "all"))).toEqual(["VEL-3"]);
	});

	it("filters failing, blocked and passed-on-the-last-env tickets", () => {
		expect(keys(filterTickets(tickets, "", "failing"))).toEqual(["ABC-2"]);
		expect(keys(filterTickets(tickets, "", "blocked"))).toEqual(["ABC-2"]);
		expect(keys(filterTickets(tickets, "", "final-pass", "prod"))).toEqual(["VEL-3"]);
		expect(keys(filterTickets(tickets, "", "final-pass"))).toEqual([]);
	});
});
