import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../../shared/types";
import { shouldReplaceRecord } from "./reconcile";

const rec = (updatedAt: string): RunRecord =>
	({
		id: "r",
		ticket: "ABC-1",
		env: "dev",
		state: "running",
		steps: [],
		updatedAt,
	}) as unknown as RunRecord;

describe("shouldReplaceRecord", () => {
	it("accepts the first record", () => {
		expect(shouldReplaceRecord(undefined, rec("2026-01-01T00:00:00.000Z"))).toBe(true);
	});

	it("accepts a strictly newer record and rejects an older WAL replay", () => {
		const existing = rec("2026-01-01T00:00:10.000Z");
		expect(shouldReplaceRecord(existing, rec("2026-01-01T00:00:20.000Z"))).toBe(true);
		expect(shouldReplaceRecord(existing, rec("2026-01-01T00:00:05.000Z"))).toBe(false);
	});

	it("accepts an equal timestamp (idempotent re-delivery)", () => {
		const t = "2026-01-01T00:00:10.000Z";
		expect(shouldReplaceRecord(rec(t), rec(t))).toBe(true);
	});

	it("accepts the incoming record when either timestamp is unparseable (never freeze the card)", () => {
		// The bug: a NaN existing.updatedAt made the '>=' compare false, dropping
		// EVERY future record so the card stuck on 'running' forever.
		expect(shouldReplaceRecord(rec("not-a-date"), rec("2026-01-01T00:00:20.000Z"))).toBe(true);
		expect(shouldReplaceRecord(rec("2026-01-01T00:00:10.000Z"), rec("garbage"))).toBe(true);
	});
});
