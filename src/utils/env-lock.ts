import { currentTestEnv } from "./env";

/**
 * Cooperative environment lock for the E2E Control Room dashboard. Two runs
 * against the same TEST_ENV mutate the same records, so the dashboard's
 * lock server serializes them. Both functions are no-ops unless
 * E2E_ENV_LOCK_URL is set — manual and CI runs behave exactly as before — and
 * if the server is unreachable we warn once and run unlocked (a down
 * dashboard must never block a run).
 */

export async function acquireEnvLock(): Promise<void> {
	const lockUrl = process.env.E2E_ENV_LOCK_URL;
	if (!lockUrl) return;

	const body = JSON.stringify({
		env: currentTestEnv(),
		pid: process.pid,
		runId: process.env.DASHBOARD_RUN_ID,
	});

	// The server long-polls ~30s per request and answers {granted:true, leaseId}
	// or {granted:false} meaning "still held — poll again".
	for (;;) {
		let res: Response;
		try {
			res = await fetch(`${lockUrl}/acquire`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
				signal: AbortSignal.timeout(35_000),
			});
		} catch {
			console.warn("[env-lock] lock server unreachable — proceeding without a lock");
			return;
		}
		const data = (await res.json().catch(() => ({}))) as {
			granted?: boolean;
			leaseId?: string;
		};
		if (data.granted && data.leaseId) {
			// globalSetup and globalTeardown are separate modules in the same
			// process — an env var is the reliable carrier for the lease id.
			process.env.E2E_ENV_LOCK_LEASE = data.leaseId;
			return;
		}
	}
}

export async function releaseEnvLock(): Promise<void> {
	const lockUrl = process.env.E2E_ENV_LOCK_URL;
	const leaseId = process.env.E2E_ENV_LOCK_LEASE;
	if (!lockUrl || !leaseId) return;

	// Best-effort: the server expires stale leases anyway, so a failed release
	// is fine — never let it fail teardown.
	await fetch(`${lockUrl}/release`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ leaseId }),
		signal: AbortSignal.timeout(10_000),
	}).catch(() => undefined);
}
