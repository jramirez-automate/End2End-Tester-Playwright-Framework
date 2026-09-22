import fs from "fs";
import path from "path";

import { test as setup, expect } from "../fixtures";
import { LoginPage } from "../pages";
import { credentials, credentialsConfigured, currentTestEnv } from "../utils";

const authFile = path.join(__dirname, "../.auth/user.json");
const emptyState = { cookies: [], origins: [] };

/**
 * Signs in once. Every project that depends on "setup" starts from the saved
 * session, so no spec pays for the login. Adapt LoginPage for your own app.
 */
setup("sign in and save the session", async ({ page, context }) => {
	fs.mkdirSync(path.dirname(authFile), { recursive: true });

	if (!credentialsConfigured()) {
		// No credentials for this environment: run public pages only rather than fail.
		fs.writeFileSync(authFile, JSON.stringify(emptyState));
		setup.info().annotations.push({
			type: "notice",
			description: `No E2E_USERNAME / E2E_PASSWORD for ${currentTestEnv()} — saved an empty session.`,
		});
		return;
	}

	if (
		process.env.E2E_REUSE_AUTH === "1" &&
		fs.existsSync(authFile) &&
		fs.statSync(authFile).size > 0
	) {
		return;
	}

	const { username, password } = credentials();
	const login = new LoginPage(page);
	await login.signIn(username, password);
	await expect(login.usernameInput).toBeHidden();

	await context.storageState({ path: authFile });
});
