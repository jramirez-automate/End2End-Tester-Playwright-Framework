import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StatusReport } from "../shared/types.js";
import { claudeCommand, type ServerConfig } from "./config.js";
import { maskValue, parseEnvEntries } from "./credentials/mask.js";
import { readMeta } from "./credentials/store.js";

/**
 * Read-only integration status for GET /api/status.
 * Probes spawn processes, so the computed report is cached for 60s.
 * Secret values are NEVER returned — every env value is masked.
 */

const CACHE_TTL_MS = 60_000;
const CLAUDE_VERSION_TIMEOUT_MS = 5_000;
const MCP_LIST_TIMEOUT_MS = 15_000;

/** Env files we always report on, even when missing. */
const EXPECTED_ENV_FILES = [".env.publish"] as const;
const EXCLUDED_ENV_FILES = new Set([".env.example", ".env.publish.example"]);

let cachedReport: StatusReport | null = null;
let cachedAtMs = 0;

export async function getStatus(config: ServerConfig): Promise<StatusReport> {
	const now = Date.now();
	if (cachedReport && now - cachedAtMs < CACHE_TTL_MS) return cachedReport;
	cachedReport = await buildReport(config);
	cachedAtMs = now;
	return cachedReport;
}

async function buildReport(config: ServerConfig): Promise<StatusReport> {
	const notes: string[] = [];
	const claude = probeClaude(config);
	if (!claude.ok) notes.push("claude CLI not found");
	const envFiles = scanEnvFiles(config.e2eRoot);
	const jira = envFiles.find((f) => f.file === ".env.publish");
	if (jira?.keys.some((k) => k.key === "JIRA_API_TOKEN")) {
		const { jiraTokenExpiresAt } = await readMeta();
		if (jiraTokenExpiresAt) notes.push(`Jira API token expires ${jiraTokenExpiresAt}`);
	}
	const mcp = probeMcp(config, notes);
	return { claude, envFiles, mcp, notes };
}

// ---------------------------------------------------------------------------
// claude --version
// ---------------------------------------------------------------------------

export function probeClaude(config: ServerConfig): StatusReport["claude"] {
	const command = claudeCommand(config.claudeBin, ["--version"]);
	const result = spawnSync(command.cmd, command.args, {
		encoding: "utf8",
		timeout: CLAUDE_VERSION_TIMEOUT_MS,
		windowsHide: true,
	});
	const ok = result.status === 0 && !result.error;
	const version = ok ? (result.stdout ?? "").trim() : "";
	return { bin: config.claudeBin, version: version === "" ? null : version, ok };
}

// ---------------------------------------------------------------------------
// .env.* files (masked — never return raw values)
// ---------------------------------------------------------------------------

function scanEnvFiles(e2eRoot: string): StatusReport["envFiles"] {
	let discovered: string[] = [];
	try {
		discovered = readdirSync(e2eRoot).filter(
			(name) => name.startsWith(".env.") && !EXCLUDED_ENV_FILES.has(name),
		);
	} catch {
		// e2eRoot unreadable — fall through and report expected files as missing.
	}
	const files = [
		...EXPECTED_ENV_FILES,
		...discovered
			.filter((name) => !EXPECTED_ENV_FILES.includes(name as (typeof EXPECTED_ENV_FILES)[number]))
			.sort(),
	];
	return files.map((file) => {
		const exists = discovered.includes(file);
		return {
			file,
			exists,
			keys: exists ? parseEnvFile(path.join(e2eRoot, file)) : [],
		};
	});
}

/** Masked key listing of one env file (parser + mask shared with the credentials store). */
function parseEnvFile(filePath: string): Array<{ key: string; masked: string }> {
	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch {
		return [];
	}
	// An unset key (KEY=) reads back as an empty string — show it empty, not as a
	// masked "•••" that would imply a secret is set (matches the credentials store).
	return parseEnvEntries(content).map(({ key, value }) => ({
		key,
		masked: value === "" ? "" : maskValue(value),
	}));
}

// ---------------------------------------------------------------------------
// claude mcp list
// ---------------------------------------------------------------------------

function probeMcp(config: ServerConfig, notes: string[]): StatusReport["mcp"] {
	const command = claudeCommand(config.claudeBin, ["mcp", "list"]);
	const result = spawnSync(command.cmd, command.args, {
		encoding: "utf8",
		cwd: config.repoRoot,
		timeout: MCP_LIST_TIMEOUT_MS,
		windowsHide: true,
	});
	if (result.status !== 0 || result.error) {
		notes.push("claude mcp list failed — run it in a terminal to inspect");
		return [];
	}
	return parseMcpList(result.stdout ?? "");
}

/**
 * Best-effort parse of the human-readable `claude mcp list` output.
 * Lines typically look like "name: url/command (SSE) - ✓ Connected" or
 * "name: url/command - transport - ✓ Connected". Lines with a colon that
 * do not match are kept verbatim as {name: line, transport: "", status: ""};
 * colon-less banner lines (e.g. "Checking MCP server health...") are skipped.
 */
function parseMcpList(stdout: string): StatusReport["mcp"] {
	const servers: StatusReport["mcp"] = [];
	for (const rawLine of stdout.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "") continue;
		const colon = line.indexOf(":");
		if (colon <= 0) continue;
		const name = line.slice(0, colon).trim();
		const rest = line.slice(colon + 1).trim();
		if (name === "" || rest === "" || /\s/.test(name)) {
			servers.push({ name: line, transport: "", status: "" });
			continue;
		}
		const segments = rest.split(" - ").map((s) => s.trim());
		if (segments.length < 2) {
			servers.push({ name: line, transport: "", status: "" });
			continue;
		}
		const target = segments[0] ?? "";
		const status = segments[segments.length - 1] ?? "";
		let transport = segments.length >= 3 ? (segments[1] ?? "") : "";
		if (transport === "") {
			const paren = /\(([^)]+)\)\s*$/.exec(target);
			transport = paren?.[1] ?? (/^https?:\/\//.test(target) ? "http" : "stdio");
		}
		servers.push({ name, transport, status });
	}
	return servers;
}
