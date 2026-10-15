import type { HistoryCounts, HistoryTest } from "./types.js";

/** Outcome tally for one run's tests — shared by the server roll-ups and the run page. */
export function countOutcomes(tests: HistoryTest[]): HistoryCounts {
	const counts: HistoryCounts = { passed: 0, failed: 0, flaky: 0, skipped: 0, total: tests.length };
	for (const t of tests) counts[t.outcome]++;
	return counts;
}
