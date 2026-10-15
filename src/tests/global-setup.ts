import { acquireEnvLock } from "../utils/env-lock";

/**
 * Runs once before all tests. Waits for the E2E Control Room dashboard's
 * environment lock; a no-op unless E2E_ENV_LOCK_URL is set (see src/utils/env-lock.ts).
 */
async function globalSetup() {
	await acquireEnvLock();
}

export default globalSetup;
