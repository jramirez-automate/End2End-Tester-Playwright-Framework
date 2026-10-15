import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { EnvFileSummary } from "../../shared/types.js";
import { maskValue, parseEnvEntries, setEnvValue } from "./mask.js";

/**
 * Per-user canonical credentials store. `.env.*` files are gitignored and
 * absent from fresh worktrees, so provisioning copies them from here. Seeded
 * automatically from the dashboard's own checkout the first time; the
 * credentials editor (SettingsView) manages it explicitly.
 */

const ENV_FILE_RE = /^\.env\./;
const EXCLUDED_FILES = new Set([".env.example", ".env.publish.example"]);
/** Env files the editor always lists, even before they exist. */
const EXPECTED_FILES = [".env.publish"];
/** Strict shape for editor-managed file names — also blocks path traversal. */
const SAFE_FILE_RE = /^\.env\.[\w.-]+$/;

export function configDir(): string {
	if (process.platform === "win32") {
		const appData = process.env["APPDATA"] ?? path.join(homedir(), "AppData", "Roaming");
		return path.join(appData, "e2e-dashboard");
	}
	const xdg = process.env["XDG_CONFIG_HOME"];
	return path.join(xdg && xdg !== "" ? xdg : path.join(homedir(), ".config"), "e2e-dashboard");
}

export function envStoreDir(): string {
	return path.join(configDir(), "env");
}

async function listEnvFiles(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries
			.filter((e) => e.isFile() && ENV_FILE_RE.test(e.name) && !EXCLUDED_FILES.has(e.name))
			.map((e) => e.name)
			.sort();
	} catch {
		return []; // store/source dir absent — empty
	}
}

export function listStoredEnvFiles(): Promise<string[]> {
	return listEnvFiles(envStoreDir());
}

async function secureCopy(from: string, to: string): Promise<void> {
	await copyFile(from, to);
	try {
		await chmod(to, 0o600);
	} catch {
		// win32 has no POSIX modes — best-effort
	}
}

/**
 * Serialize async work per key so a read-modify-write can't interleave with
 * another for the same file — two concurrent field saves would otherwise both
 * read the old content and the second `writeFile` would clobber the first.
 */
const writeChains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, job: () => Promise<T>): Promise<T> {
	const prev = writeChains.get(key) ?? Promise.resolve();
	const run = prev.then(job, job);
	writeChains.set(
		key,
		run.catch(() => {}),
	);
	return run;
}

let tmpCounter = 0;

/** Crash-safe write: fill a private temp file, then atomically rename over the target. */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
	const tmp = `${filePath}.tmp-${process.pid}-${++tmpCounter}`;
	await writeFile(tmp, content, "utf8");
	try {
		await chmod(tmp, 0o600);
	} catch {
		// win32 has no POSIX modes — best-effort
	}
	await rename(tmp, filePath);
}

/** Import `.env.*` (never the `*.example` files) from a checkout's suite root into the store. */
export async function seedFromCheckout(e2eRoot: string): Promise<string[]> {
	const store = envStoreDir();
	await mkdir(store, { recursive: true });
	const names = await listEnvFiles(e2eRoot);
	for (const name of names) {
		await secureCopy(path.join(e2eRoot, name), path.join(store, name));
	}
	return names;
}

/**
 * Copy stored env files into a worktree's suite root. The target is
 * mechanically constrained — it must BE an e2e suite checkout (contains
 * playwright.config.ts, whose `.gitignore` excludes `.env.*`) and every file
 * name starts with ".env." — so credentials can never land in a tracked file.
 */
export async function copyToWorktree(targetE2eRoot: string): Promise<string[]> {
	const resolved = path.resolve(targetE2eRoot);
	if (!existsSync(path.join(resolved, "playwright.config.ts"))) {
		throw new Error(`refusing to copy credentials outside an e2e suite checkout: ${resolved}`);
	}
	const names = await listEnvFiles(envStoreDir());
	for (const name of names) {
		await secureCopy(path.join(envStoreDir(), name), path.join(resolved, name));
	}
	return names;
}

// ---------------------------------------------------------------------------
// Editor operations (C1) — all against the canonical store.
// ---------------------------------------------------------------------------

/** Reject anything that is not a plain .env.<name> file name. */
export function assertSafeFileName(file: string): void {
	if (!SAFE_FILE_RE.test(file) || EXCLUDED_FILES.has(file) || file !== path.basename(file)) {
		throw new Error(`not an editable env file: ${file}`);
	}
}

/** Masked listing of the store — expected files reported even when missing. */
export async function listCredentialFiles(): Promise<Array<EnvFileSummary & { exists: boolean }>> {
	const present = await listEnvFiles(envStoreDir());
	const names = [...EXPECTED_FILES, ...present.filter((n) => !EXPECTED_FILES.includes(n))];
	const out: Array<EnvFileSummary & { exists: boolean }> = [];
	for (const file of names) {
		const exists = present.includes(file);
		let fields: EnvFileSummary["fields"] = [];
		if (exists) {
			const content = await readFile(path.join(envStoreDir(), file), "utf8");
			fields = parseEnvEntries(content).map(({ key, value }) => ({
				key,
				masked: value === "" ? "" : maskValue(value),
				isSet: value !== "",
			}));
		}
		out.push({ file, fields, exists });
	}
	return out;
}

/** The one place a raw value leaves the store — explicit per-field reveal. */
export async function revealField(file: string, key: string): Promise<string> {
	assertSafeFileName(file);
	const content = await readFile(path.join(envStoreDir(), file), "utf8");
	const entry = parseEnvEntries(content).find((e) => e.key === key);
	if (!entry) throw new Error(`${key} is not set in ${file}`);
	return entry.value;
}

/** Set one field (create the file if needed), preserving comments and order. */
export async function setField(file: string, key: string, value: string): Promise<void> {
	assertSafeFileName(file);
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`not a valid env key: ${key}`);
	const filePath = path.join(envStoreDir(), file);
	// Serialized + atomic: concurrent field saves to the same file can't clobber
	// each other, and a crash mid-write can't leave a truncated store.
	await serialize(filePath, async () => {
		await mkdir(envStoreDir(), { recursive: true });
		let content = "";
		try {
			content = await readFile(filePath, "utf8");
		} catch {
			// new file
		}
		await atomicWriteFile(filePath, setEnvValue(content, key, value));
	});
}

/** Create a new env file in the store from the checkout's .env.example (keys, empty values). */
export async function scaffoldEnvFile(file: string, e2eRoot: string): Promise<void> {
	assertSafeFileName(file);
	await mkdir(envStoreDir(), { recursive: true });
	const target = path.join(envStoreDir(), file);
	if (existsSync(target)) throw new Error(`${file} already exists in the store`);
	let template = "";
	try {
		template = await readFile(path.join(e2eRoot, ".env.example"), "utf8");
	} catch {
		// no example — start blank
	}
	const blanked = template
		.split(/\r?\n/)
		.map((line) => {
			const eq = line.indexOf("=");
			if (line.trim().startsWith("#") || eq <= 0) return line;
			return `${line.slice(0, eq)}=`;
		})
		.join("\n");
	await writeFile(target, blanked, "utf8");
	try {
		await chmod(target, 0o600);
	} catch {
		// win32
	}
}

/** Read one value silently (probes) — null when absent. */
export async function readFieldQuietly(file: string, key: string): Promise<string | null> {
	try {
		return await revealField(file, key);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Store metadata (meta.json) — non-secret bookkeeping like token expiry.
// ---------------------------------------------------------------------------

export interface StoreMeta {
	/** ISO date the Jira API token expires (user-maintained). */
	jiraTokenExpiresAt: string | null;
}

const DEFAULT_META: StoreMeta = { jiraTokenExpiresAt: null };

function metaPath(): string {
	return path.join(configDir(), "meta.json");
}

export async function readMeta(): Promise<StoreMeta> {
	try {
		const parsed = JSON.parse(await readFile(metaPath(), "utf8")) as Partial<StoreMeta>;
		return { ...DEFAULT_META, ...parsed };
	} catch {
		return { ...DEFAULT_META };
	}
}

export async function writeMeta(meta: StoreMeta): Promise<void> {
	await mkdir(configDir(), { recursive: true });
	await writeFile(metaPath(), `${JSON.stringify(meta, null, "\t")}\n`, "utf8");
}
