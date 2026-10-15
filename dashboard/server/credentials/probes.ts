import { readFieldQuietly } from "./store.js";

/**
 * Explicit test-connection probes for the credentials editor — button-driven
 * only, never polled (they hit real external services with real tokens).
 */

const PROBE_TIMEOUT_MS = 10_000;
const ZEPHYR_DEFAULT_API = "https://api.zephyrscale.smartbear.com/v2";
/** Tracker, wiki and test-management credentials, shared with scripts/publish.mjs. */
const PUBLISH_FILE = ".env.publish";

export interface ProbeResult {
	ok: boolean;
	detail: string;
}

export async function probeJira(): Promise<ProbeResult> {
	const base = await readFieldQuietly(PUBLISH_FILE, "JIRA_BASE_URL");
	const email = await readFieldQuietly(PUBLISH_FILE, "JIRA_EMAIL");
	const token = await readFieldQuietly(PUBLISH_FILE, "JIRA_API_TOKEN");
	if (!base || !email || !token)
		return { ok: false, detail: "JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN must be set" };
	try {
		const res = await fetch(`${base.replace(/\/$/, "")}/rest/api/3/myself`, {
			headers: { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` },
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		if (!res.ok)
			return { ok: false, detail: `Jira answered ${res.status} — check the token and email` };
		const me = (await res.json()) as { displayName?: string };
		return { ok: true, detail: `authenticated as ${me.displayName ?? email}` };
	} catch (err) {
		return {
			ok: false,
			detail: `Jira unreachable: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

export async function probeZephyr(): Promise<ProbeResult> {
	const token = await readFieldQuietly(PUBLISH_FILE, "ZEPHYR_API_TOKEN");
	if (!token) return { ok: false, detail: `ZEPHYR_API_TOKEN must be set in ${PUBLISH_FILE}` };
	const api = (
		(await readFieldQuietly(PUBLISH_FILE, "ZEPHYR_API_URL")) ?? ZEPHYR_DEFAULT_API
	).replace(/\/$/, "");
	try {
		const res = await fetch(`${api}/healthcheck`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		return res.ok
			? { ok: true, detail: "Zephyr Scale API reachable" }
			: { ok: false, detail: `Zephyr answered ${res.status} — check the token` };
	} catch (err) {
		return {
			ok: false,
			detail: `Zephyr unreachable: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

const ENV_REQUIRED_KEYS = ["BASE_URL", "E2E_USERNAME", "E2E_PASSWORD"];

/**
 * Cheap honest check for a test env file: required fields present + BASE_URL
 * answers HTTP. A full sign-in probe would need a headless browser — that
 * stays a deliberate, separate action.
 */
export async function probeEnv(file: string): Promise<ProbeResult> {
	const missing: string[] = [];
	for (const key of ENV_REQUIRED_KEYS) {
		if (!(await readFieldQuietly(file, key))) missing.push(key);
	}
	if (missing.length > 0) return { ok: false, detail: `missing: ${missing.join(", ")}` };
	const baseUrl = await readFieldQuietly(file, "BASE_URL");
	try {
		const res = await fetch(baseUrl ?? "", {
			method: "GET",
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		return { ok: true, detail: `fields set; ${baseUrl} answered ${res.status}` };
	} catch (err) {
		return {
			ok: false,
			detail: `${baseUrl} unreachable: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
