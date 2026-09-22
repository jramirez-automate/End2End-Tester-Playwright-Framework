import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { isWriteEnv, loadTestEnv, playwrightBaseURL } from "./utils/env";

// TEST_ENV=demo|local|dev|staging|prod selects .env.<TEST_ENV>.
// demo is the default and needs no credentials: it targets public sample apps.
// HEADED=true shows the browser. TICKET=ABC-123 runs only tests tagged @ABC-123.
// Read-only envs (prod, and staging in CI) run @smoke only.

const testEnv = loadTestEnv();
const baseURL = playwrightBaseURL();
const readOnly = !isWriteEnv(testEnv);

const ticket = process.env.TICKET;
const grepParts = [
	...(readOnly ? ["(?=.*@smoke)"] : []),
	...(ticket ? [`(?=.*@${ticket}\\b)`] : []),
];
const grep = grepParts.length ? new RegExp(grepParts.join("")) : undefined;

const isHeaded = process.env.HEADED === "true";
const authFile = ".auth/user.json";

// EVIDENCE=true keeps a screenshot, a video, and a trace for every test and
// writes evidence/<TICKET>/results-<env>.json for the publishing pipeline.
const wantEvidence = process.env.EVIDENCE === "true";
const evidenceRoot = ticket ? `evidence/${ticket}` : "evidence";

function hostMsPlaywrightCache(): string | undefined {
	const override = process.env.PLAYWRIGHT_HOST_BROWSERS_PATH;
	if (override && fs.existsSync(override)) return override;

	const cwd = process.cwd();
	const posix = cwd.match(/^\/home\/([^/]+)/);
	if (posix) {
		const dir = path.join("/home", posix[1], ".cache", "ms-playwright");
		if (fs.existsSync(dir)) return dir;
	}
	const win = cwd.match(/^([A-Za-z]:\\Users\\[^\\]+)/);
	if (win) {
		const dir = path.join(win[1], "AppData", "Local", "ms-playwright");
		if (fs.existsSync(dir)) return dir;
	}

	const fallback =
		process.platform === "win32"
			? path.join(
					process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
					"ms-playwright",
				)
			: process.platform === "darwin"
				? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
				: path.join(
						process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
						"ms-playwright",
					);
	return fs.existsSync(fallback) ? fallback : undefined;
}

// Some sandboxed agent shells redirect the browser cache to a throwaway path,
// which re-downloads Chromium on every run. Prefer the real host cache.
function preferHostPlaywrightBrowsers(): void {
	const current = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!current?.includes("sandbox-cache")) return;
	const host = hostMsPlaywrightCache();
	if (host) process.env.PLAYWRIGHT_BROWSERS_PATH = host;
}

preferHostPlaywrightBrowsers();

export default defineConfig({
	testDir: "./tests",
	timeout: 90_000,
	expect: { timeout: 10_000 },
	globalTimeout:
		process.env.PW_GLOBAL_TIMEOUT_MS !== undefined
			? Number(process.env.PW_GLOBAL_TIMEOUT_MS)
			: 30 * 60_000,
	fullyParallel: !isHeaded,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 1,
	workers: process.env.CI ? 1 : 2,
	outputDir: wantEvidence ? `${evidenceRoot}/artifacts` : "test-results",
	reporter: [
		[
			"html",
			{
				outputFolder: wantEvidence ? `${evidenceRoot}/report` : "playwright-report",
				open: "never",
			},
		],
		[
			"allure-playwright",
			{
				resultsDir: "allure-results",
				environmentInfo: {
					test_env: testEnv,
					base_url: baseURL,
					node: process.version,
				},
			},
		],
		["list"],
		...(wantEvidence
			? ([["./evidence-reporter.ts", { outputDir: evidenceRoot, env: testEnv }]] as [
					string,
					{ outputDir: string; env: string },
			  ][])
			: []),
	],
	use: {
		baseURL,
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		headless: !isHeaded,
		launchOptions: { slowMo: isHeaded ? 500 : 0 },
		trace: wantEvidence ? "on" : "on-first-retry",
		screenshot: wantEvidence ? "on" : "only-on-failure",
		video: {
			mode: wantEvidence || isHeaded ? "on" : "on-first-retry",
			size: { width: 1280, height: 720 },
		},
		...(isHeaded ? { actionTimeout: 30_000 } : {}),
	},
	projects: [
		{
			name: "setup",
			testMatch: /.*\.setup\.ts/,
			use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
		},
		{
			name: "chromium",
			dependencies: ["setup"],
			// The filter lives here, not at the top level, so a TICKET or
			// @smoke filter never excludes the sign-in step the tests depend on.
			grep,
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1920, height: 1080 },
				storageState: authFile,
			},
		},
	],
});
