import { describe, expect, it } from "vitest";
import type { AcquireLockRequest } from "../../shared/types.js";
import { LockService } from "./semaphores.js";

const req = (env: string, runId: string, pid: number): AcquireLockRequest => ({ env, runId, pid });

describe("LockService — idempotent acquire (lost-grant recovery)", () => {
	it("returns the SAME lease when the same client re-acquires (retry after a dropped response)", async () => {
		const locks = new LockService({ dev: 2 });
		const first = await locks.acquire(req("dev", "run-1", 100));
		const retry = await locks.acquire(req("dev", "run-1", 100));

		expect(first.granted).toBe(true);
		expect(retry.granted).toBe(true);
		expect(retry.leaseId).toBe(first.leaseId); // same lease, not an orphaned second one
		expect(locks.snapshot().held).toHaveLength(1); // no slot leaked
	});

	it("still grants distinct leases to distinct clients up to the cap", async () => {
		const locks = new LockService({ dev: 2 });
		const a = await locks.acquire(req("dev", "run-1", 100));
		const b = await locks.acquire(req("dev", "run-2", 200));
		expect(a.leaseId).not.toBe(b.leaseId);
		expect(locks.snapshot().held).toHaveLength(2);
	});
});

describe("LockService — waiting count + wake", () => {
	it("reports parked waiters and clears the count (with a change event) when a slot frees", async () => {
		const locks = new LockService({ dev: 1 });
		const changes: number[] = [];
		locks.on("change", () => changes.push(locks.snapshot().waiting));

		const held = await locks.acquire(req("dev", "run-1", 100));
		const parked = locks.acquire(req("dev", "run-2", 200)); // no slot — parks
		expect(locks.snapshot().waiting).toBe(1);

		locks.release(held.leaseId!);
		const grant = await parked;
		expect(grant.granted).toBe(true);
		expect(locks.snapshot().waiting).toBe(0);
		// The occupancy UI was told the waiting count changed (both park and wake).
		expect(changes).toContain(1);
		expect(changes).toContain(0);
	});
});
