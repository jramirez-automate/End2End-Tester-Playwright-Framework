import type { FastifyPluginAsync } from "fastify";
import type { AcquireLockRequest } from "../../shared/types.js";
import type { LockService } from "../locks/semaphores.js";
import { ApiError } from "./api.js";

/**
 * The lock endpoints the shipped client (src/utils/env-lock.ts in the e2e suite) talks
 * to: E2E_ENV_LOCK_URL points at /api/locks and the client appends /acquire
 * and /release. GET /api/locks feeds the occupancy UI and stays separate from
 * /api/status (which is 60s-cached and spawns probe processes).
 */
export const locksPlugin: FastifyPluginAsync<{ locks: LockService }> = async (app, { locks }) => {
	app.post("/api/locks/acquire", async (request) => {
		return locks.acquire(parseAcquireRequest(request.body));
	});

	app.post("/api/locks/release", async (request) => {
		const body = request.body as Record<string, unknown> | null;
		const leaseId = body?.["leaseId"];
		if (typeof leaseId === "string" && leaseId) locks.release(leaseId);
		return { ok: true }; // unknown/expired leases are tolerated — release is best-effort
	});

	app.get("/api/locks", async () => locks.snapshot());
};

function parseAcquireRequest(body: unknown): AcquireLockRequest {
	if (typeof body !== "object" || body === null)
		throw new ApiError(400, "body must be a JSON object");
	const record = body as Record<string, unknown>;
	const env = record["env"];
	if (typeof env !== "string" || env === "") throw new ApiError(400, "env is required");
	const pid = record["pid"];
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
		throw new ApiError(400, "pid must be a positive integer");
	}
	const runId = record["runId"];
	if (runId !== undefined && typeof runId !== "string")
		throw new ApiError(400, "runId must be a string");
	return { env, pid, runId };
}
