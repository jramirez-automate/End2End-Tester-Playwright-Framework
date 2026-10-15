import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { RunRecord, TestResultsSummary } from "../../shared/types.js";
import { evidenceRoot, type ServerConfig } from "../config.js";
import type { Registry } from "../runs/registry.js";
import { sendFileAt, sendJailedFile } from "./files.js";

/** How often the MJPEG stream checks latest.jpeg for a new frame. */
const STREAM_POLL_MS = 100;
/** Idle re-send interval so the stream never looks stalled to the client. */
const STREAM_KEEPALIVE_MS = 2000;

interface ThumbEntry {
	worker: number;
	url: string;
	title?: string;
	ts?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

const LAST_RUN_STATUSES = new Set<TestResultsSummary["status"]>([
	"passed",
	"failed",
	"interrupted",
]);

async function readLastRun(
	file: string,
): Promise<{ mtimeMs: number; summary: TestResultsSummary } | null> {
	try {
		const st = await stat(file);
		const raw: unknown = JSON.parse(await readFile(file, "utf8"));
		if (!isRecord(raw)) return null;
		const status = LAST_RUN_STATUSES.has(raw["status"] as TestResultsSummary["status"])
			? (raw["status"] as TestResultsSummary["status"])
			: "unknown";
		const failedTests = Array.isArray(raw["failedTests"])
			? raw["failedTests"].filter((t): t is string => typeof t === "string")
			: [];
		return { mtimeMs: st.mtimeMs, summary: { status, failedTests } };
	} catch {
		return null;
	}
}

/** Walk the Playwright json-reporter tree collecting flat test rows. */
function collectPwTests(
	node: unknown,
	trail: string[],
	out: NonNullable<TestResultsSummary["tests"]>,
): void {
	if (!isRecord(node)) return;
	const title = typeof node["title"] === "string" ? node["title"] : "";
	const nextTrail = title ? [...trail, title] : trail;
	if (Array.isArray(node["suites"])) {
		for (const suite of node["suites"]) collectPwTests(suite, nextTrail, out);
	}
	if (Array.isArray(node["specs"])) {
		for (const spec of node["specs"]) {
			if (!isRecord(spec)) continue;
			const specTitle = typeof spec["title"] === "string" ? spec["title"] : "";
			const tests = Array.isArray(spec["tests"]) ? spec["tests"] : [];
			for (const test of tests) {
				if (!isRecord(test)) continue;
				const results = Array.isArray(test["results"]) ? test["results"] : [];
				let durationMs = 0;
				let lastStatus = "";
				for (const result of results) {
					if (!isRecord(result)) continue;
					if (typeof result["duration"] === "number") durationMs += result["duration"];
					if (typeof result["status"] === "string") lastStatus = result["status"];
				}
				const outcome =
					typeof test["status"] === "string" ? test["status"] : lastStatus || "unknown";
				out.push({
					title: [...nextTrail, specTitle].filter(Boolean).join(" › "),
					outcome,
					durationMs,
				});
			}
		}
	}
}

export const artifactsPlugin: FastifyPluginAsync<{
	config: ServerConfig;
	registry: Registry;
}> = async (app, { config, registry }) => {
	const getRun = async (id: string, reply: FastifyReply): Promise<RunRecord | null> => {
		const run = registry.get(id);
		if (!run) await reply.code(404).send({ error: "run not found" });
		return run ?? null;
	};

	app.get<{ Params: { id: string } }>("/api/runs/:id/thumbs", async (request, reply) => {
		const run = await getRun(request.params.id, reply);
		if (!run) return;
		const thumbsDir = path.join(config.dataDir, "runs", run.id, "thumbs");
		let entries: string[] = [];
		try {
			entries = await readdir(thumbsDir);
		} catch {
			// no thumbs yet
		}
		const workers: ThumbEntry[] = [];
		for (const name of entries) {
			const match = /^w(\d+)$/.exec(name);
			if (!match || !match[1]) continue;
			const workerDir = path.join(thumbsDir, name);
			if (!existsSync(path.join(workerDir, "latest.jpeg"))) continue;
			const entry: ThumbEntry = {
				worker: Number(match[1]),
				url: `/api/runs/${run.id}/thumbs/${match[1]}`,
			};
			try {
				const meta: unknown = JSON.parse(await readFile(path.join(workerDir, "meta.json"), "utf8"));
				if (isRecord(meta)) {
					if (typeof meta["title"] === "string") entry.title = meta["title"];
					if (typeof meta["ts"] === "string") entry.ts = meta["ts"];
				}
			} catch {
				// meta is best-effort
			}
			workers.push(entry);
		}
		workers.sort((a, b) => a.worker - b.worker);
		await reply.send({ workers });
	});

	app.get<{ Params: { id: string; worker: string } }>(
		"/api/runs/:id/thumbs/:worker",
		async (request, reply) => {
			const run = await getRun(request.params.id, reply);
			if (!run) return;
			if (!/^\d+$/.test(request.params.worker)) {
				await reply.code(404).send({ error: "not found" });
				return;
			}
			const file = path.join(
				config.dataDir,
				"runs",
				run.id,
				"thumbs",
				`w${request.params.worker}`,
				"latest.jpeg",
			);
			await sendFileAt(reply, file, { "content-type": "image/jpeg", "cache-control": "no-store" });
		},
	);

	// MJPEG live stream: pushes latest.jpeg whenever it changes, so an <img>
	// renders the worker's browser as realtime video. Stays open (waiting for
	// frames) even before the first capture lands; ends when the client closes.
	app.get<{ Params: { id: string; worker: string } }>(
		"/api/runs/:id/thumbs/:worker/stream",
		async (request, reply) => {
			const run = await getRun(request.params.id, reply);
			if (!run) return;
			if (!/^\d+$/.test(request.params.worker)) {
				await reply.code(404).send({ error: "not found" });
				return;
			}
			const file = path.join(
				config.dataDir,
				"runs",
				run.id,
				"thumbs",
				`w${request.params.worker}`,
				"latest.jpeg",
			);

			reply.hijack();
			const res = reply.raw;
			res.writeHead(200, {
				"content-type": "multipart/x-mixed-replace; boundary=frame",
				"cache-control": "no-store",
				connection: "keep-alive",
			});

			let lastMtime = 0;
			let lastSentAt = 0;
			let closed = false;
			const sendFrame = async (): Promise<void> => {
				try {
					const st = await stat(file);
					const fresh = st.mtimeMs !== lastMtime;
					// Re-send the current frame every 2s even when idle so proxies
					// and the <img> never treat the stream as stalled.
					if (!fresh && Date.now() - lastSentAt < STREAM_KEEPALIVE_MS) return;
					const buf = await readFile(file);
					if (closed) return;
					lastMtime = st.mtimeMs;
					lastSentAt = Date.now();
					res.write(`--frame\r\ncontent-type: image/jpeg\r\ncontent-length: ${buf.length}\r\n\r\n`);
					res.write(buf);
					res.write("\r\n");
				} catch {
					// No frame yet — keep the connection open and try next tick.
				}
			};
			await sendFrame();
			const timer = setInterval(() => {
				if (!closed) void sendFrame();
			}, STREAM_POLL_MS);
			request.raw.on("close", () => {
				closed = true;
				clearInterval(timer);
				res.end();
			});
		},
	);

	app.get<{ Params: { id: string; "*": string } }>(
		"/api/runs/:id/evidence/*",
		async (request, reply) => {
			const run = await getRun(request.params.id, reply);
			if (!run) return;
			await sendJailedFile(
				reply,
				path.join(evidenceRoot(run.e2eRoot), run.ticket),
				request.params["*"],
			);
		},
	);

	app.get<{ Params: { id: string } }>("/api/runs/:id/results", async (request, reply) => {
		const run = await getRun(request.params.id, reply);
		if (!run) return;
		const candidates = await Promise.all([
			readLastRun(path.join(run.e2eRoot, "test-results", ".last-run.json")),
			readLastRun(path.join(evidenceRoot(run.e2eRoot), run.ticket, "artifacts", ".last-run.json")),
		]);
		let best: { mtimeMs: number; summary: TestResultsSummary } | null = null;
		for (const candidate of candidates) {
			if (candidate && (!best || candidate.mtimeMs > best.mtimeMs)) best = candidate;
		}
		const summary: TestResultsSummary = best?.summary ?? { status: "unknown", failedTests: [] };
		try {
			const raw: unknown = JSON.parse(
				await readFile(path.join(config.dataDir, "runs", run.id, "pw-results.json"), "utf8"),
			);
			const tests: NonNullable<TestResultsSummary["tests"]> = [];
			collectPwTests(raw, [], tests);
			if (tests.length > 0) summary.tests = tests;
		} catch {
			// json reporter output not present for this run
		}
		await reply.send(summary);
	});
};
