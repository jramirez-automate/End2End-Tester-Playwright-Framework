import type { FastifyPluginAsync } from "fastify";
import type { PartialAction, RunActionRequest } from "../../shared/types.js";
import { PARTIAL_ACTIONS } from "../runs/actions.js";
import { ApiError, type RunManager } from "./api.js";

/**
 * Partial actions on ENDED runs: rerun failing tests, recapture evidence, and
 * the publish steps (attach / post-comment / mark-pass / plan). Output
 * streams as `action` events on the run's SSE stream; publish actions are
 * expected to be called with dryRun first (the UI enforces the two-step flow).
 */
export const actionsPlugin: FastifyPluginAsync<{ manager: RunManager }> = async (
	app,
	{ manager },
) => {
	app.post<{ Params: { id: string; action: string } }>(
		"/api/runs/:id/actions/:action",
		async (request, reply) => {
			const action = request.params.action as PartialAction;
			if (!PARTIAL_ACTIONS.includes(action)) {
				throw new ApiError(400, `unknown action — expected one of: ${PARTIAL_ACTIONS.join(", ")}`);
			}
			await manager.runAction(request.params.id, action, parseActionRequest(request.body));
			await reply.code(202).send({ ok: true });
		},
	);

	app.delete<{ Params: { id: string } }>("/api/runs/:id/actions", async (request) => {
		manager.abortAction(request.params.id);
		return { ok: true };
	});
};

function parseActionRequest(body: unknown): RunActionRequest {
	if (body === null || body === undefined) return {};
	if (typeof body !== "object") throw new ApiError(400, "body must be a JSON object");
	const record = body as Record<string, unknown>;
	const dryRun = record["dryRun"];
	if (dryRun !== undefined && typeof dryRun !== "boolean")
		throw new ApiError(400, "dryRun must be a boolean");
	return { dryRun };
}
