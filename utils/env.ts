import dotenv from "dotenv";
import path from "path";

import type { E2ECredentials, E2EEnvironment } from "../types";

/**
 * Environments where create / edit / delete tests may run.
 * Anything else (including prod) is forced to @smoke by playwright.config.ts.
 */
export const WRITE_ENVS = ["local", "dev", "staging"];

export function currentTestEnv(): string {
	return process.env.TEST_ENV ?? "local";
}

/** Load .env.<TEST_ENV>. Variables already set (CI secrets) are left alone. */
export function loadTestEnv(): string {
	const testEnv = currentTestEnv();
	dotenv.config({ path: path.resolve(__dirname, `../.env.${testEnv}`) });
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

export function environment(): E2EEnvironment {
	return {
		baseURL: playwrightBaseURL(),
		siteName: (process.env.E2E_SITE_NAME ?? "").trim(),
	};
}

/**
 * Site / tenant / workspace for write tests. Comes only from E2E_SITE_NAME.
 * A missing value on a write env fails loudly instead of creating data in the
 * wrong place. Read-only runs do not need it.
 */
export function siteName(): string {
	const name = (process.env.E2E_SITE_NAME ?? "").trim();
	if (name) return name;
	if (isWriteEnv()) {
		throw new Error(
			`E2E_SITE_NAME is not set for write env "${currentTestEnv()}". ` +
				"Set it in .env.<TEST_ENV> before running create/edit/delete tests.",
		);
	}
	return "";
}
