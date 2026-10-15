import { describe, expect, it } from "vitest";
import {
	formatAgo,
	formatCost,
	formatDuration,
	formatElapsed,
	formatPercent,
	formatTokens,
} from "./format";

describe("formatElapsed", () => {
	it("renders m:ss under an hour", () => {
		expect(formatElapsed(5_000)).toBe("0:05");
		expect(formatElapsed(65_000)).toBe("1:05");
	});

	it("renders h:mm:ss beyond an hour", () => {
		expect(formatElapsed(3_665_000)).toBe("1:01:05");
	});

	it("clamps negative durations to zero", () => {
		expect(formatElapsed(-5_000)).toBe("0:00");
	});

	it("renders a placeholder instead of 'NaN:NaN' for a non-finite input", () => {
		// A malformed/missing timestamp (Date.parse -> NaN) must not leak into the clock.
		expect(formatElapsed(Number.NaN)).toBe("—");
		expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe("—");
	});
});

describe("formatDuration", () => {
	it("renders compact durations", () => {
		expect(formatDuration(12_000)).toBe("12s");
		expect(formatDuration(184_000)).toBe("3m 04s");
		expect(formatDuration(3_720_000)).toBe("1h 02m");
	});

	it("renders a placeholder instead of 'NaNh NaNm' for a non-finite input", () => {
		expect(formatDuration(Number.NaN)).toBe("—");
	});
});

describe("formatTokens", () => {
	it("shows raw counts under 1k and compacts thousands/millions", () => {
		expect(formatTokens(842)).toBe("842");
		expect(formatTokens(4200)).toBe("4.2k");
		expect(formatTokens(1_300_000)).toBe("1.3M");
	});

	it("floors non-finite/negative to 0", () => {
		expect(formatTokens(Number.NaN)).toBe("0");
		expect(formatTokens(-5)).toBe("0");
	});
});

describe("formatCost", () => {
	it("renders USD to two decimals", () => {
		expect(formatCost(1.5)).toBe("$1.50");
		expect(formatCost(0)).toBe("$0.00");
	});

	it("renders a placeholder instead of '$NaN' for a non-finite input", () => {
		expect(formatCost(Number.NaN)).toBe("—");
	});
});

describe("formatAgo", () => {
	const now = Date.parse("2026-10-09T12:00:00Z");

	it("steps from minutes to hours to days to a date", () => {
		expect(formatAgo("2026-10-09T11:59:40Z", now)).toBe("just now");
		expect(formatAgo("2026-10-09T11:48:00Z", now)).toBe("12m ago");
		expect(formatAgo("2026-10-09T09:00:00Z", now)).toBe("3h ago");
		expect(formatAgo("2026-10-05T12:00:00Z", now)).toBe("4d ago");
		expect(formatAgo("2026-09-01T12:00:00Z", now)).toBe("2026-09-01");
	});

	it("shows a dash for an unparseable timestamp", () => {
		expect(formatAgo("nope", now)).toBe("—");
	});
});

describe("formatPercent", () => {
	it("rounds to a whole percent", () => {
		expect(formatPercent(2 / 3)).toBe("67%");
		expect(formatPercent(1)).toBe("100%");
	});
});
