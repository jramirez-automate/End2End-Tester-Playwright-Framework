import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
	CoverageResponse,
	FeatureCoverage,
	HistoryRun,
	SpecCoverage,
} from "../../shared/types.js";
import { countOutcomes } from "../../shared/history.js";

/** test("…") / test.only / .skip / .fixme / .fail — not test.describe / step / beforeEach. */
const TEST_CALL = /\btest(?:\.(?:only|skip|fixme|fail|slow))?\(\s*["'`]/g;
const TICKET_TAG = /@([A-Z][A-Z0-9]*-\d+)\b/g;

export interface SpecFacts {
	tests: number;
	tickets: string[];
	smoke: boolean;
	seed: boolean;
}

/** Regex facts from a spec's source — good enough for counts, never executed. */
export function parseSpec(source: string): SpecFacts {
	const tickets = [...new Set([...source.matchAll(TICKET_TAG)].map((m) => m[1]!))].sort();
	return {
		tests: [...source.matchAll(TEST_CALL)].length,
		tickets,
		smoke: source.includes("@smoke"),
		seed: source.includes("@seed"),
	};
}

/**
 * src/tests/checkout/a.spec.ts → { app: "src/tests", feature: "checkout" }; a suite
 * that nests per app (src/tests/shop/checkout/a.spec.ts) → { app: "src/tests/shop",
 * feature: "checkout" }; a spec directly in src/tests → feature "(root)".
 */
export function featureOf(file: string): { app: string; feature: string } {
	const parts = file.replace(/^src\/tests\//, "").split("/");
	if (parts.length < 2) return { app: "src/tests", feature: "(root)" };
	if (parts.length === 2) return { app: "src/tests", feature: parts[0]! };
	return { app: `src/tests/${parts[0]}`, feature: parts[1]! };
}

/** Newest run (runs are newest first) that executed a test from each file. */
export function lastRunByFile(runs: HistoryRun[]): Map<string, NonNullable<SpecCoverage["last"]>> {
	const last = new Map<string, NonNullable<SpecCoverage["last"]>>();
	for (const run of runs) {
		const byFile = new Map<string, HistoryRun["tests"]>();
		for (const t of run.tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);
		for (const [file, tests] of byFile) {
			if (last.has(file)) continue;
			last.set(file, {
				at: run.startedAt,
				runId: run.id,
				env: run.env,
				counts: countOutcomes(tests),
			});
		}
	}
	return last;
}

export function groupFeatures(specs: SpecCoverage[]): FeatureCoverage[] {
	const groups = new Map<string, FeatureCoverage>();
	for (const spec of specs) {
		const { app, feature } = featureOf(spec.file);
		const id = `${app}/${feature}`;
		let group = groups.get(id);
		if (!group) {
			group = { app, feature, specs: [], tests: 0, tickets: [] };
			groups.set(id, group);
		}
		group.specs.push(spec);
		group.tests += spec.tests;
		for (const t of spec.tickets) if (!group.tickets.includes(t)) group.tickets.push(t);
		if (spec.last && (!group.last || spec.last.at > group.last.at)) group.last = spec.last;
	}
	for (const g of groups.values()) {
		g.specs.sort((a, b) => a.file.localeCompare(b.file));
		g.tickets.sort();
	}
	return [...groups.values()].sort(
		(a, b) => a.app.localeCompare(b.app) || a.feature.localeCompare(b.feature),
	);
}

async function walk(dir: string, out: string[]): Promise<void> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) await walk(full, out);
		else if (e.isFile() && e.name.endsWith(".spec.ts")) out.push(full);
	}
}

export async function scanCoverage(
	suiteDir: string,
	runsNewestFirst: HistoryRun[],
): Promise<CoverageResponse> {
	const testsDir = path.join(suiteDir, "src", "tests");
	const files: string[] = [];
	await walk(testsDir, files);
	const last = lastRunByFile(runsNewestFirst);
	const specs = await Promise.all(
		files.map(async (full): Promise<SpecCoverage> => {
			const file = path.relative(suiteDir, full).split(path.sep).join("/");
			const facts = parseSpec(await readFile(full, "utf8").catch(() => ""));
			const seen = last.get(file);
			return {
				file,
				kind: file.endsWith(".api.spec.ts") ? "api" : "ui",
				...facts,
				...(seen ? { last: seen } : {}),
			};
		}),
	);
	return { dir: testsDir, features: groupFeatures(specs) };
}
