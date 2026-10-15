/**
 * Pure parsers for what /e2e-ticket leaves in src/evidence/<TICKET>/ and for
 * COVERAGE.md:
 *
 *   test-cases.json      the plan (TC-00N cases, `test` = the Playwright title)
 *   results-<env>.json   one per evidence run, written by evidence-reporter.ts
 *   bug.json             a bug's own bundle, written by `publish.mjs bug`
 *
 * Nothing here throws: unknown shapes degrade to empty values.
 */
import type {
	CaseCell,
	CaseVerdict,
	CoverageEntry,
	EnvTally,
	EvidenceEnv,
	PipelineProgress,
	StepStatus,
	TicketCase,
	TicketStepLine,
} from "../../shared/types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function strList(v: unknown): string[] {
	if (typeof v === "string") return v.trim() ? [v] : [];
	return Array.isArray(v)
		? v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
		: [];
}

// ---------------------------------------------------------------------------
// Result cells
// ---------------------------------------------------------------------------

/** evidence-reporter.ts status ("Pass" | "Fail" | "Skipped") → verdict. */
export function parseVerdict(status: string | undefined): CaseVerdict {
	if (!status) return "not-run";
	const text = status.trim().toLowerCase();
	if (text === "pass") return "pass";
	if (text === "fail") return "fail";
	if (text === "skipped") return "skipped";
	return "unknown";
}

export function tallyEnv(cases: TicketCase[], env: EvidenceEnv): EnvTally | undefined {
	let pass = 0;
	let fail = 0;
	let other = 0;
	for (const c of cases) {
		const cell = c.cells[env];
		if (!cell?.result || cell.verdict === "not-run") continue;
		if (cell.verdict === "pass") pass++;
		else if (cell.verdict === "fail") fail++;
		else other++;
	}
	if (pass + fail + other === 0) return undefined;
	const verdict = fail > 0 ? "fail" : other === 0 ? "pass" : pass > 0 ? "partial" : "none";
	return { pass, fail, other, verdict };
}

// ---------------------------------------------------------------------------
// test-cases.json + results-<env>.json
// ---------------------------------------------------------------------------

export interface RunResult {
	title: string;
	group?: string;
	file?: string;
	status: string;
	media: string[];
}

export interface EnvRun {
	env: EvidenceEnv;
	cases: RunResult[];
}

/** One results-<env>.json; the env falls back to the file name's suffix. */
export function parseRun(raw: unknown, fileEnv: string): EnvRun | undefined {
	if (!isRecord(raw)) return undefined;
	const cases: RunResult[] = [];
	for (const c of Array.isArray(raw["cases"]) ? raw["cases"] : []) {
		if (!isRecord(c)) continue;
		const title = str(c["title"]);
		if (!title) continue;
		const group = str(c["group"]);
		const file = str(c["file"]);
		cases.push({
			title,
			...(group ? { group } : {}),
			...(file ? { file } : {}),
			status: str(c["status"]) ?? "",
			media: strList(c["media"]),
		});
	}
	return { env: str(raw["env"]) ?? fileEnv, cases };
}

export interface Bundle {
	cases: TicketCase[];
	/** Envs that ran, in the order their results files sort. */
	envs: EvidenceEnv[];
	/** The first test group (describe title) — a title fallback. */
	group?: string;
}

const layerOf = (file: string | undefined) =>
	/\.api\.spec\.[cm]?[jt]s$/.test(file ?? "") ? "api" : "ui";

function cellOf(result: RunResult): CaseCell {
	return { result: result.status, verdict: parseVerdict(result.status), media: result.media };
}

/**
 * Planned cases first, each with a cell per env whose run has its `test` title.
 * Tests that ran without a planned case follow, by title.
 */
export function buildBundle(plan: unknown, runs: EnvRun[]): Bundle {
	const planned =
		isRecord(plan) && Array.isArray(plan["cases"]) ? plan["cases"].filter(isRecord) : [];
	const used = new Set<string>();
	const cases: TicketCase[] = [];

	for (const p of planned) {
		const test = str(p["test"]);
		const cells: TicketCase["cells"] = {};
		let file: string | undefined;
		for (const run of runs) {
			const hit = test ? run.cases.find((c) => c.title === test) : undefined;
			if (!hit) continue;
			cells[run.env] = cellOf(hit);
			file ??= hit.file;
		}
		if (test) used.add(test);
		const expected = str(p["expected"]);
		const layer = str(p["layer"]) ?? (file ? layerOf(file) : undefined);
		const precondition = str(p["precondition"]);
		cases.push({
			tc: str(p["tc"]) ?? "",
			case: str(p["name"]) ?? test ?? "",
			...(p["manual"] === true ? { by: "manual" } : {}),
			steps: strList(p["steps"]),
			...(expected ? { expectedResult: expected } : {}),
			...(layer ? { layer } : {}),
			...(precondition ? { note: precondition } : {}),
			cells,
		});
	}

	const extra = new Map<string, TicketCase>();
	for (const run of runs) {
		for (const c of run.cases) {
			if (used.has(c.title)) continue;
			const row = extra.get(c.title) ?? {
				tc: "",
				case: c.title,
				steps: [],
				layer: layerOf(c.file),
				cells: {},
			};
			row.cells[run.env] = cellOf(c);
			extra.set(c.title, row);
		}
	}
	cases.push(...[...extra.values()].sort((a, b) => a.case.localeCompare(b.case)));

	const group = runs.flatMap((r) => r.cases).find((c) => c.group)?.group;
	return { cases, envs: runs.map((r) => r.env), ...(group ? { group } : {}) };
}

// ---------------------------------------------------------------------------
// bug.json
// ---------------------------------------------------------------------------

export interface BugRecord {
	raisedFrom: string;
	tc?: string;
	media: string[];
}

/** `{ raisedFrom: "ABC-1", tc?: "TC-002", media: [...] }` written by `publish.mjs bug`. */
export function parseBugRecord(raw: unknown): BugRecord | undefined {
	if (!isRecord(raw)) return undefined;
	const raisedFrom = str(raw["raisedFrom"]);
	if (!raisedFrom) return undefined;
	const tc = str(raw["tc"]);
	return { raisedFrom, ...(tc ? { tc } : {}), media: strList(raw["media"]) };
}

// ---------------------------------------------------------------------------
// pipeline-status.ndjson
// ---------------------------------------------------------------------------

const TELEMETRY_STATUS: Record<string, StepStatus> = {
	started: "active",
	done: "done",
	skipped: "skipped",
	blocked: "blocked",
};

export interface PipelineStatus {
	progress?: PipelineProgress;
	/** Latest line per step, in step order. */
	steps: TicketStepLine[];
}

/** "4" → 4, "1b" → 1.02 — sub-steps sort right after their parent; junk → null. */
export function stepOrder(label: string): number | null {
	const match = /^(\d+)([a-z]?)$/.exec(label);
	if (!match?.[1]) return null;
	const sub = match[2] ? match[2].charCodeAt(0) - 96 : 0;
	return Number(match[1]) + sub / 100;
}

export function parsePipelineStatus(text: string): PipelineStatus {
	const latest = new Map<string, TicketStepLine>();
	let complete = false;
	let lastTs: string | undefined;
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue; // a half-written tail line
		}
		if (!isRecord(entry)) continue;
		const ts = str(entry["ts"]);
		if (ts) lastTs = ts;
		if (entry["pipeline"] === "complete") complete = true;
		const raw = entry["step"];
		const step =
			typeof raw === "number" && Number.isInteger(raw)
				? String(raw)
				: typeof raw === "string"
					? raw
					: "";
		const status = TELEMETRY_STATUS[String(entry["status"])];
		if (stepOrder(step) === null || !status) continue;
		const note = str(entry["note"]) ?? str(entry["reason"]);
		latest.set(step, { step, status, ...(ts ? { ts } : {}), ...(note ? { note } : {}) });
	}
	const steps = [...latest.values()].sort(
		(a, b) => (stepOrder(a.step) ?? 0) - (stepOrder(b.step) ?? 0),
	);
	const last = steps[steps.length - 1];
	if (!last) return { steps };
	return {
		steps,
		progress: {
			step: last.step,
			status: complete ? "done" : last.status,
			complete,
			...(lastTs ? { updatedAt: lastTs } : {}),
			...(last.note ? { note: last.note } : {}),
		},
	};
}

// ---------------------------------------------------------------------------
// COVERAGE.md
// ---------------------------------------------------------------------------

/**
 * Ledger rows keyed by ticket: `| Ticket | Area | Specs | Environments | Notes |`.
 * The ticket cell may be a plain key or a markdown link; rows without a key
 * (`—`) and rows with another column count are skipped.
 */
export function parseCoverage(markdown: string): Map<string, CoverageEntry> {
	const entries = new Map<string, CoverageEntry>();
	for (const line of markdown.split("\n")) {
		if (!line.startsWith("|")) continue;
		const cells = line
			.trim()
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split("|")
			.map((c) => c.trim());
		if (cells.length !== 5) continue;
		const [ticketCell, area, specs, envs, notes] = cells as [
			string,
			string,
			string,
			string,
			string,
		];
		const ticket = /^\[?([A-Z][A-Z0-9]*-\d+)\]?/.exec(ticketCell)?.[1];
		// Newest first — the first row for a ticket wins.
		if (!ticket || entries.has(ticket)) continue;
		entries.set(ticket, { ticket, area, specs, envs, notes });
	}
	return entries;
}
