/**
 * Specs import { test, expect } from this file, not from @playwright/test.
 * Add shared fixtures here when more than one spec needs them.
 */
import { test as base, type APIRequestContext } from "@playwright/test";

import { apiContext } from "./utils/api";

type Fixtures = {
	/** API client for API_BASE_URL with this environment's auth (see src/utils/api.ts). */
	api: APIRequestContext;
	/** API client with no credentials, for 401 checks and public endpoints. */
	anonApi: APIRequestContext;
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
});

export { expect } from "@playwright/test";
export type { Page, Locator, APIRequestContext, APIResponse } from "@playwright/test";
