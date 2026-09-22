import fs from "fs";
import path from "path";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

interface EvidenceReporterOptions {
	/** Folder for this run, for example evidence/ABC-123. */
	outputDir?: string;
	/** Appended to each filename so two environments can sit side by side. */
	env?: string;
}

/**
 * Copies each test's screenshot, video, and trace to outputDir when EVIDENCE=true.
 * Failed tests are suffixed -FAILED. Copies run in onEnd, after video is final.
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
		this.entries = this.entries.filter((entry) => entry.test.id !== test.id);
		this.entries.push({ test, result });
	}

	async onEnd(_result: FullResult): Promise<void> {
		fs.mkdirSync(this.outputDir, { recursive: true });
		const used = new Set<string>();
		const envSuffix = this.env ? `-${slug(this.env)}` : "";

		for (const { test, result } of this.entries) {
			const failed = result.status !== "passed" && result.status !== "skipped";
			const base = uniqueName(
				`${slug(test.title)}${envSuffix}${failed ? "-FAILED" : ""}`,
				used,
			);

			const screenshots: {
				fromBody: boolean;
				ext: string;
				path?: string;
				body?: Buffer;
			}[] = [];

			for (const attachment of result.attachments) {
				const fromBody = !attachment.path && attachment.body != null && attachment.body.length > 0;
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
			}

			const ordered = [
				...screenshots.filter((shot) => shot.fromBody),
				...screenshots.filter((shot) => !shot.fromBody),
			];
			ordered.forEach((shot, index) => {
				const name = index === 0 ? `${base}${shot.ext}` : `${base}-${index + 1}${shot.ext}`;
				const dest = path.join(this.outputDir, name);
				if (shot.path) fs.copyFileSync(shot.path, dest);
				else if (shot.body) fs.writeFileSync(dest, shot.body);
			});
		}

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

export default EvidenceReporter;
