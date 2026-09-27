import fs from "node:fs";
import path from "node:path";
import { request, type APIRequestContext, type APIResponse, type TestInfo } from "@playwright/test";
import { z } from "zod";

/**
 * API testing helpers. Specs normally use the `api` / `anonApi` fixtures from
 * src/fixtures.ts, which build a context here and dispose of it afterwards.
 *
 * The built-in `request` fixture is not used on purpose: it inherits
 * `use.baseURL` (the UI origin) and carries no auth.
 */

/**
 *   token    API_TOKEN in the API_AUTH_HEADER header (default "Authorization: Bearer <token>")
 *   session  the signed-in browser session saved by the setup project (cookie-based APIs)
 *   none     no credentials, for deliberate 401 checks and public endpoints
 */
export type ApiAuth = "token" | "session" | "none";

const SESSION_FILE = path.resolve(__dirname, "../../.auth/user.json");

/**
 * API origin. A base with a path must end in "/" and requests must then omit
 * the leading slash ("orders/42"), or the path prefix is dropped.
 */
export function apiBaseURL(): string {
	const raw = (process.env.API_BASE_URL || process.env.BASE_URL || "").trim();
	return raw && new URL(raw).pathname !== "/" && !raw.endsWith("/") ? `${raw}/` : raw;
}

/** Token when API_TOKEN is set, else the saved session when one exists, else none. */
export function defaultApiAuth(): ApiAuth {
	if ((process.env.API_TOKEN ?? "").trim()) return "token";
	return fs.existsSync(SESSION_FILE) ? "session" : "none";
}

function tokenHeaders(): Record<string, string> {
	const token = (process.env.API_TOKEN ?? "").trim();
	if (!token) throw new Error("API auth is 'token' but API_TOKEN is not set for this environment");
	const header = process.env.API_AUTH_HEADER || "Authorization";
	const scheme = process.env.API_AUTH_SCHEME ?? (header === "Authorization" ? "Bearer" : "");
	return { [header]: scheme ? `${scheme} ${token}` : token };
}

export async function apiContext(auth: ApiAuth = defaultApiAuth()): Promise<APIRequestContext> {
	return request.newContext({
		baseURL: apiBaseURL(),
		extraHTTPHeaders: {
			Accept: "application/json",
			...(auth === "token" ? tokenHeaders() : {}),
		},
		...(auth === "session" ? { storageState: SESSION_FILE } : {}),
	});
}

/**
 * The response body, attached to the report under the current step as
 * "response.json" — an API case's proof, since it has no screenshot. Reads
 * text first so a 204 with an empty body does not throw.
 */
export async function readBody<T = unknown>(res: APIResponse, testInfo: TestInfo): Promise<T> {
	const text = await res.text();
	await testInfo.attach("response.json", {
		body: JSON.stringify(
			{ request: `${res.url()}`, status: res.status(), body: parseOrText(text) },
			null,
			2,
		),
		contentType: "application/json",
	});
	return parseOrText(text) as T;
}

function parseOrText(text: string): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** Message for a status assertion: which URL, and what the server said. */
export async function describeResponse(res: APIResponse): Promise<string> {
	const text = await res.text().catch(() => "");
	return `${res.status()} from ${res.url()}${text ? `\n${text.slice(0, 500)}` : ""}`;
}

/**
 * Validate a body against a schema and return it typed. Keep schemas
 * non-strict (plain z.object) so a new field on the server does not fail the
 * run; the error names the exact field path that broke.
 */
export function parseWith<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
	const result = schema.safeParse(body);
	if (!result.success) {
		throw new Error(`Response does not match the schema:\n${z.prettifyError(result.error)}`);
	}
	return result.data;
}
