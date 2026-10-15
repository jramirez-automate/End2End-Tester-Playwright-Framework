import fs from "fs";
import path from "path";
import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import { currentTestEnv } from "./src/utils/env";

/**
 * Run-history reporter — always on (wired in playwright.config.ts; set
 * E2E_HISTORY=off to skip). Writes one JSON file per run so the dashboard's
 * Test results view can show trends, flaky tests and slow specs across runs —
 * the html report and test-results/ are overwritten every run, so without this
 * nothing survives to compare.
 *
 *   run-history/2026-10-09T03-12-44-512Z-dev.json
 *   run-history/2026-10-09T03-12-44-512Z-dev/<failed-test-slug>.png
 *
 * Location: E2E_HISTORY_DIR (the dashboard sets it so runs from its worktrees
 * land in one place), else <repo>/run-history (gitignored). Failed tests get
 * their final screenshot copied beside the run file, because the originals in
 * test-results/ are wiped by the next run. Every error is swallowed — history
 * must never fail a test run.
 */

/** Shape mirrored by HistoryRun in dashboard/shared/types.ts — keep both in step. */
interface HistoryTest {
	key: string;
	title: string;
	file: string;
	tags: string[];
	outcome: "passed" | "failed" | "flaky" | "skipped";
	status: string;
	attempts: number;
	durationMs: number;
	error?: string;
	screenshot?: string;
}

const MAX_ERROR_CHARS = 2000;
// eslint-disable-next-line no-control-regex -- strips terminal colour codes from Playwright errors
const ANSI = /\u001b\[[0-9;]*m/g;

class HistoryReporter implements Reporter {
	private readonly dir = path.resolve(process.env.E2E_HISTORY_DIR || "run-history");
	private readonly enabled = process.env.E2E_HISTORY !== "off";
	/** Paths are reported relative to the config file (the repo root): src/tests/checkout/… */
	private baseDir = "";
	private startedAt = new Date();
	private finals = new Map<string, { test: TestCase; result: TestResult }>();

	onBegin(config: FullConfig, _suite: Suite): void {
		this.baseDir = config.configFile ? path.dirname(config.configFile) : config.rootDir;
		this.startedAt = new Date();
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		// Retries overwrite earlier attempts — the last one is the outcome.
		this.finals.set(test.id, { test, result });
	}

	onEnd(result: FullResult): void {
		if (!this.enabled || this.finals.size === 0) return;
		try {
			const env = currentTestEnv();
			const id = `${this.startedAt.toISOString().replace(/[:.]/g, "-")}-${slug(env)}`;
			const mediaDir = path.join(this.dir, id);
			const used = new Set<string>();
			const tests = [...this.finals.values()].map(({ test, result: last }) =>
				this.toHistoryTest(test, last, mediaDir, used),
			);
			const run = {
				version: 1,
				id,
				startedAt: this.startedAt.toISOString(),
				durationMs: Math.round(result.duration),
				env,
				...(process.env.TICKET ? { ticket: process.env.TICKET } : {}),
				args: cliArgs(),
				evidence: process.env.EVIDENCE === "true",
				ci: !!process.env.CI,
				status: result.status,
				tests,
			};
			fs.mkdirSync(this.dir, { recursive: true });
			fs.writeFileSync(path.join(this.dir, `${id}.json`), `${JSON.stringify(run, null, "\t")}\n`);
		} catch {
			// Swallowed — see above.
		}
	}

	private toHistoryTest(
		test: TestCase,
		last: TestResult,
		mediaDir: string,
		used: Set<string>,
	): HistoryTest {
		const file = path.relative(this.baseDir, test.location.file).split(path.sep).join("/");
		const outcome = mapOutcome(test.outcome());
		const entry: HistoryTest = {
			key: `${file} › ${describePath(test).join(" › ")}`,
			title: test.title,
			file,
			tags: test.tags,
			outcome,
			status: last.status,
			attempts: test.results.length,
			durationMs: Math.round(test.results.reduce((sum, r) => sum + r.duration, 0)),
		};
		const error = last.errors[0]?.message ?? last.error?.message;
		if (outcome === "failed" && error) {
			entry.error = error.replace(ANSI, "").slice(0, MAX_ERROR_CHARS);
		}
		if (outcome === "failed") {
			const shot = copyScreenshot(last, mediaDir, uniqueName(slug(test.title), used));
			if (shot) entry.screenshot = shot;
		}
		return entry;
	}

	printsToStdio(): boolean {
		return false;
	}
}

function mapOutcome(outcome: ReturnType<TestCase["outcome"]>): HistoryTest["outcome"] {
	if (outcome === "expected") return "passed";
	if (outcome === "flaky") return "flaky";
	if (outcome === "skipped") return "skipped";
	return "failed";
}

/** describe titles + test title, without the root/project/file suites. */
function describePath(test: TestCase): string[] {
	const titles = [test.title];
	let suite: Suite | undefined = test.parent;
	while (suite && suite.type === "describe") {
		titles.unshift(suite.title);
		suite = suite.parent;
	}
	return titles;
}

/** Copies the attempt's last png screenshot; returns its name or undefined. */
function copyScreenshot(result: TestResult, mediaDir: string, base: string): string | undefined {
	const shots = result.attachments.filter(
		(a) => a.contentType === "image/png" && (a.path || a.body),
	);
	const shot = shots[shots.length - 1];
	if (!shot) return undefined;
	try {
		fs.mkdirSync(mediaDir, { recursive: true });
		const name = `${base}.png`;
		const target = path.join(mediaDir, name);
		if (shot.path) fs.copyFileSync(shot.path, target);
		else if (shot.body) fs.writeFileSync(target, shot.body);
		return name;
	} catch {
		return undefined;
	}
}

/** Args after `test`, e.g. ["src/tests/checkout/cart.spec.ts", "-g", "Add item"]. */
function cliArgs(): string[] {
	const argv = process.argv;
	const at = argv.indexOf("test");
	return at === -1 ? [] : argv.slice(at + 1);
}

function slug(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "test"
	);
}

function uniqueName(base: string, used: Set<string>): string {
	let name = base;
	for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
	used.add(name);
	return name;
}

export default HistoryReporter;
