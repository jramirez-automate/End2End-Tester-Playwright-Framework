import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { PIPELINE_STEPS } from "../../shared/pipeline.js";
import {
	ACTIVE_STATES,
	RUN_EFFORTS,
	RUN_MODELS,
	type ArtifactRef,
	type CreateRunRequest,
	type PartialAction,
	type RunActionRequest,
	type RunEffort,
	type RunEvent,
	type RunModel,
	type RunRecord,
	type UiConfig,
} from "../../shared/types.js";
import type { ServerConfig } from "../config.js";
import { getDoctorReport, probeLogin } from "../doctor.js";
import type { LockService } from "../locks/semaphores.js";
import { isAlive, killTree } from "../procs.js";
import { getStatus } from "../status.js";
import { ActionRunner } from "../runs/actions.js";
import { ArtifactsWatcher } from "../runs/artifactsWatcher.js";
import { Provisioner } from "../runs/provision.js";
import { newRunId, type Registry } from "../runs/registry.js";
import { StepTracker } from "../runs/stepTracker.js";
import { readRunEvents, RunSupervisor } from "../runs/supervisor.js";
import { appendWalEvents, lastWalSeq } from "../runs/wal.js";
import { openSse, sseRunEvents } from "./sse.js";

export class ApiError extends Error {
	constructor(
		readonly statusCode: number,
		message: string,
	) {
		super(message);
	}
}

/** Safe branch-name charset: no leading dash (option injection), no spaces or control chars. */
const BRANCH_RE = /^[A-Za-z0-9][\w./-]*$/;
const WATCHER_GRACE_MS = 30_000;
const AUTO_RESUME_DELAY_MS = 3000;

interface LiveRun {
	supervisor: RunSupervisor;
	tracker: StepTracker;
	watcher: ArtifactsWatcher;
}

/** Wires registry + supervisors + step trackers + artifact watchers per run. */
export class RunManager extends EventEmitter {
	private readonly live = new Map<string, LiveRun>();
	private readonly resumeTimers = new Map<string, NodeJS.Timeout>();
	private readonly actions = new Map<string, ActionRunner>();
	/** Tickets with a create() in flight — closes the window between the dedup
	 * check and the async save, so a double-submit can't spawn twin runs. */
	private readonly creating = new Set<string>();
	/** Per-run event bus — supervisors AND action runners publish here, SSE subscribes here. */
	private readonly buses = new Map<string, EventEmitter>();

	constructor(
		readonly config: ServerConfig,
		private readonly registry: Registry,
	) {
		super();
		// Every open dashboard tab's global SSE stream adds a "run"/"run-removed"
		// listener here; the default cap of 10 would log a false leak warning.
		this.setMaxListeners(0);
	}

	list(): RunRecord[] {
		return this.registry.list();
	}

	get(id: string): RunRecord | undefined {
		return this.registry.get(id);
	}

	mustGet(id: string): RunRecord {
		const run = this.registry.get(id);
		if (!run) throw new ApiError(404, "run not found");
		return run;
	}

	/** Any run left active by a previous server process is dead — reap it. */
	async orphanSweep(): Promise<void> {
		for (const run of this.registry.list()) {
			// A pending auto-resume died with the previous server — hand back the Resume button.
			if (run.state === "failed" && run.autoResumeAttempt !== undefined) {
				delete run.autoResumeAttempt;
				await this.registry.save(run);
			}
			if (!ACTIVE_STATES.includes(run.state)) continue;
			if (run.childPid && isAlive(run.childPid)) killTree(run.childPid);
			const previous = run.state;
			run.state = "interrupted";
			run.error = "orphaned by server restart";
			run.endedAt = new Date().toISOString();
			delete run.childPid;
			run.gate = null;
			await this.registry.save(run);
			// The WAL must agree with the record, or an SSE replay resurrects the stale state.
			await this.appendSweepEvents(run, previous);
		}
	}

	private async appendSweepEvents(run: RunRecord, previous: RunRecord["state"]): Promise<void> {
		const runDir = this.registry.runDir(run.id);
		const lastSeq = await lastWalSeq(runDir);
		const ts = new Date().toISOString();
		await appendWalEvents(runDir, [
			{ seq: lastSeq + 1, ts, kind: "gate", payload: null },
			{ seq: lastSeq + 2, ts, kind: "state", payload: { state: run.state, previous, run } },
		]);
	}

	async create(req: CreateRunRequest): Promise<RunRecord> {
		const duplicate = this.registry
			.list()
			.find((r) => r.ticket === req.ticket && ACTIVE_STATES.includes(r.state));
		if (duplicate) {
			throw new ApiError(409, `an active run for ${req.ticket} already exists (${duplicate.id})`);
		}
		if (this.creating.has(req.ticket)) {
			throw new ApiError(409, `a run for ${req.ticket} is already being created`);
		}
		this.creating.add(req.ticket);
		try {
			return await this.createReserved(req);
		} finally {
			this.creating.delete(req.ticket);
		}
	}

	private async createReserved(req: CreateRunRequest): Promise<RunRecord> {
		// API default is reuse (backward compatible); the form sends an explicit
		// value. DASHBOARD_FORCE_REUSE pins demo mode to this checkout.
		const provision = !(req.reuseCurrentWorktree ?? true) && !this.config.forceReuse;
		const worktreePath = provision
			? path.join(this.config.worktreesRoot, req.ticket)
			: this.config.repoRoot;
		const now = new Date().toISOString();
		const run: RunRecord = {
			id: newRunId(),
			ticket: req.ticket,
			env: req.env,
			extraContext: req.extraContext,
			state: "queued",
			steps: [
				// Step 0 exists only on provisioned runs; it belongs to the Provisioner.
				...(provision ? [{ step: 0, status: "pending" as const }] : []),
				...PIPELINE_STEPS.map((s) => ({ step: s.step, status: "pending" as const })),
			],
			worktreePath,
			e2eRoot: provision ? worktreePath : this.config.e2eRoot,
			createdAt: now,
			updatedAt: now,
			...resolveRunModelEffort(req, this.config),
			costUsd: 0,
			turns: 0,
			gate: null,
			reducedTelemetry: true,
		};
		await this.registry.save(run);
		this.emit("run", run);
		const live = this.wire(run);
		if (provision) {
			const provisioner = new Provisioner(
				{
					repoRoot: this.config.repoRoot,
					worktreesRoot: this.config.worktreesRoot,
					ticket: req.ticket,
					baseBranch: req.baseBranch ?? this.config.baseBranch,
					e2eRootSource: this.config.e2eRoot,
				},
				(line) => live.supervisor.recordProvision(line),
			);
			live.supervisor.startProvisioned(provisioner);
		} else {
			live.supervisor.start();
		}
		return run;
	}

	sendMessage(id: string, text: string): void {
		const run = this.mustGet(id);
		const live = this.live.get(id);
		if (!live || !ACTIVE_STATES.includes(run.state)) {
			throw new ApiError(409, "run has no live claude session");
		}
		try {
			live.supervisor.sendMessage(text);
		} catch (err) {
			throw new ApiError(409, err instanceof Error ? err.message : "failed to send message");
		}
	}

	interrupt(id: string): void {
		const run = this.mustGet(id);
		const live = this.live.get(id);
		if (!live || !ACTIVE_STATES.includes(run.state)) {
			throw new ApiError(409, "run has no live claude session");
		}
		live.supervisor.interrupt();
	}

	async abort(id: string): Promise<void> {
		const run = this.mustGet(id);
		// Idempotent: aborting an already-ended run is a no-op, not an error — a
		// double-click or a click that raced the run's own exit must stay quiet.
		if (!ACTIVE_STATES.includes(run.state)) return;
		const live = this.live.get(id);
		if (live) {
			live.supervisor.abort();
			return;
		}
		// Active without a live supervisor should not happen (orphan sweep), but reap defensively.
		if (run.childPid && isAlive(run.childPid)) killTree(run.childPid);
		const previous = run.state;
		run.state = "aborted";
		run.gate = null;
		run.endedAt = new Date().toISOString();
		delete run.childPid;
		await this.registry.save(run);
		await this.appendSweepEvents(run, previous); // keep the WAL agreeing with the record
		this.emit("run", run);
	}

	/**
	 * Permanently remove an ended run: registry record + on-disk dir. Refuses an
	 * active run (its Claude session still owns the workspace) — abort it first.
	 * Tears down any lingering live/action wiring, then broadcasts a `run-removed`
	 * event so open dashboards drop the card. Leaves the git worktree in place.
	 */
	async delete(id: string): Promise<void> {
		const run = this.mustGet(id);
		if (ACTIVE_STATES.includes(run.state)) {
			throw new ApiError(409, `run is ${run.state} — abort it before deleting`);
		}
		if (this.actions.has(id))
			throw new ApiError(409, "an action is running for this run — stop it first");
		this.cancelAutoResume(id);
		const live = this.live.get(id);
		if (live) {
			live.tracker.stop();
			live.watcher.stop();
			this.live.delete(id);
		}
		this.buses.delete(id);
		await this.registry.remove(id);
		this.emit("run-removed", { id });
	}

	/** Operator-initiated resume: cancels any pending auto-retry and resets its budget. */
	resume(id: string): RunRecord {
		const run = this.mustGet(id);
		this.cancelAutoResume(id);
		delete run.autoResumeAttempt;
		return this.doResume(run);
	}

	/**
	 * Guard every workspace-dependent op (resume, partial actions): a run whose
	 * worktree is gone (provisioning died before creating it, or it was removed)
	 * would otherwise spawn into a missing cwd and surface a cryptic
	 * `spawn npm ENOENT`. Fail clean and point at the only sensible next step.
	 */
	private assertWorkspaceExists(run: RunRecord): void {
		if (!existsSync(run.worktreePath)) {
			throw new ApiError(
				409,
				`the workspace at ${run.worktreePath} no longer exists — delete this run and start a fresh one`,
			);
		}
	}

	private doResume(run: RunRecord): RunRecord {
		if (run.state !== "interrupted" && run.state !== "failed") {
			throw new ApiError(409, `cannot resume a ${run.state} run`);
		}
		this.assertWorkspaceExists(run);
		if (!run.sessionId) throw new ApiError(409, "run has no sessionId to resume");
		let live = this.live.get(run.id);
		if (live) {
			live.tracker.start();
			live.watcher.start();
		} else {
			live = this.wire(run);
		}
		live.supervisor.resume();
		return run;
	}

	private cancelAutoResume(id: string): void {
		const timer = this.resumeTimers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.resumeTimers.delete(id);
		}
	}

	/**
	 * The claude child died unexpectedly — resume the session in the background.
	 * The supervisor stamps autoResumeAttempt (and the give-up note) before the
	 * failed state event, so this only schedules the respawn. A completed turn
	 * resets the budget; when it is spent the Resume button takes over.
	 */
	private maybeAutoResume(id: string): void {
		const run = this.registry.get(id);
		if (!run || run.state !== "failed" || !run.sessionId || run.autoResumeAttempt === undefined)
			return;
		const timer = setTimeout(() => {
			this.resumeTimers.delete(id);
			const current = this.registry.get(id);
			if (!current || current.state !== "failed") return; // the operator got there first
			// Never auto-resume into a ticket that already has another active run.
			const duplicate = this.registry
				.list()
				.find((r) => r.id !== id && r.ticket === current.ticket && ACTIVE_STATES.includes(r.state));
			if (duplicate) return;
			try {
				this.doResume(current);
			} catch {
				// Still failed — the record keeps its Resume affordance.
			}
		}, AUTO_RESUME_DELAY_MS);
		this.resumeTimers.set(id, timer);
	}

	subscribeRun(id: string, listener: (ev: RunEvent) => void): () => void {
		const bus = this.bus(id);
		bus.on("event", listener);
		return () => bus.off("event", listener);
	}

	private bus(id: string): EventEmitter {
		let bus = this.buses.get(id);
		if (!bus) {
			bus = new EventEmitter();
			bus.setMaxListeners(50); // every open tab holds a listener
			this.buses.set(id, bus);
		}
		return bus;
	}

	/** Run a partial action (rerun/recapture/publish) against an ENDED run's workspace. */
	async runAction(id: string, action: PartialAction, req: RunActionRequest): Promise<void> {
		const run = this.mustGet(id);
		if (ACTIVE_STATES.includes(run.state)) {
			throw new ApiError(409, "the run is active — its Claude session owns the workspace");
		}
		this.assertWorkspaceExists(run);
		if (this.actions.has(id))
			throw new ApiError(409, "another action is already running for this run");
		const runner = new ActionRunner(this.config, this.registry, run, action, req);
		this.actions.set(id, runner);
		// Fresh evidence produced by the action lands live, same as during a run.
		const watcher = new ArtifactsWatcher(run.id, run.e2eRoot, run.ticket);
		watcher.on("artifact", (ref: ArtifactRef) => runner.recordArtifact(ref));
		runner.on("event", (ev: RunEvent) => this.bus(id).emit("event", ev));
		runner.on("done", () => {
			this.actions.delete(id);
			watcher.stopSoon(WATCHER_GRACE_MS);
		});
		watcher.start();
		try {
			await runner.start();
		} catch (err) {
			this.actions.delete(id);
			watcher.stop();
			throw new ApiError(409, err instanceof Error ? err.message : "action failed to start");
		}
	}

	abortAction(id: string): void {
		const runner = this.actions.get(id);
		if (!runner) throw new ApiError(409, "no action is running for this run");
		runner.abort();
	}

	replay(id: string, since: number): Promise<RunEvent[]> {
		return readRunEvents(this.registry.runDir(id), since);
	}

	async shutdown(): Promise<void> {
		for (const timer of this.resumeTimers.values()) clearTimeout(timer);
		this.resumeTimers.clear();
		for (const runner of this.actions.values()) runner.abort();
		this.actions.clear();
		for (const { supervisor, tracker, watcher } of this.live.values()) {
			tracker.stop();
			watcher.stop();
			await supervisor.shutdown("server shutdown");
			this.emit("run", supervisor.run);
		}
		this.live.clear();
	}

	private wire(run: RunRecord): LiveRun {
		const tracker = new StepTracker(run.e2eRoot, run.ticket, run.steps);
		const watcher = new ArtifactsWatcher(run.id, run.e2eRoot, run.ticket);
		const supervisor = new RunSupervisor(this.config, this.registry, run, tracker);
		watcher.on("artifact", (ref: ArtifactRef) => supervisor.recordArtifact(ref));
		supervisor.on("event", (ev: RunEvent) => this.bus(run.id).emit("event", ev));
		supervisor.on("run", (r: RunRecord) => this.emit("run", r));
		supervisor.on("exit", () => {
			tracker.stop();
			watcher.stopSoon(WATCHER_GRACE_MS);
			this.maybeAutoResume(run.id);
		});
		tracker.start();
		watcher.start();
		const live: LiveRun = { supervisor, tracker, watcher };
		this.live.set(run.id, live);
		return live;
	}
}

/**
 * Resolve the model/effort a run will use, once, at creation time — request value
 * else server default — so resume and partial actions replay the same settings.
 * Empty/absent values are omitted entirely (= inherit the CLI user's default).
 */
export function resolveRunModelEffort(
	req: Pick<CreateRunRequest, "model" | "effort">,
	config: Pick<ServerConfig, "model" | "effort">,
): { model?: string; effort?: string } {
	const model = req.model ?? config.model;
	const effort = req.effort ?? config.effort;
	return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

export function parseCreateRunRequest(
	body: unknown,
	config: Pick<ServerConfig, "envs" | "ticketPattern">,
): CreateRunRequest {
	if (typeof body !== "object" || body === null)
		throw new ApiError(400, "body must be a JSON object");
	const record = body as Record<string, unknown>;
	const ticket = record["ticket"];
	if (typeof ticket !== "string" || !config.ticketPattern.test(ticket)) {
		throw new ApiError(400, `ticket must match TICKET_PATTERN ${config.ticketPattern.source}`);
	}
	const env = record["env"];
	if (typeof env !== "string" || !config.envs.includes(env)) {
		throw new ApiError(400, `env must be one of: ${config.envs.join(", ")}`);
	}
	const extraContext = record["extraContext"];
	if (extraContext !== undefined && typeof extraContext !== "string") {
		throw new ApiError(400, "extraContext must be a string");
	}
	const reuseCurrentWorktree = record["reuseCurrentWorktree"];
	if (reuseCurrentWorktree !== undefined && typeof reuseCurrentWorktree !== "boolean") {
		throw new ApiError(400, "reuseCurrentWorktree must be a boolean");
	}
	const baseBranch = record["baseBranch"];
	if (baseBranch !== undefined && (typeof baseBranch !== "string" || !BRANCH_RE.test(baseBranch))) {
		throw new ApiError(400, "baseBranch must be a plain branch name");
	}
	const model = record["model"];
	if (
		model !== undefined &&
		(typeof model !== "string" || !RUN_MODELS.includes(model as RunModel))
	) {
		throw new ApiError(400, `model must be one of: ${RUN_MODELS.join(", ")}`);
	}
	const effort = record["effort"];
	if (
		effort !== undefined &&
		(typeof effort !== "string" || !RUN_EFFORTS.includes(effort as RunEffort))
	) {
		throw new ApiError(400, `effort must be one of: ${RUN_EFFORTS.join(", ")}`);
	}
	return {
		ticket,
		env,
		extraContext,
		reuseCurrentWorktree,
		baseBranch,
		model: model as RunModel | undefined,
		effort: effort as RunEffort | undefined,
	};
}

export const apiPlugin: FastifyPluginAsync<{ manager: RunManager; locks?: LockService }> = async (
	app,
	{ manager, locks },
) => {
	app.get("/api/health", async () => ({ ok: true }));

	app.get("/api/status", async () => getStatus(manager.config));

	app.get("/api/config", async (): Promise<UiConfig> => ({
		envs: manager.config.envs,
		envCaps: manager.config.envCaps,
		ticketPattern: manager.config.ticketPattern.source,
		baseBranch: manager.config.baseBranch,
		...(manager.config.trackerBrowseUrl
			? { trackerBrowseUrl: manager.config.trackerBrowseUrl }
			: {}),
	}));

	app.get<{ Querystring: { fresh?: string } }>("/api/doctor", async (request) =>
		getDoctorReport(manager.config, request.query.fresh === "1"),
	);

	// Explicit only — this spends a real Claude turn to prove the login works.
	app.post("/api/doctor/probe-login", async () => probeLogin(manager.config));

	app.get("/api/runs", async () => manager.list());

	app.post("/api/runs", async (request, reply) => {
		// The onboarding gate: required doctor checks must pass before a run can
		// spawn a real Claude session (cheap deterministic checks only).
		if (!manager.config.skipDoctor) {
			const doctor = await getDoctorReport(manager.config);
			if (!doctor.requiredOk) {
				await reply.code(409).send({
					error: "onboarding required — fix the failing checks first",
					code: "onboarding_required",
				});
				return;
			}
		}
		const req = parseCreateRunRequest(request.body, manager.config);
		const run = await manager.create(req);
		await reply.code(201).send(run);
	});

	app.get<{ Params: { id: string } }>("/api/runs/:id", async (request) =>
		manager.mustGet(request.params.id),
	);

	app.delete<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
		await manager.delete(request.params.id);
		reply.code(204);
		return null;
	});

	app.get<{ Params: { id: string } }>("/api/runs/:id/events", async (request, reply) => {
		manager.mustGet(request.params.id); // 404 before the stream is hijacked
		await sseRunEvents(request, reply, {
			replay: (since) => manager.replay(request.params.id, since),
			subscribe: (listener) => manager.subscribeRun(request.params.id, listener),
		});
	});

	app.post<{ Params: { id: string } }>("/api/runs/:id/message", async (request) => {
		const body = request.body as Record<string, unknown> | null;
		const text = body?.["text"];
		if (typeof text !== "string" || text.trim() === "") throw new ApiError(400, "text is required");
		manager.sendMessage(request.params.id, text);
		return { ok: true };
	});

	app.post<{ Params: { id: string } }>("/api/runs/:id/interrupt", async (request) => {
		manager.interrupt(request.params.id);
		return { ok: true };
	});

	app.post<{ Params: { id: string } }>("/api/runs/:id/abort", async (request) => {
		await manager.abort(request.params.id);
		return { ok: true };
	});

	app.post<{ Params: { id: string } }>("/api/runs/:id/resume", async (request) => {
		return manager.resume(request.params.id);
	});

	app.get("/api/events", async (request, reply) => {
		const sse = openSse(request, reply);
		const listener = (run: RunRecord): void => {
			sse.send(`data: ${JSON.stringify({ kind: "run", payload: run })}\n\n`);
		};
		const removeListener = (payload: { id: string }): void => {
			sse.send(`data: ${JSON.stringify({ kind: "run-removed", payload })}\n\n`);
		};
		manager.on("run", listener);
		manager.on("run-removed", removeListener);
		let offLocks: (() => void) | undefined;
		if (locks) {
			const sendLocks = (): void => {
				sse.send(`data: ${JSON.stringify({ kind: "locks", payload: locks.snapshot() })}\n\n`);
			};
			sendLocks(); // occupancy is state, not a delta — prime every new stream
			locks.on("change", sendLocks);
			offLocks = () => locks.off("change", sendLocks);
		}
		sse.onClose(() => {
			manager.off("run", listener);
			manager.off("run-removed", removeListener);
			offLocks?.();
		});
	});
};
