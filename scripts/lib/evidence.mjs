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

/** `api` for a case from a `*.api.spec.ts`, otherwise `ui`. */
export const layerOf = (file) => (/\.api\.spec\.[cm]?[jt]s$/.test(file ?? "") ? "api" : "ui");

/** A run written before the reporter recorded groups falls back to the feature folder. */
const featureOf = (file) => file?.match(/(?:^|\/)tests\/([^/]+)\//)?.[1] ?? "";

/** Rows of each group together, groups in the order they first appear. */
const byGroup = (rows) => {
	const order = [...new Set(rows.map((row) => row.group))];
	return order.flatMap((group) => rows.filter((row) => row.group === group));
};

/**
 * Merge per-environment runs into rows:
 *   { tc, title, group, tags, layer, results: { dev: { status, media }, staging: {...} } }
 * Test case ids are re-assigned across the merged set so they stay contiguous:
 * UI cases first and API cases after them, each feature group's cases together.
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
				group: testCase.group ?? featureOf(testCase.file),
				tags: testCase.tags ?? [],
				file: testCase.file,
				layer: layerOf(testCase.file),
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

	const merged = [...byTitle.values()];
	const rows = [
		...byGroup(merged.filter((row) => row.layer === "ui")),
		...byGroup(merged.filter((row) => row.layer === "api")),
	].map((row, index) => ({
		...row,
		tc: `TC-${String(index + 1).padStart(3, "0")}`,
	}));

	return { environments, rows };
}

/**
 * The results table's sections: "UI Tests" then "API Tests" when the run has
 * API cases, otherwise one untitled section holding every row.
 */
export function sectionsByLayer(rows) {
	const api = rows.filter((row) => row.layer === "api");
	if (!api.length) return [{ title: undefined, rows }];
	const ui = rows.filter((row) => row.layer !== "api");
	return [
		...(ui.length ? [{ title: "UI Tests", rows: ui }] : []),
		{ title: "API Tests", rows: api },
	];
}

/** A section's rows cut at each change of feature group, for the group rows. */
export function groupsOf(rows) {
	const groups = [];
	for (const row of rows) {
		const last = groups.at(-1);
		if (last && last.name === row.group) last.rows.push(row);
		else groups.push({ name: row.group, rows: [row] });
	}
	return groups;
}

/**
 * Give each row its planned case's scenario, steps and expected result,
 * matched on the `test` title. Rows with no planned case keep their title.
 */
export function withPlan(rows, cases) {
	return rows.map((row) => {
		const planned = cases.find((entry) => entry.test && entry.test === row.title);
		return planned
			? { ...row, scenario: planned.name, steps: planned.steps, expected: planned.expected }
			: row;
	});
}

/**
 * Every media file the merged table references, in stable order.
 *
 *   traces  also include each referenced case's `<base>-trace.zip`
 *   only    keep names containing this substring
 */
export function referencedMedia(ticket, rows, { traces = false, only } = {}) {
	const dir = bundleDir(ticket);
	const names = [];
	const add = (name) => {
		if (!names.includes(name)) names.push(name);
	};
	for (const row of rows) {
		for (const result of Object.values(row.results)) {
			for (const name of result.media ?? []) {
				add(name);
				if (traces) add(`${mediaBase(name)}-trace.zip`);
			}
		}
	}
	return names
		.filter((name) => !only || name.includes(only))
		.map((name) => ({ name, file: path.join(dir, name) }))
		.filter((entry) => fs.existsSync(entry.file));
}

/** `checkout-dev-FAILED-2.png` → `checkout-dev-FAILED`: the reporter's per-test base name. */
function mediaBase(name) {
	return name.replace(/\.[^.]+$/, "").replace(/-\d+$/, "");
}

/** The failure media of one test case, across every environment it failed on. */
export function failedMedia(ticket, row) {
	const dir = bundleDir(ticket);
	return Object.values(row.results)
		.filter((result) => result.status === "Fail")
		.flatMap((result) => result.media ?? [])
		.filter((name) => name.includes("-FAILED"))
		.map((name) => ({ name, file: path.join(dir, name) }))
		.filter((entry) => fs.existsSync(entry.file));
}

/**
 * The trace of each environment a case failed on, `<base>-trace.zip` beside
 * its `-FAILED` media, with the environment it ran on.
 */
export function failedTraces(ticket, row) {
	const dir = bundleDir(ticket);
	return Object.entries(row.results)
		.filter(([, result]) => result.status === "Fail")
		.flatMap(([env, result]) => {
			const failed = (result.media ?? []).find((name) => name.includes("-FAILED"));
			if (!failed) return [];
			const name = `${mediaBase(failed).replace(/-response$/, "")}-trace.zip`;
			const file = path.join(dir, name);
			return fs.existsSync(file) ? [{ env, name, file }] : [];
		});
}

/**
 * The test-case plan: drafted from the ticket's criteria, then linked to each
 * spec's title (see templates/test-cases.example.json). Cases, not results.
 */
export function planFile(ticket, override) {
	return override ?? path.join(bundleDir(ticket), "test-cases.json");
}

export function readPlan(file) {
	if (!fs.existsSync(file)) {
		throw new Error(`No test-case plan at ${file}. Start from templates/test-cases.example.json.`);
	}
	const plan = JSON.parse(fs.readFileSync(file, "utf8"));
	const cases = plan.cases ?? [];
	const problems = [];
	cases.forEach((entry, index) => {
		const where = entry.tc ?? `case ${index + 1}`;
		if (!/^TC-\d{3}$/.test(entry.tc ?? "")) problems.push(`${where}: tc must look like TC-001`);
		if (!entry.name) problems.push(`${where}: name is required`);
		if (!entry.steps?.length) problems.push(`${where}: at least one step is required`);
		if (!entry.expected) problems.push(`${where}: expected is required`);
		if (entry.layer && !["ui", "api"].includes(entry.layer))
			problems.push(`${where}: layer must be "ui" or "api"`);
	});
	if (!cases.length) problems.push("the plan has no cases");
	if (problems.length) throw new Error(`Invalid plan ${file}:\n  ${problems.join("\n  ")}`);
	return cases;
}

/** What `cases` created, so `mark-pass` records against the same cases and cycle. */
export function zephyrStateFile(ticket) {
	return path.join(bundleDir(ticket), "zephyr.json");
}

export function readZephyrState(ticket) {
	const file = zephyrStateFile(ticket);
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
}

export function writeZephyrState(ticket, state) {
	fs.mkdirSync(bundleDir(ticket), { recursive: true });
	fs.writeFileSync(zephyrStateFile(ticket), `${JSON.stringify(state, null, 2)}\n`);
}

/** What `cycles` created, so a second publish does not create the same cases again. */
export function cyclesStateFile(ticket) {
	return path.join(bundleDir(ticket), "zephyr-cycles.json");
}

export function readCyclesState(ticket) {
	const file = cyclesStateFile(ticket);
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
}

export function writeCyclesState(ticket, state) {
	fs.mkdirSync(bundleDir(ticket), { recursive: true });
	fs.writeFileSync(cyclesStateFile(ticket), `${JSON.stringify(state, null, 2)}\n`);
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
	const table = (sectionRows) => [
		environments.length ? head : header[0],
		environments.length ? divider : header[1],
		...sectionRows.map((row) => {
			const cells = environments.map((env) => row.results[env]?.status ?? "—");
			return `| ${row.tc} | ${row.title} | ${cells.join(" | ")} |`;
		}),
	];
	const body = [
		`# ${ticket} — test summary`,
		"",
		`Generated ${new Date().toISOString()} · overall ${overallStatus(rows)}`,
		"",
		...sectionsByLayer(rows).flatMap((section) => [
			...(section.title ? [`## ${section.title}`, ""] : []),
			...table(section.rows),
			"",
		]),
	].join("\n");
	const file = path.join(dir, "SUMMARY.md");
	fs.writeFileSync(file, body);
	return file;
}
