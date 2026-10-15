import { describe, expect, it } from "vitest";
import { afterCrash, isForwardProgress } from "./autoResume.js";

describe("afterCrash", () => {
	it("bumps the attempt while under the cap", () => {
		expect(afterCrash(undefined, 3)).toEqual({ attempt: 1, giveUp: false });
		expect(afterCrash(1, 3)).toEqual({ attempt: 2, giveUp: false });
		expect(afterCrash(2, 3)).toEqual({ attempt: 3, giveUp: false });
	});

	it("gives up once the cap is reached", () => {
		expect(afterCrash(3, 3)).toEqual({ attempt: undefined, giveUp: true });
		expect(afterCrash(9, 3)).toEqual({ attempt: undefined, giveUp: true });
	});
});

describe("isForwardProgress", () => {
	it("is true only when the current step exceeds the high-water mark", () => {
		expect(isForwardProgress(5, 4)).toBe(true);
		expect(isForwardProgress(1, 0)).toBe(true);
		expect(isForwardProgress(4, 4)).toBe(false);
		expect(isForwardProgress(3, 5)).toBe(false);
	});
});

describe("crash-loop guard (the bug: a result must NOT reset the budget without progress)", () => {
	it("gives up after a bounded number of crashes when every retry stalls on the same step", () => {
		const MAX = 3;
		let attempt: number | undefined;
		let maxStepSeen = 4; // reached step 4, then started crashing here

		let crashes = 0;
		for (let cycle = 0; cycle < 10; cycle++) {
			// The retry produces exactly one result but makes NO progress...
			if (isForwardProgress(4, maxStepSeen)) attempt = undefined; // (never fires — no progress)
			// ...then the child crashes again.
			const res = afterCrash(attempt, MAX);
			if (res.giveUp) break;
			attempt = res.attempt;
			crashes++;
		}
		expect(crashes).toBe(MAX); // 3 respawns, then give up — NOT infinite
	});

	it("refreshes the budget when a retry actually advances the pipeline", () => {
		const MAX = 3;
		let attempt: number | undefined = 2; // already two crashes deep
		let maxStepSeen = 4;

		// The retry advances to step 5 → forward progress → budget resets.
		const step = 5;
		if (isForwardProgress(step, maxStepSeen)) {
			maxStepSeen = step;
			attempt = undefined;
		}
		expect(attempt).toBeUndefined();
		// A fresh crash now starts the budget over.
		expect(afterCrash(attempt, MAX)).toEqual({ attempt: 1, giveUp: false });
	});
});
