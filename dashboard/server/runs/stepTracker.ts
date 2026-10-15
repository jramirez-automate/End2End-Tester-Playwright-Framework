import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { PIPELINE_STEPS, type TelemetryLine } from "../../shared/pipeline.js";
import type { StepSource, StepState, StepStatus } from "../../shared/types.js";
import { evidenceRoot } from "../config.js";

/** Steps that may legitimately be jumped past (become "skipped" on inference). */
const OPTIONAL_STEPS = new Set([5, 7, 8, 9, 10]);
const FIRST_STEP = 1;
const LAST_STEP = PIPELINE_STEPS[PIPELINE_STEPS.length - 1]!.step;

const TELEMETRY_STATUS: Record<string, StepStatus> = {
	started: "active",
	done: "done",
	skipped: "skipped",
	blocked: "blocked",
};

/**
 * Tracks StepState[1..7] for one run. Telemetry
 * (src/evidence/<TICKET>/pipeline-status.ndjson) is authoritative; tool-event
 * inference is monotonic and never overrides telemetry-sourced statuses.
 *
 * Emits: "step" (StepState), "telemetry" (file appeared), "complete".
 */
export class StepTracker extends EventEmitter {
	private readonly steps = new Map<number, StepState>();
	private readonly telemetryPath: string;
	private readonly ticketDir: string;
	private readonly evidenceRoot: string;

	private watcher: FSWatcher | null = null;
	private pollTimer: NodeJS.Timeout | null = null;
	private offset = 0;
	private partial = "";
	private reading = false;
	private pendingRead = false;
	private telemetrySeen = false;
	private complete = false;

	constructor(e2eRoot: string, ticket: string, initial?: StepState[]) {
		super();
		this.evidenceRoot = evidenceRoot(e2eRoot);
		this.ticketDir = path.join(this.evidenceRoot, ticket);
		this.telemetryPath = path.join(this.ticketDir, "pipeline-status.ndjson");
		for (let step = FIRST_STEP; step <= LAST_STEP; step++) {
			const seed = initial?.find((s) => s.step === step);
			this.steps.set(step, seed ? { ...seed } : { step, status: "pending" });
		}
	}

	start(): void {
		if (this.pollTimer) return;
		this.tryAttach();
		// Watcher events are the fast path, but burst appends coalesce on macOS
		// fsevents and the tail of a burst can go undelivered — this rescan
		// guarantees convergence (stat is cheap; reads no-op at offset == size).
		this.pollTimer = setInterval(() => {
			if (!this.watcher) this.tryAttach();
			if (existsSync(this.telemetryPath)) {
				if (!this.telemetrySeen) {
					this.telemetrySeen = true;
					this.emit("telemetry");
				}
				void this.consumeTelemetry();
			}
		}, 1000);
	}

	stop(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.watcher) {
			void this.watcher.close();
			this.watcher = null;
		}
	}

	snapshot(): StepState[] {
		const out: StepState[] = [];
		for (let step = FIRST_STEP; step <= LAST_STEP; step++) {
			const st = this.steps.get(step);
			if (st) out.push({ ...st });
		}
		return out;
	}

	/** Best-known current step: highest active, else highest non-pending, else 1. */
	currentStep(): number {
		let highestKnown = FIRST_STEP;
		for (let step = LAST_STEP; step >= FIRST_STEP; step--) {
			const st = this.steps.get(step);
			if (!st || st.status === "pending") continue;
			if (st.status === "active") return step;
			if (highestKnown === FIRST_STEP) highestKnown = step;
		}
		return highestKnown;
	}

	isComplete(): boolean {
		return this.complete || this.steps.get(LAST_STEP)?.status === "done";
	}

	hasTelemetry(): boolean {
		return this.telemetrySeen;
	}

	/**
	 * Tool-event inference. Monotonic: ignores steps at/below the max known
	 * non-pending step. When jumping forward, lower active steps become done and
	 * lower pending steps become skipped (optional) or done (mandatory).
	 */
	markInferred(step: number): void {
		if (this.complete || step < FIRST_STEP || step > LAST_STEP) return;
		let maxKnown = 0;
		for (const st of this.steps.values()) {
			if (st.status !== "pending" && st.step > maxKnown) maxKnown = st.step;
		}
		if (step <= maxKnown) return;
		for (let lower = FIRST_STEP; lower < step; lower++) {
			const st = this.steps.get(lower);
			if (!st || st.source === "telemetry") continue;
			if (st.status === "active") this.setStatus(lower, "done", "inference");
			else if (st.status === "pending") {
				this.setStatus(lower, OPTIONAL_STEPS.has(lower) ? "skipped" : "done", "inference");
			}
		}
		const target = this.steps.get(step);
		if (target && target.source !== "telemetry" && target.status !== "active") {
			this.setStatus(step, "active", "inference");
		}
	}

	private tryAttach(): boolean {
		if (this.watcher) return true;
		// evidence/ is gitignored and may not exist until the pipeline creates it.
		if (!existsSync(this.evidenceRoot)) return false;
		// Watch the evidence root so the ticket dir + file are caught on creation;
		// the ignore filter keeps the watcher off every other ticket's artifacts.
		this.watcher = watch(this.evidenceRoot, {
			depth: 2,
			ignoreInitial: false,
			ignored: (p: string) => {
				const resolved = path.resolve(p);
				return (
					resolved !== this.evidenceRoot &&
					resolved !== this.ticketDir &&
					resolved !== this.telemetryPath
				);
			},
		});
		const onFile = (p: string): void => {
			if (path.resolve(p) === this.telemetryPath) {
				if (!this.telemetrySeen) {
					this.telemetrySeen = true;
					this.emit("telemetry");
				}
				void this.consumeTelemetry();
			}
		};
		this.watcher.on("add", onFile);
		this.watcher.on("change", onFile);
		return true;
	}

	private async consumeTelemetry(): Promise<void> {
		if (this.reading) {
			this.pendingRead = true;
			return;
		}
		this.reading = true;
		try {
			const st = await stat(this.telemetryPath);
			if (st.size < this.offset) {
				// file was truncated/rewritten — start over
				this.offset = 0;
				this.partial = "";
			}
			if (st.size > this.offset) {
				const fh = await open(this.telemetryPath, "r");
				try {
					const length = st.size - this.offset;
					const buf = Buffer.alloc(length);
					// Honor bytesRead: a short read must not advance the offset past the
					// unread bytes (that would silently drop a telemetry line) nor decode
					// the buffer's uninitialized tail. The remainder is read next tick.
					const { bytesRead } = await fh.read(buf, 0, length, this.offset);
					this.offset += bytesRead;
					const chunks = (this.partial + buf.toString("utf8", 0, bytesRead)).split("\n");
					this.partial = chunks.pop() ?? "";
					for (const line of chunks) {
						const trimmed = line.trim();
						if (!trimmed) continue;
						try {
							this.applyTelemetry(JSON.parse(trimmed) as TelemetryLine);
						} catch {
							// tolerate malformed telemetry lines
						}
					}
				} finally {
					await fh.close();
				}
			}
		} catch {
			// stat/read race — retried on the next change event
		} finally {
			this.reading = false;
			if (this.pendingRead) {
				this.pendingRead = false;
				void this.consumeTelemetry();
			}
		}
	}

	private applyTelemetry(line: TelemetryLine): void {
		if (line.pipeline === "complete") {
			this.markComplete();
			return;
		}
		if (typeof line.step !== "number" || !line.status) return;
		const status = TELEMETRY_STATUS[line.status];
		if (!status || line.step < FIRST_STEP || line.step > LAST_STEP) return;
		// Defensive monotonicity: a stale/out-of-order "started" must not re-activate a
		// step below one telemetry has already advanced past — two simultaneously
		// "active" steps confuse currentStep() and the rail.
		if (status === "active") {
			for (const st of this.steps.values()) {
				if (
					st.step > line.step &&
					st.source === "telemetry" &&
					(st.status === "active" || st.status === "done")
				) {
					return;
				}
			}
		}
		this.setStatus(line.step, status, "telemetry", line.ts);
		if (line.step === LAST_STEP && status === "done") this.markComplete();
	}

	private setStatus(step: number, status: StepStatus, source: StepSource, ts?: string): void {
		const st = this.steps.get(step);
		if (!st || (st.status === status && st.source === source)) return;
		const when = ts ?? new Date().toISOString();
		st.status = status;
		st.source = source;
		if (status === "active") {
			st.startedAt = st.startedAt ?? when;
			delete st.endedAt;
		} else {
			st.endedAt = when;
		}
		this.emit("step", { ...st });
	}

	private markComplete(): void {
		if (this.complete) return;
		this.complete = true;
		this.emit("complete");
	}
}
