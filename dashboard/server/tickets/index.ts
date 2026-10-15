import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
	BugSummary,
	CoverageEntry,
	EvidenceFile,
	ExternalPipeline,
	TicketDetail,
	TicketSummary,
} from "../../shared/types.js";
import { deriveBugs } from "./bugs.js";
import {
	buildBundle,
	parseBugRecord,
	parseCoverage,
	parsePipelineStatus,
	parseRun,
	tallyEnv,
	type BugRecord,
	type Bundle,
	type EnvRun,
} from "./parse.js";

/** src/evidence/<KEY>/ folders; `artifacts`, `report` etc. are not tickets. */
export const TICKET_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

/** The views rescan at most this often — 100+ folders, each a handful of reads. */
const LIST_TTL_MS = 3000;

/** A pipeline counts as "running outside the dashboard" while its telemetry is this fresh. */
const EXTERNAL_WINDOW_MS = 24 * 60 * 60 * 1000;

interface Scan {
	at: number;
	list: TicketSummary[];
	bugs: BugSummary[];
}

const KIND_BY_EXT: Record<string, EvidenceFile["kind"]> = {
	".png": "image",
	".jpg": "image",
	".jpeg": "image",
	".webm": "video",
	".zip": "trace",
	".har": "trace",
	".json": "json",
	".md": "doc",
	".html": "doc",
	".txt": "doc",
};

async function readText(file: string): Promise<string | undefined> {
	try {
		return await readFile(file, "utf8");
	} catch {
		return undefined;
	}
}

async function readJson(file: string): Promise<unknown> {
	const text = await readText(file);
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** test-cases.json plus every results-<env>.json, merged into one case table. */
async function readBundle(dir: string, names: Set<string>): Promise<Bundle> {
	const runFiles = [...names].filter((n) => /^results-.+\.json$/.test(n)).sort();
	const runs = (
		await Promise.all(
			runFiles.map(async (n) =>
				parseRun(await readJson(path.join(dir, n)), n.slice("results-".length, -".json".length)),
			),
		)
	).filter((r): r is EnvRun => r !== undefined);
	return buildBundle(await readJson(path.join(dir, "test-cases.json")), runs);
}

/** Strip the ledger's markdown emphasis/links for a one-line title fallback. */
function plainFeature(feature: string): string {
	return feature
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/\*\*|`/g, "")
		.trim();
}

export class EvidenceIndex {
	private cache: Scan | null = null;

	constructor(
		private readonly evidenceDir: string,
		private readonly coveragePath: string,
	) {}

	get dir(): string {
		return this.evidenceDir;
	}

	ticketDir(key: string): string {
		return path.join(this.evidenceDir, key);
	}

	private async coverage(): Promise<Map<string, CoverageEntry>> {
		return parseCoverage((await readText(this.coveragePath)) ?? "");
	}

	async list(): Promise<TicketSummary[]> {
		return (await this.scan()).list;
	}

	async bugs(): Promise<BugSummary[]> {
		return (await this.scan()).bugs;
	}

	/**
	 * Pipelines the dashboard didn't start (a terminal /e2e-ticket session) but
	 * whose telemetry moved within the last day and isn't complete. Disk only —
	 * there is no session to attach to.
	 */
	async external(now = Date.now()): Promise<ExternalPipeline[]> {
		return (await this.list())
			.filter((t) => {
				const p = t.pipeline;
				if (!p || p.complete || !p.updatedAt) return false;
				const at = Date.parse(p.updatedAt);
				return Number.isFinite(at) && now - at < EXTERNAL_WINDOW_MS;
			})
			.map((t) => ({ key: t.key, ...(t.title ? { title: t.title } : {}), progress: t.pipeline! }));
	}

	private async scan(): Promise<Scan> {
		if (this.cache && Date.now() - this.cache.at < LIST_TTL_MS) return this.cache;
		let names: string[] = [];
		try {
			names = (await readdir(this.evidenceDir, { withFileTypes: true }))
				.filter((d) => d.isDirectory() && TICKET_KEY.test(d.name))
				.map((d) => d.name);
		} catch {
			// no evidence dir yet — empty tracker
		}
		const coverage = await this.coverage();
		const scanned = await Promise.all(names.map((key) => this.summarize(key, coverage)));
		const summaries = new Map(scanned.map(({ summary }) => [summary.key, summary]));
		const records = new Map(
			scanned
				.filter((s): s is typeof s & { bug: BugRecord } => s.bug !== undefined)
				.map((s) => [s.summary.key, s.bug]),
		);
		const bugs = deriveBugs(
			records,
			summaries,
			new Map(scanned.map(({ summary, bundle }) => [summary.key, bundle.cases])),
		);
		for (const bug of bugs) {
			for (const { ticket } of bug.raisedFrom) {
				const parent = summaries.get(ticket);
				if (parent) parent.findingCount++;
			}
			const own = summaries.get(bug.key);
			if (own) {
				own.kind = "bug";
				own.raisedFrom = bug.raisedFrom
					.map((r) => r.ticket)
					.filter((t, i, all) => all.indexOf(t) === i);
			}
		}
		const list = [...summaries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		this.cache = { at: Date.now(), list, bugs };
		return this.cache;
	}

	async detail(key: string): Promise<TicketDetail | null> {
		if (!TICKET_KEY.test(key)) return null;
		const dir = this.ticketDir(key);
		try {
			if (!(await stat(dir)).isDirectory()) return null;
		} catch {
			return null;
		}
		const coverage = await this.coverage();
		const scan = await this.scan();
		const [{ summary: fresh, bundle }, pipelineText, summaryMd, files] = await Promise.all([
			this.summarize(key, coverage),
			readText(path.join(dir, "pipeline-status.ndjson")),
			readText(path.join(dir, "SUMMARY.md")),
			this.files(dir),
		]);
		const entry = coverage.get(key);
		// kind / raisedFrom only exist after a cross-ticket scan.
		const known = scan.list.find((t) => t.key === key);
		const summary: TicketSummary = known
			? {
					...fresh,
					kind: known.kind,
					findingCount: known.findingCount,
					...(known.raisedFrom ? { raisedFrom: known.raisedFrom } : {}),
				}
			: fresh;
		return {
			...summary,
			cases: bundle.cases,
			// Bugs raised from this ticket: their media are copies of this bundle's own files.
			findings: scan.bugs
				.filter((b) => b.raisedFrom.some((r) => r.ticket === key))
				.map((b) => ({
					title: b.title ?? b.key,
					...(b.description ? { description: b.description } : {}),
					replicate: b.replicate,
					ticket: b.key,
					media: b.media.map((m) => m.name),
				})),
			links: [],
			...(entry ? { coverage: entry } : {}),
			...(summaryMd ? { summaryMd } : {}),
			steps: parsePipelineStatus(pipelineText ?? "").steps,
			files,
		};
	}

	private async summarize(
		key: string,
		coverage: Map<string, CoverageEntry>,
	): Promise<{ summary: TicketSummary; bundle: Bundle; bug?: BugRecord }> {
		const dir = this.ticketDir(key);
		const files = await this.fileStats(dir);
		const [bundle, pipelineText, bugRaw] = await Promise.all([
			readBundle(dir, files.names),
			readText(path.join(dir, "pipeline-status.ndjson")),
			files.names.has("bug.json")
				? readJson(path.join(dir, "bug.json"))
				: Promise.resolve(undefined),
		]);
		const bug = parseBugRecord(bugRaw);
		const entry = coverage.get(key);
		const title = (entry ? plainFeature(entry.area) : undefined) ?? bundle.group;
		const envs: TicketSummary["envs"] = {};
		for (const env of bundle.envs) {
			const tally = tallyEnv(bundle.cases, env);
			if (tally) envs[env] = tally;
		}
		const progress = parsePipelineStatus(pipelineText ?? "").progress;
		const summary: TicketSummary = {
			key,
			kind: "ticket",
			...(title ? { title } : {}),
			envs,
			caseCount: bundle.cases.length,
			findingCount: 0,
			...(progress ? { pipeline: progress } : {}),
			hasSummary: files.names.has("SUMMARY.md"),
			inCoverage: coverage.has(key),
			updatedAt: new Date(files.newestMs).toISOString(),
		};
		return { summary, bundle, ...(bug ? { bug } : {}) };
	}

	/** Top-level file names + newest mtime (the folder's own mtime when empty). */
	private async fileStats(dir: string): Promise<{ names: Set<string>; newestMs: number }> {
		const names = new Set<string>();
		let newestMs = 0;
		try {
			newestMs = (await stat(dir)).mtimeMs;
			for (const d of await readdir(dir, { withFileTypes: true })) {
				if (!d.isFile()) continue;
				names.add(d.name);
				const st = await stat(path.join(dir, d.name));
				if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
			}
		} catch {
			// unreadable folder — leave it at epoch
		}
		return { names, newestMs };
	}

	private async files(dir: string): Promise<EvidenceFile[]> {
		const out: EvidenceFile[] = [];
		try {
			for (const d of await readdir(dir, { withFileTypes: true })) {
				if (!d.isFile()) continue;
				const st = await stat(path.join(dir, d.name));
				out.push({
					name: d.name,
					size: st.size,
					kind: KIND_BY_EXT[path.extname(d.name).toLowerCase()] ?? "other",
				});
			}
		} catch {
			// unreadable folder
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}
}
