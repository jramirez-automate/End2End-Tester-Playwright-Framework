import { describe, expect, it } from "vitest";
import type { GateInfo } from "../../shared/types";
import { autoReply, shouldAutoApprove } from "./autoApprove";

const gate = (step: number, quickReplies = ["Yes, continue", "No, stop"]): GateInfo => ({
	question: "?",
	step,
	quickReplies,
	raisedAt: "2026-01-01T00:00:00.000Z",
});

describe("shouldAutoApprove (safe mode)", () => {
	it("never approves when auto is off", () => {
		expect(shouldAutoApprove(gate(1), false)).toBe(false);
		expect(shouldAutoApprove(gate(7), false)).toBe(false);
	});

	it("auto-approves flow-continuation gates when auto is on", () => {
		expect(shouldAutoApprove(gate(1), true)).toBe(true); // continue anyway
		expect(shouldAutoApprove(gate(2), true)).toBe(true); // start authoring
	});

	it("still pauses on outward-facing publishing gates even when auto is on", () => {
		expect(shouldAutoApprove(gate(4), true)).toBe(false); // another environment
		expect(shouldAutoApprove(gate(6), true)).toBe(false); // publish
	});
});

describe("autoReply", () => {
	it("picks the first (affirmative) quick reply", () => {
		expect(autoReply(gate(1, ["Yes, continue anyway", "No, stop here"]))).toBe(
			"Yes, continue anyway",
		);
	});

	it("returns null when there are no quick replies to choose", () => {
		expect(autoReply(gate(1, []))).toBeNull();
	});
});
