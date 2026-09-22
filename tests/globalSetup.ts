import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

import { LoginPage } from "../pages";
import { acquireEnvLock, credentials, environment, loadTestEnv } from "../utils";

/**
 * Logs in once and saves storage state to .auth/user.json.
 * Specs reuse that session. Set E2E_REUSE_AUTH=1 to skip login on later runs.
 */
async function globalSetup() {
	const testEnv = loadTestEnv();
	await acquireEnvLock();

	const { baseURL } = environment();
	const { username, password } = credentials();
	const authDir = path.join(__dirname, "../.auth");
	fs.mkdirSync(authDir, { recursive: true });
	const authFile = path.join(authDir, "user.json");

	if (
		process.env.E2E_REUSE_AUTH === "1" &&
		fs.existsSync(authFile) &&
		fs.statSync(authFile).size > 0
	) {
		console.log(`[globalSetup] reusing ${authFile}`);
		return;
	}

	if (process.env.E2E_SKIP_AUTH === "1") {
		fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }));
		console.log("[globalSetup] E2E_SKIP_AUTH=1 — empty session");
		return;
	}

	if (!username || !password) {
		throw new Error(
			`Set E2E_USERNAME and E2E_PASSWORD in .env.${testEnv} (see .env.example).`,
		);
	}

	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({ baseURL });
		const page = await context.newPage();
		await new LoginPage(page).login(username, password);
		await context.storageState({ path: authFile });
		console.log(`[globalSetup] session saved to ${authFile}`);
	} finally {
		await browser.close();
	}
}

export default globalSetup;
