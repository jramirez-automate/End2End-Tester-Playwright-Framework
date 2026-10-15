import type { FastifyPluginAsync } from "fastify";
import { scanCoverage } from "../coverage/scan.js";
import { HistoryStore, RUN_ID } from "../history/store.js";
import type { JiraStatusService } from "../jira.js";
import { EvidenceIndex, TICKET_KEY } from "../tickets/index.js";
import { sendJailedFile } from "./files.js";

interface TrackerOptions {
	evidence: EvidenceIndex;
	history: HistoryStore;
	jira: JiraStatusService;
	/** Checkout whose src/tests/ the coverage map scans. */
	suiteDir: string;
}

/**
 * Read-only views: tickets, bugs, coverage, run history, outside-the-dashboard
 * pipelines and Jira status. Nothing here writes or spawns — it reads evidence/,
 * COVERAGE.md, src/tests/ and run-history/, and only GETs from Jira.
 */
export const trackerPlugin: FastifyPluginAsync<TrackerOptions> = async (
	app,
	{ evidence, history, jira, suiteDir },
) => {
	app.get("/api/tickets", async () => ({ dir: evidence.dir, tickets: await evidence.list() }));

	app.get("/api/bugs", async () => evidence.bugs());

	app.get("/api/pipelines/external", async () => evidence.external());

	app.get("/api/coverage", async () => scanCoverage(suiteDir, await history.runs()));

	// Statuses for every ticket and bug the tracker knows. ?fresh=1 skips the 5-minute cache.
	app.get<{ Querystring: { fresh?: string } }>("/api/jira/issues", async (request) => {
		const [tickets, bugs] = await Promise.all([evidence.list(), evidence.bugs()]);
		return jira.issues(
			[...tickets.map((t) => t.key), ...bugs.map((b) => b.key)],
			request.query.fresh === "1",
		);
	});

	app.get<{ Params: { key: string } }>("/api/tickets/:key", async (request, reply) => {
		const detail = await evidence.detail(request.params.key);
		if (!detail) return reply.code(404).send({ error: "ticket not found" });
		return detail;
	});

	app.get<{ Params: { key: string; "*": string } }>(
		"/api/tickets/:key/files/*",
		async (request, reply) => {
			const { key } = request.params;
			if (!TICKET_KEY.test(key)) return reply.code(404).send({ error: "not found" });
			await sendJailedFile(reply, evidence.ticketDir(key), request.params["*"]);
		},
	);

	app.get("/api/history", async () => history.overview());

	app.get<{ Params: { id: string } }>("/api/history/:id", async (request, reply) => {
		const run = await history.run(request.params.id);
		if (!run) return reply.code(404).send({ error: "run not found" });
		return run;
	});

	app.get<{ Params: { id: string; "*": string } }>(
		"/api/history/:id/files/*",
		async (request, reply) => {
			const { id } = request.params;
			if (!RUN_ID.test(id)) return reply.code(404).send({ error: "not found" });
			await sendJailedFile(reply, history.mediaDir(id), request.params["*"]);
		},
	);
};
