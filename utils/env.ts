import dotenv from "dotenv";
import path from "path";

import type { E2ECredentials, E2EEnvironment } from "../types";

/**
 * Environments where create / edit / delete tests may run.
 * Anything else (including prod) is forced to @smoke by playwright.config.ts.
 */
export const WRITE_ENVS = ["demo", "local", "dev", "staging"];

/**
 * Public demo targets, so a fresh clone runs green with no credentials
 * and no .env file. Replace with your own app by setting TEST_ENV.
 */
export const DEMO_DEFAULTS: Record<string, string> = {
	BASE_URL: "https://www.saucedemo.com",
	E2E_USERNAME: "standard_user",
	E2E_PASSWORD: "secret_sauce",
	TODO_APP_URL: "https://demo.playwright.dev/todomvc",
};

export function currentTestEnv(): string {
	return process.env.TEST_ENV ?? "demo";
}

export function isDemoEnv(testEnv = currentTestEnv()): boolean {
	return testEnv === "demo";
}

/**
 * Load .env.<TEST_ENV>. Variables already set (CI secrets) are left alone.
 * The demo env falls back to the public defaults above.
 */
export function loadTestEnv(): string {
	const testEnv = currentTestEnv();
	dotenv.config({ path: path.resolve(__dirname, `../.env.${testEnv}`), quiet: true });
	if (isDemoEnv(testEnv)) {
		for (const [key, value] of Object.entries(DEMO_DEFAULTS)) {
			process.env[key] ??= value;
		}
	}
	return testEnv;
}

/** Origin only. A BASE_URL with a path or query is reduced to scheme + host. */
export function playwrightBaseURL(): string {
	const raw = (process.env.BASE_URL ?? "http://localhost:3000").trim();
	try {
		const withScheme = raw.includes("://") ? raw : `https://${raw}`;
		return new URL(withScheme).origin;
	} catch {
		return raw;
	}
}

export function isWriteEnv(testEnv = currentTestEnv()): boolean {
	if (/^prod/.test(testEnv) && process.env.E2E_PROD_WRITES === "true") {
		return true;
	}
	if (!WRITE_ENVS.includes(testEnv)) return false;
	// Staging stays read-only in CI until writes are turned on deliberately.
	if (
		testEnv === "staging" &&
		process.env.CI &&
		process.env.E2E_STAGING_WRITES !== "true"
	) {
		return false;
	}
	return true;
}

export function credentials(): E2ECredentials {
	return {
		username: process.env.E2E_USERNAME ?? "",
		password: process.env.E2E_PASSWORD ?? "",
	};
}

/** True once a username and password are available for the current env. */
export function credentialsConfigured(): boolean {
	const { username, password } = credentials();
	return Boolean(username && password);
}

export function environment(): E2EEnvironment {
	return {
		baseURL: playwrightBaseURL(),
		siteName: (process.env.E2E_SITE_NAME ?? "").trim(),
	};
}

/**
 * Site / tenant / workspace for write tests. Comes only from E2E_SITE_NAME.
 * Empty unless your app needs one, so the demo suite ignores it.
 */
export function siteName(): string {
	return (process.env.E2E_SITE_NAME ?? "").trim();
}

/** Second demo target: the Playwright TodoMVC sample, which needs no login. */
export function todoAppURL(): string {
	return (process.env.TODO_APP_URL ?? DEMO_DEFAULTS.TODO_APP_URL).trim();
}
