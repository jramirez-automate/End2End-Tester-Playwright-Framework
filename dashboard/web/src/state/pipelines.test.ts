import { describe, expect, it } from "vitest";
import type { RunRecord, RunState } from "../../../shared/types";
import {
	selectActivePipelines,
	selectLiveTarget,
	selectWrappedByTicket,
	selectWrappedPipelines,
} from "./pipelines";

/** Minimal RunRecord builder — only the fields the selectors read. */
function run(
	id: string,
	state: RunState,
	times: { createdAt?: string; updatedAt?: string; endedAt?: string; ticket?: string } = {},
): RunRecord {
	return {
		id,
		ticket: times.ticket ?? "ABC-1",
		state,
		createdAt: times.createdAt ?? "2026-01-01T00:00:00.000Z",
		updatedAt: times.updatedAt ?? times.createdAt ?? "2026-01-01T00:00:00.000Z",
		endedAt: times.endedAt,
	} as unknown as RunRecord;
}

/** Turn an array of runs into the store's { [id]: run } map. */
function map(...runs: RunRecord[]): Record<string, RunRecord> {
	return Object.fromEntries(runs.map((r) => [r.id, r]));
}

describe("selectActivePipelines", () => {
	it("returns active runs only, ordered by createdAt ascending", () => {
		const runs = map(
			run("r3", "queued", { createdAt: "2026-01-01T00:00:00.000Z" }),
			run("r1", "running", { createdAt: "2026-01-01T00:00:02.000Z" }),
			run("r2", "completed", { createdAt: "2026-01-01T00:00:01.000Z" }),
			run("r4", "failed", { createdAt: "2026-01-01T00:00:03.000Z" }),
		);
		expect(selectActivePipelines(runs).map((r) => r.id)).toEqual(["r3", "r1"]);
	});

	it("returns [] for an empty runs map", () => {
		expect(selectActivePipelines({})).toEqual([]);
	});
});

describe("selectWrappedPipelines", () => {
	it("returns terminal runs only, newest-ended first", () => {
		const runs = map(
			run("r1", "running", { createdAt: "2026-01-01T00:00:00.000Z" }),
			run("r2", "completed", { endedAt: "2026-01-01T00:00:05.000Z" }),
			run("r3", "failed", { endedAt: "2026-01-01T00:00:07.000Z" }),
			run("r4", "aborted", { endedAt: "2026-01-01T00:00:03.000Z" }),
		);
		expect(selectWrappedPipelines(runs).map((r) => r.id)).toEqual(["r3", "r2", "r4"]);
	});

	it("orders a terminal run without endedAt by its updatedAt and still includes it", () => {
		const runs = map(
			run("r2", "completed", { endedAt: "2026-01-01T00:00:05.000Z" }),
			run("r5", "interrupted", { updatedAt: "2026-01-01T00:00:09.000Z" }),
		);
		expect(selectWrappedPipelines(runs).map((r) => r.id)).toEqual(["r5", "r2"]);
	});
});

describe("selectWrappedByTicket", () => {
	it("groups terminal runs by ticket, newest-ended group and run first, excluding active", () => {
		const runs = map(
			run("a", "completed", { ticket: "ABC-1", endedAt: "2026-01-01T00:00:02.000Z" }),
			run("b", "failed", { ticket: "ABC-1", endedAt: "2026-01-01T00:00:05.000Z" }),
			run("c", "completed", { ticket: "ABC-2", endedAt: "2026-01-01T00:00:09.000Z" }),
			run("d", "running", { ticket: "ABC-1", createdAt: "2026-01-01T00:00:10.000Z" }),
		);
		const groups = selectWrappedByTicket(runs);
		expect(groups.map((g) => g.ticket)).toEqual(["ABC-2", "ABC-1"]);
		const abcOne = groups.find((g) => g.ticket === "ABC-1");
		expect(abcOne?.runs.map((r) => r.id)).toEqual(["b", "a"]);
		expect(abcOne?.latest).toBe(abcOne?.runs[0]);
		expect(groups.flatMap((g) => g.runs).some((r) => r.id === "d")).toBe(false);
	});

	it("returns [] for an empty runs map", () => {
		expect(selectWrappedByTicket({})).toEqual([]);
	});
});

describe("selectLiveTarget", () => {
	it("returns null when only terminal runs exist", () => {
		const runs = map(run("r2", "completed"), run("r3", "failed"));
		expect(selectLiveTarget(runs, null)).toBeNull();
	});

	it("returns the sole active run when not currently viewing one", () => {
		expect(selectLiveTarget(map(run("r1", "running")), null)).toBe("r1");
	});

	it("returns null when already viewing the (only) active run", () => {
		expect(selectLiveTarget(map(run("r1", "running")), "r1")).toBeNull();
	});

	it("returns the active run when currently viewing a wrapped one", () => {
		const runs = map(run("w1", "completed"), run("r1", "running"));
		expect(selectLiveTarget(runs, "w1")).toBe("r1");
	});

	it("ranks a running run above a waiting_gate run", () => {
		const runs = map(run("r1", "waiting_gate"), run("r2", "running"));
		expect(selectLiveTarget(runs, null)).toBe("r2");
	});

	it("returns an active run when the current id is not in the store", () => {
		expect(selectLiveTarget(map(run("r1", "running")), "ghost")).toBe("r1");
	});

	it("returns null for an empty runs map", () => {
		expect(selectLiveTarget({}, null)).toBeNull();
	});
});
