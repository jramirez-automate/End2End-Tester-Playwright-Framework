import type { JiraIssueInfo, JiraStatusResponse } from "../shared/types.js";
import { readFieldQuietly } from "./credentials/store.js";

/**
 * Read-only Jira status lookup for the tracker views (Board, Bugs, Attention).
 * GET requests only, with the credentials-store .env.publish; results are cached so
 * opening pages never hammers Jira. Pages render without it — every failure is
 * returned as `{ ok: false, error }`, never thrown.
 */

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;
/** JQL `key in (…)` batch size. */
const BATCH = 50;
const KEY = /^[A-Z][A-Z0-9]*-\d+$/;
const CATEGORIES = new Set(["new", "indeterminate", "done"]);

interface Credentials {
	base: string;
	auth: string;
}

interface RawIssue {
	key?: unknown;
	fields?: {
		summary?: unknown;
		status?: { name?: unknown; statusCategory?: { key?: unknown } };
		assignee?: { displayName?: unknown } | null;
		updated?: unknown;
	};
}

export function toIssueInfo(raw: RawIssue): JiraIssueInfo | null {
	if (typeof raw.key !== "string") return null;
	const f = raw.fields ?? {};
	const category = f.status?.statusCategory?.key;
	return {
		key: raw.key,
		summary: typeof f.summary === "string" ? f.summary : "",
		status: typeof f.status?.name === "string" ? f.status.name : "Unknown",
		category:
			typeof category === "string" && CATEGORIES.has(category)
				? (category as JiraIssueInfo["category"])
				: "unknown",
		...(typeof f.assignee?.displayName === "string" ? { assignee: f.assignee.displayName } : {}),
		...(typeof f.updated === "string" ? { updated: f.updated } : {}),
	};
}

export class JiraStatusService {
	private cache: { at: number; keys: string; response: JiraStatusResponse } | null = null;
	private inflight: Promise<JiraStatusResponse> | null = null;

	async issues(keys: string[], fresh = false): Promise<JiraStatusResponse> {
		const wanted = [...new Set(keys.filter((k) => KEY.test(k)))].sort();
		const id = wanted.join(",");
		if (!fresh && this.cache && this.cache.keys === id && Date.now() - this.cache.at < CACHE_MS) {
			return this.cache.response;
		}
		// One lookup at a time — concurrent page loads share it.
		this.inflight ??= this.fetchAll(wanted).finally(() => {
			this.inflight = null;
		});
		const response = await this.inflight;
		if (response.ok) this.cache = { at: Date.now(), keys: id, response };
		return response;
	}

	private async credentials(): Promise<Credentials | null> {
		const [base, email, token] = await Promise.all([
			readFieldQuietly(".env.publish", "JIRA_BASE_URL"),
			readFieldQuietly(".env.publish", "JIRA_EMAIL"),
			readFieldQuietly(".env.publish", "JIRA_API_TOKEN"),
		]);
		if (!base || !email || !token) return null;
		return {
			base: base.replace(/\/$/, ""),
			auth: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
		};
	}

	private async fetchAll(keys: string[]): Promise<JiraStatusResponse> {
		const creds = await this.credentials();
		if (!creds) {
			return {
				ok: false,
				error:
					"Jira status needs JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN — Settings → Credentials.",
				issues: {},
			};
		}
		const issues: Record<string, JiraIssueInfo> = {};
		try {
			for (let i = 0; i < keys.length; i += BATCH) {
				for (const info of await this.batch(creds, keys.slice(i, i + BATCH)))
					issues[info.key] = info;
			}
		} catch (err) {
			return {
				ok: false,
				error: `Jira unreachable: ${err instanceof Error ? err.message : String(err)}`,
				issues,
			};
		}
		return { ok: true, fetchedAt: new Date().toISOString(), issues };
	}

	private async batch(creds: Credentials, keys: string[]): Promise<JiraIssueInfo[]> {
		if (keys.length === 0) return [];
		const params = new URLSearchParams({
			jql: `key in (${keys.join(",")})`,
			fields: "summary,status,assignee,updated",
			maxResults: String(keys.length),
		});
		const res = await this.get(creds, `/rest/api/3/search/jql?${params}`);
		if (res.status === 400) {
			// JQL rejects the whole batch when one key doesn't exist (deleted / moved
			// issue) — fall back to one GET per key and skip the missing ones.
			const one = await Promise.all(keys.map((k) => this.single(creds, k)));
			return one.filter((i): i is JiraIssueInfo => i !== null);
		}
		if (!res.ok) throw new Error(`Jira answered ${res.status}`);
		const body = (await res.json()) as { issues?: RawIssue[] };
		return (body.issues ?? []).map(toIssueInfo).filter((i): i is JiraIssueInfo => i !== null);
	}

	private async single(creds: Credentials, key: string): Promise<JiraIssueInfo | null> {
		const res = await this.get(
			creds,
			`/rest/api/3/issue/${key}?fields=summary,status,assignee,updated`,
		);
		if (!res.ok) return null;
		return toIssueInfo((await res.json()) as RawIssue);
	}

	private get(creds: Credentials, path: string): Promise<Response> {
		return fetch(`${creds.base}${path}`, {
			headers: { Authorization: creds.auth, Accept: "application/json" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	}
}
