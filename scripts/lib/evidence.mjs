import fs from "node:fs";
import path from "node:path";

import { config } from "./config.mjs";

/**
 * Reads the bundle written by evidence-reporter.ts. One results-<env>.json per
 * environment, merged into a single table keyed by test case id.
 */
export function bundleDir(ticket) {
	return path.join(config.evidenceDir, ticket);
}

export function readResults(ticket) {
	const dir = bundleDir(ticket);
	if (!fs.existsSync(dir)) {
		throw new Error(`No evidence bundle at ${dir}. Run: TICKET=${ticket} npm run test:evidence`);
	}
	const files = fs
		.readdirSync(dir)
		.filter((name) => /^results-.*\.json$/.test(name))
		.sort();
	if (!files.length) {
		throw new Error(`No results-<env>.json in ${dir}. Re-run with EVIDENCE=true.`);
	}
	return files.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

/**
 * Merge per-environment runs into rows:
 *   { tc, title, tags, results: { dev: { status, media }, staging: {...} } }
 * Test case ids are re-assigned across the merged set so they stay contiguous.
 */
export function mergeRuns(runs) {
	const byTitle = new Map();
	const environments = [];

	for (const run of runs) {
		const env = run.env || "run";
		if (!environments.includes(env)) environments.push(env);
		for (const testCase of run.cases) {
			const row = byTitle.get(testCase.title) ?? {
				title: testCase.title,
				tags: testCase.tags ?? [],
				file: testCase.file,
				results: {},
			};
			row.results[env] = {
				status: testCase.status,
				media: testCase.media ?? [],
				error: testCase.error,
			};
			byTitle.set(testCase.title, row);
		}
	}

	const rows = [...byTitle.values()].map((row, index) => ({
		...row,
		tc: `TC-${String(index + 1).padStart(3, "0")}`,
	}));

	return { environments, rows };
}

/** Every media file the merged table references, in stable order. */
export function referencedMedia(ticket, rows) {
	const dir = bundleDir(ticket);
	const names = [];
	for (const row of rows) {
		for (const result of Object.values(row.results)) {
			for (const name of result.media ?? []) {
				if (!names.includes(name)) names.push(name);
			}
		}
	}
	return names
		.map((name) => ({ name, file: path.join(dir, name) }))
		.filter((entry) => fs.existsSync(entry.file));
}

export function overallStatus(rows) {
	const statuses = rows.flatMap((row) => Object.values(row.results).map((r) => r.status));
	if (statuses.includes("Fail")) return "Fail";
	if (!statuses.length) return "Unknown";
	return statuses.every((status) => status === "Skipped") ? "Skipped" : "Pass";
}

export function writeSummary(ticket, { environments, rows }) {
	const dir = bundleDir(ticket);
	const header = ["| TC | Case |", "| --- | --- |"];
	const head = `| TC | Case | ${environments.join(" | ")} |`;
	const divider = `| --- | --- | ${environments.map(() => "---").join(" | ")} |`;
	const lines = rows.map((row) => {
		const cells = environments.map((env) => row.results[env]?.status ?? "—");
		return `| ${row.tc} | ${row.title} | ${cells.join(" | ")} |`;
	});
	const body = [
		`# ${ticket} — test summary`,
		"",
		`Generated ${new Date().toISOString()} · overall ${overallStatus(rows)}`,
		"",
		environments.length ? head : header[0],
		environments.length ? divider : header[1],
		...lines,
		"",
	].join("\n");
	const file = path.join(dir, "SUMMARY.md");
	fs.writeFileSync(file, body);
	return file;
}
