import { readFileSync } from "node:fs";
import path from "node:path";

import { LLMTestCase } from "deepeval/test-case";
import { describe, expect, it } from "vitest";

import { judgeUnavailableReason } from "./judge";
import { PASS_THRESHOLD, checkMetric, rubrics, type Check } from "./metrics";

/**
 * Each artifact kind has a good and a bad sample in `evals/samples/<kind>/`.
 * The bad sample breaks every rule on purpose, so each check must pass the
 * good one and fail the bad one — the same "prove it can fail" rule the
 * Playwright specs follow. A check that passes both is not measuring anything.
 */
function sample(kind: string, file: "input" | "good" | "bad"): string {
	return readFileSync(
		path.join(import.meta.dirname, "samples", kind, `${file}.md`),
		"utf8",
	);
}

/** Score one sample against one check and print the judge's verdict. */
async function score(kind: string, which: "good" | "bad", check: Check) {
	const metric = checkMetric(check);
	const result = await metric.measure(
		new LLMTestCase({
			input: sample(kind, "input"),
			actualOutput: sample(kind, which),
		}),
	);
	console.log(
		`[evals] ${kind}/${which} · ${check.name}: ${result.toFixed(2)} — ${metric.reason}`,
	);
	return { result, reason: metric.reason };
}

const judgeMissing = await judgeUnavailableReason();
if (judgeMissing)
	console.warn(`[evals] judgment checks skipped — ${judgeMissing}`);

describe("QA artifact rubrics", () => {
	for (const [kind, checks] of Object.entries(rubrics)) {
		describe(kind, () => {
			for (const check of checks) {
				const run = check.type === "judge" && judgeMissing ? it.skip : it;

				run(`${check.name} (${check.type}) — good sample passes`, async () => {
					const { result, reason } = await score(kind, "good", check);
					expect(result, reason).toBeGreaterThanOrEqual(PASS_THRESHOLD);
				});

				run(`${check.name} (${check.type}) — bad sample fails`, async () => {
					const { result, reason } = await score(kind, "bad", check);
					expect(result, reason).toBeLessThan(PASS_THRESHOLD);
				});
			}
		});
	}
});
