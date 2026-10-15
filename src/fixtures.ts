/**
 * Specs import { test, expect } from this file, not from @playwright/test.
 * Add shared fixtures here when more than one spec needs them.
 */
import fs from "node:fs";
import path from "node:path";
import { test as base, type APIRequestContext, type CDPSession } from "@playwright/test";

import { apiContext } from "./utils/api";

type Fixtures = {
	/** API client for API_BASE_URL with this environment's auth (see src/utils/api.ts). */
	api: APIRequestContext;
	/** API client with no credentials, for 401 checks and public endpoints. */
	anonApi: APIRequestContext;
	/**
	 * Live browser feed for the E2E Control Room dashboard (`dashboard/`). A no-op
	 * unless THUMBS_DIR is set, which only the dashboard does. Errors are swallowed:
	 * a broken feed must never fail a test.
	 */
	liveThumbs: void;
};

export const test = base.extend<Fixtures>({
	api: async ({}, use) => {
		const context = await apiContext();
		await use(context);
		await context.dispose();
	},
	anonApi: async ({}, use) => {
		const context = await apiContext("none");
		await use(context);
		await context.dispose();
	},
	liveThumbs: [
		async ({ page }, use, testInfo) => {
			if (!process.env.THUMBS_DIR) {
				await use();
				return;
			}

			const dir = path.join(process.env.THUMBS_DIR, `w${testInfo.parallelIndex}`);
			let cdp: CDPSession | undefined;
			let metaTimer: NodeJS.Timeout | undefined;

			// Write tmp then rename: rename is atomic, so the dashboard never
			// reads a half-written file.
			const writeAtomic = (name: string, data: Buffer | string): void => {
				const tmp = path.join(dir, `${name}.tmp`);
				fs.writeFileSync(tmp, data);
				fs.renameSync(tmp, path.join(dir, name));
			};

			// A repaint can fire many frames a second, and synchronous writes in the
			// CDP handler block the runner's event loop. Keep only the newest frame
			// and write it asynchronously, so writes never queue up.
			let latestFrame: Buffer | undefined;
			let flushing = false;
			const flushLatestFrame = async (): Promise<void> => {
				if (flushing) return;
				flushing = true;
				try {
					while (latestFrame) {
						const data = latestFrame;
						latestFrame = undefined;
						const tmp = path.join(dir, "latest.jpeg.tmp");
						await fs.promises.writeFile(tmp, data);
						await fs.promises.rename(tmp, path.join(dir, "latest.jpeg"));
					}
				} catch {
					// Swallowed: a broken feed must not fail the test.
				} finally {
					flushing = false;
				}
			};

			try {
				fs.mkdirSync(dir, { recursive: true });
				const session = await page.context().newCDPSession(page);
				cdp = session;
				session.on("Page.screencastFrame", (frame) => {
					latestFrame = Buffer.from(frame.data, "base64");
					void flushLatestFrame();
					// Chrome stops sending frames until the previous one is acked.
					session
						.send("Page.screencastFrameAck", { sessionId: frame.sessionId })
						.catch(() => undefined);
				});
				await session.send("Page.startScreencast", {
					format: "jpeg",
					quality: 60,
					maxWidth: 1920,
					maxHeight: 1080,
				});
				// meta.json carries the caption and a freshness timestamp; refresh it
				// even when the page is idle and sends no frames.
				const writeMeta = (): void => {
					try {
						writeAtomic(
							"meta.json",
							JSON.stringify({ title: testInfo.title, ts: new Date().toISOString() }),
						);
					} catch {
						// Swallowed: see above.
					}
				};
				writeMeta();
				metaTimer = setInterval(writeMeta, 2000);
			} catch {
				// Swallowed: a broken feed must not fail the test.
			}

			await use();

			if (metaTimer) clearInterval(metaTimer);
			await cdp?.send("Page.stopScreencast").catch(() => undefined);
			await cdp?.detach().catch(() => undefined);
		},
		{ auto: true },
	],
});

export { expect } from "@playwright/test";
export type { Page, Locator, APIRequestContext, APIResponse } from "@playwright/test";
