/**
 * Pure roll-ups over run-history JSON (history-reporter.ts). Input runs may be
 * partial or from an older reporter — parseHistoryRun drops what it can't read.
 */
import type {
	HistoryCounts,
	HistoryFailure,
	HistoryOutcome,
	HistoryOverview,
	HistoryRun,
	HistoryRunSummary,
	HistoryTest,
	HistoryTestStat,
} from "../../shared/types.js";
import { countOutcomes } from "../../shared/history.js";

/** Runs per env that feed the pass rate. */
export const PASS_RATE_WINDOW = 10;
/** Newest runs that feed the flaky / slowest tables. */
export const STATS_WINDOW = 30;
const FLAKY_LIMIT = 20;
const SLOWEST_LIMIT = 15;
const FAILURES_LIMIT = 25;

const OUTCOMES = new Set<HistoryOutcome>(["passed", "failed", "flaky", "skipped"]);

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function parseTest(v: unknown): HistoryTest | null {
	if (!isRecord(v)) return null;
	const { key, title, file, outcome } = v;
	if (
		typeof key !== "string" ||
		typeof title !== "string" ||
		!OUTCOMES.has(outcome as HistoryOutcome)
	)
		return null;
	return {
		key,
		title,
		file: typeof file === "string" ? file : "",
		tags: Array.isArray(v["tags"])
			? v["tags"].filter((t): t is string => typeof t === "string")
			: [],
		outcome: outcome as HistoryOutcome,
		status: typeof v["status"] === "string" ? v["status"] : String(outcome),
		attempts: num(v["attempts"]) || 1,
		durationMs: num(v["durationMs"]),
		...(typeof v["error"] === "string" ? { error: v["error"] } : {}),
		...(typeof v["screenshot"] === "string" ? { screenshot: v["screenshot"] } : {}),
	};
}

export function parseHistoryRun(raw: unknown): HistoryRun | null {
	if (!isRecord(raw) || raw["version"] !== 1) return null;
	const { id, startedAt, env } = raw;
	if (typeof id !== "string" || typeof startedAt !== "string" || typeof env !== "string")
		return null;
	const tests = (Array.isArray(raw["tests"]) ? raw["tests"] : [])
		.map(parseTest)
		.filter((t): t is HistoryTest => t !== null);
	return {
		version: 1,
		id,
		startedAt,
		durationMs: num(raw["durationMs"]),
		env,
		...(typeof raw["ticket"] === "string" ? { ticket: raw["ticket"] } : {}),
		args: Array.isArray(raw["args"])
			? raw["args"].filter((a): a is string => typeof a === "string")
			: [],
		evidence: raw["evidence"] === true,
		ci: raw["ci"] === true,
		status: typeof raw["status"] === "string" ? raw["status"] : "unknown",
		tests,
	};
}

export function summarizeRun(run: HistoryRun): HistoryRunSummary {
	const { tests, version: _version, ...rest } = run;
	return { ...rest, counts: countOutcomes(tests) };
}

/** Passed (incl. flaky) over executed (excl. skipped); 0 when nothing ran. */
export function passRate(counts: HistoryCounts[]): number {
	let ok = 0;
	let ran = 0;
	for (const c of counts) {
		ok += c.passed + c.flaky;
		ran += c.total - c.skipped;
	}
	return ran === 0 ? 0 : ok / ran;
}

/** Per-test stats over `runs` (newest first). */
export function testStats(runs: HistoryRun[]): HistoryTestStat[] {
	const stats = new Map<
		string,
		HistoryTestStat & { passed: number; totalMs: number; timed: number }
	>();
	for (const run of runs) {
		for (const t of run.tests) {
			let s = stats.get(t.key);
			if (!s) {
				// First sighting is the newest run — it sets "last".
				s = {
					key: t.key,
					title: t.title,
					file: t.file,
					runs: 0,
					failed: 0,
					flaky: 0,
					passed: 0,
					avgDurationMs: 0,
					maxDurationMs: 0,
					lastOutcome: t.outcome,
					lastRunAt: run.startedAt,
					totalMs: 0,
					timed: 0,
				};
				stats.set(t.key, s);
			}
			if (t.outcome === "skipped") continue;
			s.runs++;
			if (t.outcome === "failed") s.failed++;
			else if (t.outcome === "flaky") s.flaky++;
			else s.passed++;
			s.totalMs += t.durationMs;
			s.timed++;
			s.maxDurationMs = Math.max(s.maxDurationMs, t.durationMs);
		}
	}
	return [...stats.values()]
		.filter((s) => s.runs > 0)
		.map(({ passed: _p, totalMs, timed, ...s }) => ({
			...s,
			avgDurationMs: Math.round(totalMs / timed),
		}));
}

/** Flaky = retried-to-pass at least once, or both passed and failed across runs. */
export function isFlaky(s: HistoryTestStat): boolean {
	return s.flaky > 0 || (s.failed > 0 && s.failed < s.runs);
}

export function buildOverview(dir: string, runsNewestFirst: HistoryRun[]): HistoryOverview {
	const runs = runsNewestFirst.map(summarizeRun);

	const byEnv = new Map<string, HistoryRunSummary[]>();
	for (const r of runs) byEnv.set(r.env, [...(byEnv.get(r.env) ?? []), r]);
	const envs = [...byEnv.entries()]
		.map(([env, list]) => {
			const recent = list.slice(0, PASS_RATE_WINDOW);
			return {
				env,
				lastRun: list[0]!,
				recentRuns: recent.length,
				passRate: passRate(recent.map((r) => r.counts)),
			};
		})
		.sort((a, b) => b.lastRun.startedAt.localeCompare(a.lastRun.startedAt));

	const stats = testStats(runsNewestFirst.slice(0, STATS_WINDOW));
	const flaky = stats
		.filter(isFlaky)
		.sort(
			(a, b) => b.flaky + b.failed - (a.flaky + a.failed) || b.lastRunAt.localeCompare(a.lastRunAt),
		)
		.slice(0, FLAKY_LIMIT);
	const slowest = [...stats]
		.sort((a, b) => b.avgDurationMs - a.avgDurationMs)
		.slice(0, SLOWEST_LIMIT);

	const recentFailures: HistoryFailure[] = [];
	for (const run of runsNewestFirst) {
		for (const test of run.tests) {
			if (test.outcome !== "failed") continue;
			recentFailures.push({ runId: run.id, runAt: run.startedAt, env: run.env, test });
			if (recentFailures.length >= FAILURES_LIMIT) break;
		}
		if (recentFailures.length >= FAILURES_LIMIT) break;
	}

	return { dir, runs, envs, flaky, slowest, recentFailures };
}
