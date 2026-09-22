import { releaseEnvLock } from "../utils";

async function globalTeardown() {
	await releaseEnvLock();
}

export default globalTeardown;
