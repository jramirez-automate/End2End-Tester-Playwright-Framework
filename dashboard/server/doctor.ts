import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { DoctorCheck, DoctorReport } from "../shared/types.js";
import { claudeCommand, type ServerConfig } from "./config.js";
import { configDir, listStoredEnvFiles } from "./credentials/store.js";
import { probeClaude } from "./status.js";

/**
 * Onboarding doctor. Required checks gate POST /api/runs (cheap and
 * deterministic only); advisory checks warn with a fix-it hint. The login
 * probe costs a real Claude turn, so it NEVER runs implicitly — only via the
 * explicit POST /api/doctor/probe-login, and its outcome is remembered in
 * configDir/doctor.json.
 */

const CACHE_TTL_MS = 60_000;
const MIN_NODE_MAJOR = 20;
const LOGIN_PROBE_TIMEOUT_MS = 60_000;

let cached: DoctorReport | null = null;
let cachedAtMs = 0;

export async function getDoctorReport(config: ServerConfig, fresh = false): Promise<DoctorReport> {
	const now = Date.now();
	if (!fresh && cached && now - cachedAtMs < CACHE_TTL_MS) return cached;
	cached = await buildReport(config);
	cachedAtMs = now;
	return cached;
}

async function buildReport(config: ServerConfig): Promise<DoctorReport> {
	const checks: DoctorCheck[] = [];

	const nodeMajor = Number(process.version.replace(/^v/, "").split(".")[0]);
	checks.push({
		id: "node",
		label: `Node ${process.version}`,
		ok: nodeMajor >= MIN_NODE_MAJOR,
		required: true,
		hint: `Node ${MIN_NODE_MAJOR}+ is required — install via nvm or nodejs.org.`,
	});

	const claude = probeClaude(config);
	checks.push({
		id: "claude",
		label: "Claude Code CLI",
		ok: claude.ok,
		required: true,
		hint: "npm i -g @anthropic-ai/claude-code, or set CLAUDE_BIN to the binary.",
		detail: claude.ok ? (claude.version ?? claude.bin) : claude.bin,
	});

	const gitProbe = spawnSync("git", ["-C", config.repoRoot, "rev-parse", "--git-dir"], {
		encoding: "utf8",
		windowsHide: true,
	});
	checks.push({
		id: "git",
		label: "Git repo reachable",
		ok: gitProbe.status === 0,
		required: true,
		hint: "The dashboard must run from inside the frontend repo checkout.",
		detail: config.repoRoot,
	});

	let worktreesWritable = true;
	try {
		accessSync(path.dirname(config.worktreesRoot), constants.W_OK);
	} catch {
		worktreesWritable = false;
	}
	checks.push({
		id: "worktrees",
		label: "Worktrees root writable",
		ok: worktreesWritable,
		required: true,
		hint: "Fresh worktrees are created here — check permissions or set DASHBOARD_BASE_BRANCH/paths.",
		detail: config.worktreesRoot,
	});

	const login = await readLoginProbe();
	checks.push({
		id: "login",
		label: "Claude login",
		ok: login?.ok ?? false,
		unknown: login === null,
		required: false,
		hint: "Run the login probe (costs one real turn), or run `claude` in a terminal and sign in.",
		detail: login?.detail,
	});

	checks.push({
		id: "browsers",
		label: "Playwright browsers",
		ok: existsSync(playwrightCacheDir()),
		required: false,
		hint: "npx playwright install chromium",
		detail: playwrightCacheDir(),
	});

	const storeFiles = await listStoredEnvFiles();
	checks.push({
		id: "credentials",
		label: "Credential store",
		ok: storeFiles.length > 0,
		required: false,
		hint: "Import from this checkout or enter tokens in Settings → Credentials.",
		detail: storeFiles.length > 0 ? storeFiles.join(", ") : "empty",
	});

	return {
		checks,
		requiredOk: checks.every((c) => !c.required || c.ok),
		ranAt: new Date().toISOString(),
	};
}

function playwrightCacheDir(): string {
	if (process.platform === "win32") {
		return path.join(
			process.env["LOCALAPPDATA"] ?? path.join(homedir(), "AppData", "Local"),
			"ms-playwright",
		);
	}
	if (process.platform === "darwin")
		return path.join(homedir(), "Library", "Caches", "ms-playwright");
	return path.join(
		process.env["XDG_CACHE_HOME"] ?? path.join(homedir(), ".cache"),
		"ms-playwright",
	);
}

// ---------------------------------------------------------------------------
// Login probe — explicit, remembered across restarts in configDir/doctor.json.
// ---------------------------------------------------------------------------

interface LoginProbeResult {
	ok: boolean;
	detail: string;
	at: string;
}

function doctorStatePath(): string {
	return path.join(configDir(), "doctor.json");
}

async function readLoginProbe(): Promise<LoginProbeResult | null> {
	try {
		const parsed = JSON.parse(await readFile(doctorStatePath(), "utf8")) as {
			loginProbe?: LoginProbeResult;
		};
		return parsed.loginProbe ?? null;
	} catch {
		return null;
	}
}

/** `claude -p ok` — proves the CLI is signed in. Costs a (tiny) real turn. */
export async function probeLogin(config: ServerConfig): Promise<LoginProbeResult> {
	const env = { ...process.env };
	delete env["ANTHROPIC_API_KEY"]; // prove the subscription login, same as runs
	const command = claudeCommand(config.claudeBin, [
		"-p",
		"Reply with exactly: ok",
		"--max-turns",
		"1",
	]);
	const result = spawnSync(command.cmd, command.args, {
		encoding: "utf8",
		timeout: LOGIN_PROBE_TIMEOUT_MS,
		windowsHide: true,
		env,
	});
	const ok = result.status === 0 && !result.error;
	const probe: LoginProbeResult = {
		ok,
		detail: ok
			? "CLI answered — login works"
			: // `||` not `??`: an EMPTY stderr must fall through to stdout, else the
				// diagnostic is lost when a failure writes only to stdout.
				((result.stderr || result.stdout || "").trim().split("\n").at(-1) ?? "claude -p failed"),
		at: new Date().toISOString(),
	};
	try {
		await mkdir(configDir(), { recursive: true });
		await writeFile(
			doctorStatePath(),
			`${JSON.stringify({ loginProbe: probe }, null, "\t")}\n`,
			"utf8",
		);
	} catch {
		// remembering the result is best-effort
	}
	cached = null; // next doctor report reflects the new outcome
	return probe;
}
