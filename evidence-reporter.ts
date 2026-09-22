import fs from "fs";
import path from "path";
import type {
	FullResult,
	Reporter,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";

interface EvidenceReporterOptions {
	/** Root folder for this run, for example evidence/ABC-123. */
	outputDir?: string;
	/** Environment name, appended to every artifact so two runs can coexist. */
	env?: string;
}

/** One row per test, written to results.json for the publishing pipeline. */
interface EvidenceRow {
	tc: string;
	title: string;
	file: string;
	tags: string[];
	status: "Pass" | "Fail" | "Skipped";
	durationMs: number;
	media: string[];
	error?: string;
}

/**
 * Active only when EVIDENCE=true. Copies each test's screenshot, video, and
 * trace to outputDir under a descriptive name, and writes results.json so
 * `npm run publish` never needs a hand-authored table.
 *
 * Copies happen in onEnd because video is not finalised until the context closes.
 */
class EvidenceReporter implements Reporter {
	private outputDir: string;
	private env: string;
	private entries: { test: TestCase; result: TestResult }[] = [];

	constructor(options: EvidenceReporterOptions = {}) {
		this.outputDir = options.outputDir ?? "evidence";
		this.env = options.env ?? process.env.TEST_ENV ?? "";
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		// Setup projects are plumbing, not test cases: keep them out of the table.
		if (test.parent.project()?.name === "setup") return;
		this.entries = this.entries.filter((entry) => entry.test.id !== test.id);
		this.entries.push({ test, result });
	}

	async onEnd(_result: FullResult): Promise<void> {
		fs.mkdirSync(this.outputDir, { recursive: true });
		const used = new Set<string>();
		const envSuffix = this.env ? `-${slug(this.env)}` : "";
		const rows: EvidenceRow[] = [];

		this.entries.sort((a, b) => a.test.title.localeCompare(b.test.title));

		this.entries.forEach(({ test, result }, index) => {
			const skipped = result.status === "skipped";
			const failed = !skipped && result.status !== "passed";
			const base = uniqueName(
				`${slug(test.title)}${envSuffix}${failed ? "-FAILED" : ""}`,
				used,
			);
			const media: string[] = [];

			const screenshots: { fromBody: boolean; ext: string; path?: string; body?: Buffer }[] = [];
			for (const attachment of result.attachments) {
				const fromBody =
					!attachment.path && attachment.body != null && attachment.body.length > 0;
				const fromPath = !!attachment.path && fs.existsSync(attachment.path);
				if (!fromBody && !fromPath) continue;

				const ext = fromPath
					? path.extname(attachment.path!)
					: attachment.contentType === "image/png"
						? ".png"
						: attachment.contentType === "image/jpeg"
							? ".jpg"
							: ".bin";

				if (attachment.name === "screenshot") {
					screenshots.push({
						fromBody,
						ext,
						path: fromPath ? attachment.path : undefined,
						body: fromBody ? Buffer.from(attachment.body as Buffer) : undefined,
					});
					continue;
				}

				let name: string | undefined;
				if (attachment.name === "video") name = `${base}${ext}`;
				else if (attachment.name === "trace") name = `${base}-trace${ext}`;
				if (!name) continue;

				const dest = path.join(this.outputDir, name);
				if (fromPath) fs.copyFileSync(attachment.path!, dest);
				else fs.writeFileSync(dest, attachment.body!);
				if (attachment.name === "video") media.push(name);
			}

			// Mid-test attachments come first: the end-of-test viewport often
			// shows a spinner or the wrong scroll position instead of the subject.
			const ordered = [
				...screenshots.filter((shot) => shot.fromBody),
				...screenshots.filter((shot) => !shot.fromBody),
			];
			ordered.forEach((shot, i) => {
				const name = i === 0 ? `${base}${shot.ext}` : `${base}-${i + 1}${shot.ext}`;
				const dest = path.join(this.outputDir, name);
				if (shot.path) fs.copyFileSync(shot.path, dest);
				else if (shot.body) fs.writeFileSync(dest, shot.body);
				media.unshift(name);
			});

			rows.push({
				tc: `TC-${String(index + 1).padStart(3, "0")}`,
				title: test.title,
				file: path.relative(process.cwd(), test.location.file),
				tags: [...test.tags],
				status: skipped ? "Skipped" : failed ? "Fail" : "Pass",
				durationMs: result.duration,
				media,
				...(failed && result.error?.message
					? { error: firstLine(result.error.message) }
					: {}),
			});
		});

		const summary = {
			env: this.env,
			generatedAt: new Date().toISOString(),
			ticket: process.env.TICKET ?? null,
			totals: {
				pass: rows.filter((row) => row.status === "Pass").length,
				fail: rows.filter((row) => row.status === "Fail").length,
				skipped: rows.filter((row) => row.status === "Skipped").length,
			},
			cases: rows,
		};
		fs.writeFileSync(
			path.join(this.outputDir, `results-${slug(this.env) || "run"}.json`),
			`${JSON.stringify(summary, null, 2)}\n`,
		);

		console.log(`\nEvidence bundle: ${path.resolve(this.outputDir)}`);
	}
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
	let candidate = base;
	let n = 2;
	while (used.has(candidate)) candidate = `${base}-${n++}`;
	used.add(candidate);
	return candidate;
}

function firstLine(message: string): string {
	return message.replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 300);
}

export default EvidenceReporter;
