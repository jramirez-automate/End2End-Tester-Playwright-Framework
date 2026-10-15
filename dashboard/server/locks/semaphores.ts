import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AcquireLockRequest, LockLease, LocksSnapshot } from "../../shared/types.js";
import { isAlive } from "../procs.js";

/**
 * Per-env counting semaphores behind POST /api/locks/acquire.
 *
 * The client half shipped first (src/utils/env-lock.ts in the e2e suite): it POSTs
 * /acquire under a 35s abort and loops while the response is {granted:false},
 * so this server must always answer well inside that window — waiters are
 * parked for LONG_POLL_MS and then told "not yet, poll again". A reaper frees
 * leases whose process died without releasing (kill -9, crashed worker).
 */
const LONG_POLL_MS = 25_000;
const REAPER_INTERVAL_MS = 10_000;
/** Never reap a lease younger than this — guards against PID reuse racing a fresh grant. */
const REAP_GRACE_MS = 15_000;

export interface AcquireResult {
	granted: boolean;
	leaseId?: string;
}

interface Waiter {
	req: AcquireLockRequest;
	settle: (result: AcquireResult) => void;
}

export class LockService extends EventEmitter {
	private readonly held = new Map<string, LockLease>();
	private waiters: Waiter[] = [];
	private readonly reaper: NodeJS.Timeout;

	constructor(private readonly caps: Record<string, number>) {
		super();
		// One "change" listener per open dashboard tab's global stream — lift the
		// default cap of 10 so a busy board doesn't log a false leak warning.
		this.setMaxListeners(0);
		this.reaper = setInterval(() => this.reap(), REAPER_INTERVAL_MS);
		this.reaper.unref();
	}

	/** Grant now if a slot is free, else park the caller for one long-poll round. */
	acquire(req: AcquireLockRequest): Promise<AcquireResult> {
		// Idempotent: a client that already holds a lease for this env/run/pid gets it
		// back. Without this, a grant whose HTTP response never reached the client
		// (dropped mid-flight) would be re-requested and orphan a second lease that
		// the reaper can't free while the worker PID is still alive — a slot leaks.
		const existing = this.findLease(req);
		if (existing) return Promise.resolve({ granted: true, leaseId: existing.leaseId });
		if (this.heldCount(req.env) < this.capOf(req.env)) {
			return Promise.resolve(this.grant(req));
		}
		return new Promise<AcquireResult>((resolve) => {
			const waiter: Waiter = {
				req,
				settle: (result) => {
					clearTimeout(timer);
					this.waiters = this.waiters.filter((w) => w !== waiter);
					this.emit("change"); // keep the occupancy UI's waiting count fresh (timeout/stop too)
					resolve(result);
				},
			};
			// "Not yet" — the client loops and re-POSTs, so no lease is lost.
			const timer = setTimeout(() => waiter.settle({ granted: false }), LONG_POLL_MS);
			timer.unref();
			this.waiters.push(waiter);
			this.emit("change");
		});
	}

	release(leaseId: string): void {
		const lease = this.held.get(leaseId);
		if (!lease) return; // expired/unknown — tolerated, the client fire-and-forgets
		this.held.delete(leaseId);
		this.wake(lease.env);
		this.emit("change");
	}

	snapshot(): LocksSnapshot {
		return {
			caps: { ...this.caps },
			held: [...this.held.values()],
			waiting: this.waiters.length,
		};
	}

	stop(): void {
		clearInterval(this.reaper);
		for (const waiter of [...this.waiters]) waiter.settle({ granted: false });
	}

	private capOf(env: string): number {
		return this.caps[env] ?? Number.POSITIVE_INFINITY; // unlisted envs are uncapped
	}

	private heldCount(env: string): number {
		let count = 0;
		for (const lease of this.held.values()) if (lease.env === env) count += 1;
		return count;
	}

	/** An existing lease for this exact client (env + run + pid), if any. */
	private findLease(req: AcquireLockRequest): LockLease | undefined {
		for (const lease of this.held.values()) {
			if (lease.env === req.env && lease.runId === req.runId && lease.pid === req.pid) return lease;
		}
		return undefined;
	}

	private grant(req: AcquireLockRequest): AcquireResult {
		const lease: LockLease = {
			leaseId: randomBytes(8).toString("hex"),
			env: req.env,
			pid: req.pid,
			runId: req.runId,
			grantedAt: new Date().toISOString(),
		};
		this.held.set(lease.leaseId, lease);
		this.emit("change");
		return { granted: true, leaseId: lease.leaseId };
	}

	/** A slot in `env` freed — hand it to the oldest waiter for that env, FIFO. */
	private wake(env: string): void {
		while (this.heldCount(env) < this.capOf(env)) {
			const waiter = this.waiters.find((w) => w.req.env === env);
			if (!waiter) return;
			waiter.settle(this.grant(waiter.req));
		}
	}

	/** Free leases whose process died without releasing. */
	private reap(): void {
		const now = Date.now();
		const dead = [...this.held.values()].filter(
			(lease) => now - Date.parse(lease.grantedAt) > REAP_GRACE_MS && !isAlive(lease.pid),
		);
		for (const lease of dead) {
			this.held.delete(lease.leaseId);
			this.wake(lease.env);
		}
		if (dead.length > 0) this.emit("change");
	}
}
