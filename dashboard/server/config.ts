import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DashboardConfig, TestEnv } from "../shared/types.js";
import { parseEnvEntries } from "./credentials/mask.js";

export interface ServerConfig extends DashboardConfig {
	/** Envs the New Run form offers, in promotion order (the Board's columns). */
	envs: TestEnv[];
	/** TICKET_PATTERN from .env.publish — the same one scripts/publish.mjs enforces. */
	ticketPattern: RegExp;
	/** "<JIRA_BASE_URL>/browse/" from .env.publish, for ticket links in the views. */
	trackerBrowseUrl?: string;
	/** Absolute path to the e2e suite root — the repo root in this standalone repo. */
	e2eRoot: string;
	/** Where run records, WALs and thumbnails live (server/data). */
	dataDir: string;
	/** DASHBOARD_FORCE_REUSE=1 — never provision, always run in this checkout (demo mode). */
	forceReuse: boolean;
	/**
	 * Default base branch for fresh worktrees (DASHBOARD_BASE_BRANCH; falls back
	 * to the dashboard checkout's own branch — the base must contain the e2e suite).
	 */
	baseBranch: string;
	/** DASHBOARD_SKIP_DOCTOR=1 — new runs skip the onboarding gate (demo mode). */
	skipDoctor: boolean;
	/**
	 * Default --model for spawned claude sessions (DASHBOARD_MODEL, default "sonnet").
	 * Set DASHBOARD_MODEL="" to inherit the CLI user's own default instead.
	 */
	model: string;
	/** Default --effort for spawned claude sessions (DASHBOARD_EFFORT; unset = inherit). */
	effort?: string;
	/**
	 * The checkout the read-only views (Attention, Tickets, Board, Bugs, Coverage)
	 * read — DASHBOARD_SUITE_DIR, else this repo. Point it at another checkout to
	 * see its src/evidence/ (gitignored, so a fresh worktree has none).
	 */
	suiteDir: string;
	/** <suiteDir>/src/evidence (EVIDENCE_DIR in .env.publish overrides it, as for publish.mjs) */
	evidenceDir: string;
	/** <suiteDir>/COVERAGE.md */
	coveragePath: string;
	/**
	 * Run-history JSON from history-reporter.ts — DASHBOARD_HISTORY_DIR, else
	 * <suiteDir>/run-history. Exported to spawned runs as E2E_HISTORY_DIR so runs in
	 * provisioned worktrees land here too.
	 */
	historyDir: string;
}

const serverDir = path.dirname(fileURLToPath(import.meta.url));
// The dashboard lives at <repo>/dashboard and the e2e suite (src/tests/, src/pages/,
// src/evidence/, .env.*, playwright.config.ts) lives at the repo root.
const dashboardDir = path.resolve(serverDir, "..");
const repoRoot = path.resolve(dashboardDir, "..");

function resolveClaudeBin(): string {
	const fromEnv = process.env["CLAUDE_BIN"];
	// Sentinel for demo mode — avoids POSIX-only $PWD in npm scripts (win32).
	if (fromEnv === "mock") return path.join(serverDir, "mock-claude.mjs");
	if (fromEnv) return fromEnv;
	const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], {
		encoding: "utf8",
		windowsHide: true,
	});
	if (probe.status === 0) return "claude";
	const localBin = path.join(homedir(), ".local", "bin", "claude");
	if (existsSync(localBin)) return localBin;
	return "claude";
}

/**
 * How to spawn the claude binary: Windows cannot exec a shebang script, so a
 * .mjs/.js claudeBin (the demo mock) runs through the current node instead.
 */
export function claudeCommand(claudeBin: string, args: string[]): { cmd: string; args: string[] } {
	if (/\.(mjs|js)$/i.test(claudeBin)) return { cmd: process.execPath, args: [claudeBin, ...args] };
	return { cmd: claudeBin, args };
}

/** The branch a checkout is on — null for a non-repo or detached HEAD. */
export function currentBranch(repoRoot: string): string | null {
	const probe = spawnSync("git", ["-C", repoRoot, "symbolic-ref", "--short", "HEAD"], {
		encoding: "utf8",
		windowsHide: true,
	});
	if (probe.status !== 0) return null;
	const branch = probe.stdout.trim();
	return branch === "" ? null : branch;
}

/** `.env.*` files that hold no test environment. */
const NON_ENV_FILES = new Set([".env.example", ".env.publish", ".env.publish.example"]);
/** Promotion order for the usual names; any other env sorts after them, alphabetically. */
const ENV_ORDER = ["demo", "local", "dev", "staging", "prod"];
const DEFAULT_TICKET_PATTERN = "^[A-Z][A-Z0-9]*-\\d+$";

function list(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * DASHBOARD_ENVS (comma-separated, in promotion order), else `demo` plus every
 * `.env.<name>` in the suite root — the same files TEST_ENV=<name> loads.
 */
export function discoverEnvs(root: string, override = process.env["DASHBOARD_ENVS"]): TestEnv[] {
	const explicit = list(override);
	if (explicit.length) return explicit;
	let names: string[] = [];
	try {
		names = readdirSync(root)
			.filter((f) => f.startsWith(".env.") && !NON_ENV_FILES.has(f) && !f.endsWith(".example"))
			.map((f) => f.slice(".env.".length));
	} catch {
		// unreadable root — demo only
	}
	const rank = (env: string) =>
		ENV_ORDER.includes(env) ? ENV_ORDER.indexOf(env) : ENV_ORDER.length;
	return [...new Set(["demo", ...names])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** DASHBOARD_ENV_CAPS="dev=2,staging=1"; an env not listed runs one at a time. */
export function envCapsFor(
	envs: TestEnv[],
	override = process.env["DASHBOARD_ENV_CAPS"],
): Record<string, number> {
	const caps: Record<string, number> = Object.fromEntries(envs.map((env) => [env, 1]));
	for (const pair of list(override)) {
		const [env, raw] = pair.split("=").map((s) => s.trim());
		const cap = Number(raw);
		if (env && Number.isInteger(cap) && cap > 0) caps[env] = cap;
	}
	return caps;
}

/** One key from the suite's .env.publish, read without loading the file into process.env. */
function publishSetting(root: string, key: string): string | undefined {
	try {
		const content = readFileSync(path.join(root, ".env.publish"), "utf8");
		return parseEnvEntries(content).find((e) => e.key === key)?.value || undefined;
	} catch {
		return undefined;
	}
}

/** A suite checkout's evidence bundles: EVIDENCE_DIR from its .env.publish, else src/evidence. */
export function evidenceRoot(suiteRoot: string): string {
	return path.resolve(
		suiteRoot,
		publishSetting(suiteRoot, "EVIDENCE_DIR") ?? path.join("src", "evidence"),
	);
}

export function buildConfig(): ServerConfig {
	const envPort = Number(process.env["PORT"]);
	const suiteDir = path.resolve(process.env["DASHBOARD_SUITE_DIR"] || repoRoot);
	const envs = discoverEnvs(repoRoot);
	const jiraBase = publishSetting(repoRoot, "JIRA_BASE_URL");
	return {
		port: Number.isFinite(envPort) && envPort > 0 ? envPort : 5511,
		repoRoot,
		worktreesRoot: `${repoRoot}.worktrees`,
		claudeBin: resolveClaudeBin(),
		envs,
		envCaps: envCapsFor(envs),
		ticketPattern: new RegExp(publishSetting(repoRoot, "TICKET_PATTERN") ?? DEFAULT_TICKET_PATTERN),
		...(jiraBase ? { trackerBrowseUrl: `${jiraBase.replace(/\/$/, "")}/browse/` } : {}),
		e2eRoot: repoRoot,
		dataDir: process.env["DASHBOARD_DATA_DIR"] ?? path.join(serverDir, "data"),
		forceReuse: process.env["DASHBOARD_FORCE_REUSE"] === "1",
		baseBranch: process.env["DASHBOARD_BASE_BRANCH"] ?? currentBranch(repoRoot) ?? "main",
		skipDoctor: process.env["DASHBOARD_SKIP_DOCTOR"] === "1",
		model: process.env["DASHBOARD_MODEL"] ?? "sonnet",
		effort: process.env["DASHBOARD_EFFORT"] || undefined,
		suiteDir,
		evidenceDir: evidenceRoot(suiteDir),
		coveragePath: path.join(suiteDir, "COVERAGE.md"),
		historyDir: path.resolve(
			process.env["DASHBOARD_HISTORY_DIR"] || path.join(suiteDir, "run-history"),
		),
	};
}
