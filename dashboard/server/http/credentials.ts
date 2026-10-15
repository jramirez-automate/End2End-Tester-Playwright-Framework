import type { FastifyPluginAsync } from "fastify";
import type { ServerConfig } from "../config.js";
import { probeEnv, probeJira, probeZephyr, type ProbeResult } from "../credentials/probes.js";
import {
	assertSafeFileName,
	copyToWorktree,
	listCredentialFiles,
	listStoredEnvFiles,
	readMeta,
	revealField,
	scaffoldEnvFile,
	seedFromCheckout,
	setField,
	writeMeta,
} from "../credentials/store.js";
import { ApiError } from "./api.js";

/**
 * Credentials manager for the per-user canonical store. The masked list is the
 * default read; raw values leave the server only via the explicit per-field
 * reveal endpoint (127.0.0.1-bound, no-store, never logged).
 */
export const credentialsPlugin: FastifyPluginAsync<{ config: ServerConfig }> = async (
	app,
	{ config },
) => {
	// First-visit seed runs at most once even if several tabs hit GET together —
	// two concurrent seedFromCheckout calls would race the same secureCopy.
	let seedOnce: Promise<unknown> | null = null;

	app.get("/api/credentials", async () => {
		// First visit: a silently empty store would read as "no credentials
		// anywhere" — seed it from the checkout the dashboard runs from.
		if ((await listStoredEnvFiles()).length === 0) {
			seedOnce ??= seedFromCheckout(config.e2eRoot).catch(() => []);
			await seedOnce;
		}
		return { files: await listCredentialFiles(), meta: await readMeta() };
	});

	app.post<{ Params: { file: string } }>("/api/credentials/:file/field", async (request) => {
		const { file } = request.params;
		const body = request.body as Record<string, unknown> | null;
		const key = body?.["key"];
		const value = body?.["value"];
		if (typeof key !== "string" || key === "") throw new ApiError(400, "key is required");
		if (typeof value !== "string") throw new ApiError(400, "value must be a string");
		await guarded(() => setField(file, key, value));
		return { ok: true };
	});

	app.post<{ Params: { file: string } }>(
		"/api/credentials/:file/reveal",
		async (request, reply) => {
			const { file } = request.params;
			const body = request.body as Record<string, unknown> | null;
			const key = body?.["key"];
			if (typeof key !== "string" || key === "") throw new ApiError(400, "key is required");
			const value = await guarded(() => revealField(file, key));
			void reply.header("cache-control", "no-store");
			return { value };
		},
	);

	app.post("/api/credentials/scaffold", async (request) => {
		const body = request.body as Record<string, unknown> | null;
		const file = body?.["file"];
		if (typeof file !== "string") throw new ApiError(400, "file is required");
		await guarded(() => scaffoldEnvFile(file, config.e2eRoot));
		return { ok: true };
	});

	app.post("/api/credentials/import", async () => {
		const files = await seedFromCheckout(config.e2eRoot);
		return { files };
	});

	app.post("/api/credentials/sync", async () => {
		const files = await copyToWorktree(config.e2eRoot);
		return { files };
	});

	app.post<{ Params: { target: string } }>("/api/credentials/test/:target", async (request) => {
		const { target } = request.params;
		let result: ProbeResult;
		if (target === "jira") result = await probeJira();
		else if (target === "zephyr") result = await probeZephyr();
		else {
			assertSafe(target);
			result = await probeEnv(target);
		}
		return result;
	});

	app.post("/api/credentials/meta", async (request) => {
		const body = request.body as Record<string, unknown> | null;
		const jiraTokenExpiresAt = body?.["jiraTokenExpiresAt"];
		if (
			jiraTokenExpiresAt !== null &&
			(typeof jiraTokenExpiresAt !== "string" || Number.isNaN(Date.parse(jiraTokenExpiresAt)))
		) {
			throw new ApiError(400, "jiraTokenExpiresAt must be an ISO date or null");
		}
		await writeMeta({ jiraTokenExpiresAt: jiraTokenExpiresAt as string | null });
		return { ok: true };
	});
};

function assertSafe(file: string): void {
	try {
		assertSafeFileName(file);
	} catch (err) {
		throw new ApiError(400, err instanceof Error ? err.message : "invalid file");
	}
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		throw new ApiError(400, err instanceof Error ? err.message : "credentials operation failed");
	}
}
