import { releaseEnvLock } from "../utils/env-lock";

/**
 * Runs once after all tests. Releases the E2E Control Room dashboard's
 * environment lock; a no-op unless E2E_ENV_LOCK_URL is set (see src/utils/env-lock.ts).
 */
async function globalTeardown() {
	await releaseEnvLock();
}

export default globalTeardown;
