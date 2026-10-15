import fs from "fs";
import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";

/**
 * Progress reporter for the E2E Control Room dashboard — wired in
 * playwright.config.ts only when PW_PROGRESS_FILE is set (the dashboard sets
 * it when spawning a run), so manual and CI runs behave exactly as before.
 *
 * Appends one ndjson line per lifecycle event; the dashboard server tails the
 * file and shows the line live under the running command. Every error is
 * swallowed — progress must never fail a test run.
 */
class ProgressReporter implements Reporter {
	private readonly file = process.env.PW_PROGRESS_FILE ?? "";
	private total = 0;
	private finished = 0;

	private append(line: string): void {
		if (!this.file) return;
		try {
			fs.appendFileSync(this.file, `${JSON.stringify({ ts: new Date().toISOString(), line })}\n`);
		} catch {
			// Swallowed — see above.
		}
	}

	onBegin(config: FullConfig, suite: Suite): void {
		this.total = suite.allTests().length;
		this.finished = 0;
		this.append(`Running ${this.total} tests (${config.workers} workers)`);
	}

	onTestBegin(test: TestCase): void {
		this.append(`▶ ${this.finished + 1}/${this.total} ${test.title}`);
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		this.finished += 1;
		const mark = result.status === "passed" ? "✓" : result.status === "skipped" ? "→" : "✘";
		this.append(
			`${mark} ${this.finished}/${this.total} ${test.title} (${(result.duration / 1000).toFixed(1)}s)`,
		);
	}

	onEnd(result: FullResult): void {
		this.append(`Run finished: ${result.status}`);
	}

	printsToStdio(): boolean {
		return false;
	}
}

export default ProgressReporter;
