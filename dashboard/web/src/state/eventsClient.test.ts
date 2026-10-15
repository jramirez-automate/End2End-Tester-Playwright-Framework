import { describe, expect, it } from "vitest";
import { backoffDelay } from "./eventsClient";

describe("backoffDelay", () => {
	it("grows exponentially from the base before the cap", () => {
		// rand=0 gives the low end of each window (cap/2).
		expect(backoffDelay(0, () => 0)).toBe(500); // base 1000 -> 500
		expect(backoffDelay(1, () => 0)).toBe(1000); // 2000 -> 1000
		expect(backoffDelay(3, () => 0)).toBe(4000); // 8000 -> 4000
	});

	it("never exceeds the 30s cap no matter how many attempts", () => {
		expect(backoffDelay(100, () => 0.999999)).toBeLessThanOrEqual(30_000);
		expect(backoffDelay(100, () => 0)).toBe(15_000); // capped 30000 -> 15000
	});

	it("applies jitter within [cap/2, cap)", () => {
		const low = backoffDelay(2, () => 0); // 4000 -> 2000
		const high = backoffDelay(2, () => 0.999999); // -> ~4000
		expect(low).toBe(2000);
		expect(high).toBeGreaterThan(low);
		expect(high).toBeLessThanOrEqual(4000);
	});
});
