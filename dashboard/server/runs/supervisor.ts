import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	closeSync,
	createWriteStream,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	statSync,
	type WriteStream,
} from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { inferStepFromTool, stepDef, type ToolUseLike } from "../../shared/pipeline.js";
import {
	ACTIVE_STATES,
	AUTO_RESUME_MAX,
	type ArtifactRef,
	type ClaudeStreamMessage,
	type GateInfo,
	type RunEvent,
	type RunEventKind,
	type RunRecord,
	type RunState,
	type StepState,
	type StepStatus,
} from "../../shared/types.js";
import { claudeCommand, type ServerConfig } from "../config.js";
import { killTree, signalTree } from "../procs.js";
import { cleanSpawnEnv } from "../spawnEnv.js";
import { afterCrash, isForwardProgress } from "./autoResume.js";
import { buildSessionArgs } from "./claudeArgs.js";
import type { Provisioner } from "./provision.js";
import type { Registry } from "./registry.js";
import { assertTransition } from "./stateMachine.js";
import type { StepTracker } from "./stepTracker.js";

const GATE_QUESTION_MAX = 2000;
const INTERRUPT_FALLBACK_MS = 3000;
const PROGRESS_POLL_MS = 500;
const ABORT_KILL_DELAY_MS = 1000;
const PERSIST_THROTTLE_MS = 1000;
const DEFAULT_QUICK_REPLIES = ["Yes, proceed", "No, skip this step"];

const WAL_FILE = "events.ndjson";

/** Replay the per-run write-ahead log, returning events with seq > since. */
export async function readRunEvents(runDir: string, since: number): Promise<RunEvent[]> {
	let text: string;
	try {
		text = await readFile(path.join(runDir, WAL_FILE), "utf8");
	} catch {
		return [];
	}
	const events: RunEvent[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const ev = JSON.parse(trimmed) as RunEvent;
			if (typeof ev.seq === "number" && ev.seq > since) events.push(ev);
		} catch {
			// partial trailing line from a crash — skip
		}
	}
	return events;
}

/** The question is at the end of the assistant text — keep the tail. */
function tail(text: string, max: number): string {
	return text.length <= max ? text : `…${text.slice(text.length - max + 1)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

/**
 * Owns one `claude -p --input/output-format stream-json` child for a run:
 * spawn/respawn(--resume), WAL append, stdout NDJSON parsing, RunRecord
 * updates, gate detection. Emits: "event" (RunEvent), "run" (RunRecord on
 * persist), "exit" (child gone).
 */
export class RunSupervisor extends EventEmitter {
	readonly run: RunRecord;

	private child: ChildProcessWithoutNullStreams | null = null;
	private provisioner: Provisioner | null = null;
	private wal: WriteStream | null = null;
	private seq = 0;
	private persistTimer: NodeJS.Timeout | null = null;
	private persistDirty = false;
	private interruptTimer: NodeJS.Timeout | null = null;
	private progressTimer: NodeJS.Timeout | null = null;
	private progressOffset = 0;
	/** High-water pipeline step — the auto-resume budget only refreshes past it. */
	private maxStepSeen = 0;
	/** Count of live-only events since the last persisted event (fractional seq spacing). */
	private ephemeralSeq = 0;
	/** Tracker completed before the child was running — finish once it reaches "running". */
	private completeWhenRunning = false;
	/** Set once the run has ended and the WAL is closed — never reopen it. */
	private walClosed = false;

	constructor(
		private readonly config: ServerConfig,
		private readonly registry: Registry,
		run: RunRecord,
		private readonly tracker: StepTracker,
	) {
		super();
		this.run = run;
		this.seq = this.restoreSeq();
		this.maxStepSeen = this.run.steps.reduce(
			(m, s) => (s.status !== "pending" && s.step > m ? s.step : m),
			0,
		);
		tracker.on("step", (state: StepState) => {
			this.record("step", state);
			this.persistSoon();
		});
		tracker.on("telemetry", () => {
			if (this.run.reducedTelemetry !== false) {
				this.run.reducedTelemetry = false;
				this.persistSoon();
			}
		});
		tracker.on("complete", () => {
			// "completed" is only a legal transition from running/waiting_gate. If the
			// tracker completes earlier (e.g. resuming a run whose telemetry already
			// holds pipeline:complete, read during "starting"), defer until the child
			// is up — otherwise setState throws, is swallowed, and the run dead-ends.
			if (this.run.state === "running" || this.run.state === "waiting_gate") this.finishCompleted();
			else if (ACTIVE_STATES.includes(this.run.state)) this.completeWhenRunning = true;
		});
	}

	private get runDir(): string {
		return this.registry.runDir(this.run.id);
	}

	/** Fresh run: spawn and send the initial /e2e-ticket command. */
	start(): void {
		this.setState("starting");
		this.spawnChild(false);
		const command = `/e2e-ticket ${this.run.ticket}${this.run.extraContext ? ` ${this.run.extraContext}` : ""}`;
		this.writeUserMessage(command);
	}

	/**
	 * Fresh run in a fresh worktree: stream provisioning as the visible step 0,
	 * then fall into the normal start(). Step 0 belongs to the provisioner, not
	 * the StepTracker — telemetry and tool inference can never touch it.
	 */
	startProvisioned(provisioner: Provisioner): void {
		this.provisioner = provisioner;
		this.setState("provisioning");
		this.setStepZero("active");
		void provisioner.run().then(
			() => {
				this.provisioner = null;
				if (this.run.state !== "provisioning") return; // aborted/interrupted meanwhile
				this.setStepZero("done");
				this.start();
			},
			(err: unknown) => {
				this.provisioner = null;
				const message = `provisioning failed: ${err instanceof Error ? err.message : String(err)}`;
				this.recordProvision(message);
				if (this.run.state !== "provisioning") return;
				this.run.error = message;
				this.setState("failed");
			},
		);
	}

	/** WAL one provisioning output line (wired to the Provisioner by the RunManager). */
	recordProvision(line: string): void {
		this.record("provision", { line });
	}

	private setStepZero(status: StepStatus): void {
		const now = new Date().toISOString();
		let zero = this.run.steps.find((s) => s.step === 0);
		if (!zero) {
			zero = { step: 0, status: "pending" };
			this.run.steps = [zero, ...this.run.steps];
		}
		zero.status = status;
		if (status === "active") zero.startedAt = zero.startedAt ?? now;
		else zero.endedAt = now;
		this.record("step", zero);
		this.persistSoon();
	}

	/** Respawn with --resume <sessionId>; do NOT resend the initial command. */
	resume(): void {
		delete this.run.error;
		delete this.run.endedAt; // live again — the header clock resumes ticking
		this.clearGate();
		this.setState("starting");
		this.spawnChild(true);
		// A resumed -p session sits idle until stdin speaks — without a nudge the
		// run stays "starting" forever with zero output.
		this.writeUserMessage(
			`[Control Room] The previous session was interrupted (crash or server restart) and has been resumed. ` +
				`Re-establish where the /e2e-ticket ${this.run.ticket} pipeline stands ` +
				`(src/evidence/${this.run.ticket}/ — test-cases.json and results-*.json — recent test output, the working tree), ` +
				`then continue from the current step. If a long command was cut mid-run, rerun it.`,
		);
	}

	sendMessage(text: string): void {
		if (!this.child || !this.child.stdin.writable) {
			throw new Error("run has no live claude session");
		}
		this.writeUserMessage(text);
		this.clearGate();
		if (this.run.state === "waiting_gate") this.setState("running");
		this.persistSoon();
	}

	interrupt(): void {
		if (!this.child) return;
		const frame = {
			type: "control_request",
			request_id: randomUUID(),
			request: { subtype: "interrupt" },
		};
		try {
			this.child.stdin.write(`${JSON.stringify(frame)}\n`);
		} catch {
			// stdin already closed — fall through to the signal fallback
		}
		this.clearInterruptTimer();
		// If the child keeps streaming past 3s, escalate to SIGINT on the group.
		this.interruptTimer = setTimeout(() => {
			this.interruptTimer = null;
			const pid = this.child?.pid;
			if (pid) signalTree(pid, "SIGINT");
		}, INTERRUPT_FALLBACK_MS);
	}

	abort(): void {
		this.provisioner?.cancel();
		this.clearGate();
		this.setState("aborted");
		this.persistSoon();
		if (!this.child) return;
		this.interrupt();
		const pid = this.child.pid;
		setTimeout(() => {
			if (pid && this.child?.pid === pid) killTree(pid);
		}, ABORT_KILL_DELAY_MS);
	}

	/** Server shutdown: kill the child and persist an interrupted state. */
	async shutdown(note: string): Promise<void> {
		this.provisioner?.cancel();
		this.clearInterruptTimer();
		this.stopProgressTail();
		const pid = this.child?.pid ?? this.run.childPid;
		if (pid) killTree(pid);
		this.child = null;
		if (ACTIVE_STATES.includes(this.run.state)) {
			this.run.error = note;
			// Through setState so the WAL records the transition — a replayed WAL
			// that still ends on an active snapshot resurrects the dead run in
			// every tab that opens it (same rule as the orphan sweep).
			this.clearGate();
			this.setState("interrupted");
		}
		delete this.run.childPid;
		this.run.steps = this.mergedSteps();
		this.wal?.end();
		this.wal = null;
		this.walClosed = true; // shutdown is terminal — no reopen on a late record
		await this.registry.save(this.run);
	}

	/** WAL an artifact event (wired to the ArtifactsWatcher by the RunManager). */
	recordArtifact(ref: ArtifactRef): void {
		this.record("artifact", ref);
	}

	// -------------------------------------------------------------------------
	// Child process
	// -------------------------------------------------------------------------

	private spawnChild(resume: boolean): void {
		const args = buildSessionArgs(this.run, resume);

		const env = cleanSpawnEnv();
		delete env["ANTHROPIC_API_KEY"]; // must use the subscription login
		env["THUMBS_DIR"] = path.join(this.runDir, "thumbs");
		env["PW_JSON_OUTPUT"] = path.join(this.runDir, "pw-results.json");
		env["PW_PROGRESS_FILE"] = path.join(this.runDir, "pw-progress.ndjson");
		env["E2E_HISTORY_DIR"] = this.config.historyDir; // one history across worktrees
		// Activate the env-lock client (src/utils/env-lock.ts) inside every Playwright
		// run this session spawns. npm scripts that set TEST_ENV explicitly still
		// win — the lock keys off the env actually being exercised.
		env["E2E_ENV_LOCK_URL"] = `http://127.0.0.1:${this.config.port}/api/locks`;
		env["DASHBOARD_RUN_ID"] = this.run.id;
		env["TEST_ENV"] = this.run.env;

		const command = claudeCommand(this.config.claudeBin, args);
		const child = spawn(command.cmd, command.args, {
			// The run's own workspace — the provisioned worktree, or this checkout when reusing.
			cwd: this.run.worktreePath,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			detached: process.platform !== "win32", // own process group => killable tree
			windowsHide: true,
		});
		this.child = child;
		this.run.childPid = child.pid;
		this.persistSoon();

		// A broken pipe (child died as we write a gate answer / interrupt) surfaces as
		// an async 'error' on stdin; with no listener Node rethrows it as an uncaught
		// exception and takes the whole server down. Absorb it into the WAL instead.
		child.stdin.on("error", (err: Error) => {
			this.record("error", { message: `stdin write failed: ${err.message}` });
		});

		createInterface({ input: child.stdout }).on("line", (line) => this.onStdoutLine(line));
		createInterface({ input: child.stderr }).on("line", (line) => {
			if (line.trim()) this.record("error", { message: line });
		});
		this.startProgressTail();
		child.on("error", (err) => {
			this.record("error", { message: `spawn failed: ${err.message}` });
			if (ACTIVE_STATES.includes(this.run.state)) {
				this.run.error = `spawn failed: ${err.message}`;
				this.setState("failed");
			}
		});
		child.on("exit", (code, signal) => this.onExit(code, signal));
	}

	private onExit(code: number | null, signal: NodeJS.Signals | null): void {
		this.clearInterruptTimer();
		this.stopProgressTail();
		this.child = null;
		delete this.run.childPid;
		if (ACTIVE_STATES.includes(this.run.state)) {
			if (code === 0) {
				// A clean exit after the pipeline definitively completed (telemetry
				// pipeline:complete) is a completion, not a resumable interruption —
				// covers the race where the child exits before the tracker's event lands.
				const done =
					this.tracker.isComplete() &&
					(this.run.state === "running" || this.run.state === "waiting_gate");
				this.clearGate();
				this.setState(done ? "completed" : "interrupted");
			} else {
				this.run.error = `claude exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`;
				// Auto-resume bookkeeping happens BEFORE the state event so the WAL
				// snapshot (which the web store replays) already carries it. The
				// RunManager schedules the actual respawn off the "exit" event.
				if (this.run.sessionId) {
					const next = afterCrash(this.run.autoResumeAttempt, AUTO_RESUME_MAX);
					if (next.giveUp) {
						delete this.run.autoResumeAttempt;
						this.run.error += ` — auto-resume gave up after ${AUTO_RESUME_MAX} attempts`;
					} else {
						this.run.autoResumeAttempt = next.attempt;
					}
				}
				this.setState("failed");
			}
		}
		this.persistNow();
		this.wal?.end();
		this.wal = null;
		this.walClosed = true; // an async persist rejection must not reopen a fresh WAL stream
		this.emit("exit");
	}

	// -------------------------------------------------------------------------
	// stream-json handling
	// -------------------------------------------------------------------------

	private onStdoutLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			return; // tolerate non-JSON lines
		}
		if (!isRecord(parsed) || typeof parsed["type"] !== "string") return;
		this.handleMessage(parsed as ClaudeStreamMessage);
	}

	private handleMessage(msg: ClaudeStreamMessage): void {
		switch (msg.type) {
			case "system":
				this.record("claude", msg);
				if (msg.subtype === "init" && typeof msg.session_id === "string") {
					this.run.sessionId = msg.session_id;
					if (this.run.state === "starting") this.setState("running");
					this.tracker.markInferred(1);
					this.persistSoon();
					// A completion that arrived before the child was up (deferred above).
					if (this.completeWhenRunning && this.run.state === "running") {
						this.completeWhenRunning = false;
						this.finishCompleted();
					}
				}
				break;
			case "assistant":
				this.onAssistant(msg);
				break;
			case "result":
				this.onResult(msg);
				break;
			case "control_response":
				this.record("claude", msg);
				this.clearInterruptTimer(); // the interrupt was acknowledged
				break;
			default:
				// stream_event partials are live-only (see recordEphemeral); user
				// tool-results and anything new are persisted normally.
				if (msg.type === "stream_event") this.recordEphemeral("claude", msg);
				else this.record("claude", msg);
		}
	}

	private onAssistant(msg: ClaudeStreamMessage): void {
		this.record("claude", msg);
		const content = msg.message?.content;
		if (!Array.isArray(content)) return;
		const texts: string[] = [];
		for (const block of content) {
			if (!isRecord(block)) continue;
			if (block["type"] === "text" && typeof block["text"] === "string") {
				texts.push(block["text"]);
			} else if (block["type"] === "tool_use" && typeof block["name"] === "string") {
				const input = block["input"];
				const tool: ToolUseLike = { name: block["name"], input: isRecord(input) ? input : {} };
				const step = inferStepFromTool(tool);
				if (step !== null) this.tracker.markInferred(step);
			}
		}
		if (texts.length > 0) {
			this.run.lastAssistantText = texts.join("\n");
			this.persistSoon();
		}
	}

	private onResult(msg: ClaudeStreamMessage): void {
		this.record("claude", msg);
		this.clearInterruptTimer(); // a result means the turn ended
		this.run.turns += 1;
		// A completed turn refreshes the auto-resume budget ONLY when the pipeline has
		// advanced to a new step. Resetting on every result lets a session that emits
		// one result then crashes each cycle reset the counter forever (infinite respawn).
		const progressStep = this.tracker.currentStep();
		if (isForwardProgress(progressStep, this.maxStepSeen)) {
			this.maxStepSeen = progressStep;
			delete this.run.autoResumeAttempt;
		}
		// total_cost_usd is cumulative for the session — assign, don't add.
		if (typeof msg.total_cost_usd === "number") this.run.costUsd = msg.total_cost_usd;
		if (this.tracker.isComplete()) {
			this.finishCompleted();
			return;
		}
		if (this.run.state !== "running") {
			this.persistSoon();
			return;
		}
		const step = this.tracker.currentStep();
		const gate: GateInfo = {
			question: tail(this.run.lastAssistantText ?? "", GATE_QUESTION_MAX),
			step,
			quickReplies: stepDef(step)?.gate?.quickReplies ?? DEFAULT_QUICK_REPLIES,
			raisedAt: new Date().toISOString(),
		};
		this.run.gate = gate;
		this.setState("waiting_gate");
		this.record("gate", gate);
		this.persistSoon();
	}

	private finishCompleted(): void {
		this.clearGate();
		this.setState("completed");
		this.persistSoon();
		this.child?.stdin.end(); // graceful shutdown: child exits after stdin closes
	}

	private writeUserMessage(text: string): void {
		const frame = { type: "user", message: { role: "user", content: [{ type: "text", text }] } };
		// Guard the sync throw on an already-ended stream; the async EPIPE is caught by
		// the stdin 'error' listener wired in spawnChild.
		if (this.child?.stdin.writable) this.child.stdin.write(`${JSON.stringify(frame)}\n`);
		this.record("claude", frame);
	}

	private clearGate(): void {
		if (!this.run.gate) return;
		this.run.gate = null;
		this.record("gate", null);
	}

	private clearInterruptTimer(): void {
		if (this.interruptTimer) {
			clearTimeout(this.interruptTimer);
			this.interruptTimer = null;
		}
	}

	// -------------------------------------------------------------------------
	// Playwright progress tail — the claude stream carries no partial Bash
	// output, so the progress-reporter's ndjson file is the live signal for
	// long test runs. New lines become "action" events for the web UI.
	// -------------------------------------------------------------------------

	private startProgressTail(): void {
		this.stopProgressTail();
		const file = path.join(this.runDir, "pw-progress.ndjson");
		// Old lines were already recorded to the WAL by a previous session.
		try {
			this.progressOffset = statSync(file).size;
		} catch {
			this.progressOffset = 0;
		}
		this.progressTimer = setInterval(() => {
			try {
				const size = statSync(file).size;
				if (size < this.progressOffset) this.progressOffset = 0; // file was reset
				if (size === this.progressOffset) return;
				const fd = openSync(file, "r");
				const buf = Buffer.alloc(size - this.progressOffset);
				const bytesRead = readSync(fd, buf, 0, buf.length, this.progressOffset);
				closeSync(fd);
				// Frame on BYTE boundaries: advance the offset by the exact bytes of the
				// complete lines. Decoding to a string first and re-encoding its length
				// drifts when a multibyte char is split across the read boundary (it
				// becomes a replacement char); working in bytes leaves the partial char
				// for the next tick. Also honors a short read via bytesRead.
				const chunk = buf.subarray(0, bytesRead);
				const lastNl = chunk.lastIndexOf(0x0a); // '\n'
				if (lastNl < 0) return; // only a partial line so far — next tick
				this.progressOffset += lastNl + 1;
				for (const raw of chunk.subarray(0, lastNl).toString("utf8").split("\n")) {
					const trimmed = raw.trim();
					if (!trimmed) continue;
					try {
						const parsed = JSON.parse(trimmed) as { line?: unknown; ts?: unknown };
						if (typeof parsed.line === "string") {
							this.record("action", { action: "playwright", line: parsed.line, ts: parsed.ts });
						}
					} catch {
						// malformed line — skip it
					}
				}
			} catch {
				// progress file not created yet
			}
		}, PROGRESS_POLL_MS);
	}

	private stopProgressTail(): void {
		if (this.progressTimer) {
			clearInterval(this.progressTimer);
			this.progressTimer = null;
		}
	}

	// -------------------------------------------------------------------------
	// State + persistence + WAL
	// -------------------------------------------------------------------------

	private setState(to: RunState): void {
		const from = this.run.state;
		if (from === to) return;
		try {
			assertTransition(from, to);
		} catch (err) {
			this.record("error", { message: (err as Error).message });
			return;
		}
		this.run.state = to;
		if (to === "completed" || to === "failed" || to === "aborted" || to === "interrupted") {
			this.run.endedAt = new Date().toISOString();
		}
		this.record("state", { state: to, previous: from, run: this.run });
		this.persistNow();
	}

	private persistSoon(): void {
		this.persistDirty = true;
		if (this.persistTimer) return;
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			if (this.persistDirty) this.persistNow();
		}, PERSIST_THROTTLE_MS);
	}

	/** Tracker snapshot (steps 1..12) with the provisioner-owned step 0 preserved. */
	private mergedSteps(): StepState[] {
		const zero = this.run.steps.find((s) => s.step === 0);
		const tracked = this.tracker.snapshot();
		return zero ? [zero, ...tracked] : tracked;
	}

	private persistNow(): void {
		this.persistDirty = false;
		this.run.steps = this.mergedSteps();
		void this.registry.save(this.run).catch((err: unknown) => {
			this.record("error", {
				message: `persist failed: ${err instanceof Error ? err.message : String(err)}`,
			});
		});
		this.emit("run", this.run);
	}

	private record(kind: RunEventKind, payload: unknown): void {
		const ev: RunEvent = { seq: ++this.seq, ts: new Date().toISOString(), kind, payload };
		this.ephemeralSeq = 0; // a persisted event closes the current fractional gap
		// After the run ends the WAL is closed; a late event (e.g. an async persist
		// rejection) is emitted live but must NOT reopen an orphaned WriteStream.
		if (!this.walClosed) this.walStream().write(`${JSON.stringify(ev)}\n`);
		this.emit("event", ev);
	}

	/**
	 * Emit a live-only event that is NOT written to the WAL. Token-stream deltas
	 * (`stream_event`) arrive by the hundreds per turn; persisting them bloats the
	 * WAL to hundreds of MB and blows up replay memory (readRunEvents slurps the
	 * whole file). The final `assistant` message carries the complete text, so a
	 * reconnecting client reconstructs it without the deltas. The fractional seq
	 * keeps each delta strictly between the last and next persisted (integer) seq,
	 * so replay/dedupe never gaps or duplicates across a reconnect or restart.
	 */
	private recordEphemeral(kind: RunEventKind, payload: unknown): void {
		const seq = this.seq + ++this.ephemeralSeq / 1e7;
		this.emit("event", { seq, ts: new Date().toISOString(), kind, payload });
	}

	private walStream(): WriteStream {
		if (!this.wal) {
			mkdirSync(path.join(this.runDir, "thumbs"), { recursive: true });
			this.wal = createWriteStream(path.join(this.runDir, WAL_FILE), { flags: "a" });
		}
		return this.wal;
	}

	/** seq must keep increasing across restarts/resumes — restore it from the WAL. */
	private restoreSeq(): number {
		let text: string;
		try {
			text = readFileSync(path.join(this.runDir, WAL_FILE), "utf8");
		} catch {
			return 0;
		}
		const lines = text.split("\n");
		for (let i = lines.length - 1; i >= 0; i--) {
			const trimmed = lines[i]?.trim();
			if (!trimmed) continue;
			try {
				const ev = JSON.parse(trimmed) as RunEvent;
				if (typeof ev.seq === "number") return ev.seq;
			} catch {
				// partial trailing line — keep scanning backwards
			}
		}
		return 0;
	}
}
