/**
 * Optional cooperative lock so two runs do not mutate the same environment
 * at once. Both functions no-op unless E2E_ENV_LOCK_URL is set. If the lock
 * server is down, the run continues unlocked.
 */

export async function acquireEnvLock(): Promise<void> {
	const lockUrl = process.env.E2E_ENV_LOCK_URL;
	if (!lockUrl) return;

	const body = JSON.stringify({
		env: process.env.TEST_ENV ?? "local",
		pid: process.pid,
		runId: process.env.E2E_RUN_ID,
	});

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
			process.env.E2E_ENV_LOCK_LEASE = data.leaseId;
			return;
		}
	}
}

export async function releaseEnvLock(): Promise<void> {
	const lockUrl = process.env.E2E_ENV_LOCK_URL;
	const leaseId = process.env.E2E_ENV_LOCK_LEASE;
	if (!lockUrl || !leaseId) return;

	await fetch(`${lockUrl}/release`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ leaseId }),
		signal: AbortSignal.timeout(10_000),
	}).catch(() => undefined);
}
