/**
 * Copy to src/tests/<feature>/<name>.api.spec.ts, beside the feature's UI spec.
 * Write one test, run it alone, then the next.
 * Tag the describe with the ticket id: { tag: "@ABC-123" }; tag read-only
 * tests "@smoke" so they also run on production.
 *
 * Settings: API_BASE_URL (falls back to BASE_URL) and, for token auth,
 * API_TOKEN in .env.<env>. Without a token the `api` fixture uses the signed-in
 * browser session. Take paths, params and headers from DevTools → Network.
 */
import { z } from "zod";

import { expect, test, type APIRequestContext } from "../../fixtures";
import { CleanupRegistry, describeResponse, e2eName, parseWith, readBody } from "../../utils";

/** Only the fields the tests rely on; non-strict so new server fields don't fail. */
const Thing = z.object({
	id: z.union([z.number(), z.string()]),
	name: z.string(),
});

test.describe("<Feature> API", { tag: "@ABC-123" }, () => {
	const cleanup = new CleanupRegistry<APIRequestContext>();

	test.afterEach(async ({ api }) => {
		await cleanup.run(api);
	});

	test("<a record is created with the name it was sent>", async ({ api }) => {
		const name = await test.step("GIVEN a unique name", () => e2eName("<Kind>"));

		const res = await test.step(`WHEN we create "${name}"`, () =>
			api.post("<things>", { data: { name } }));

		await test.step("THEN the server answers 201 Created", async () => {
			expect(res.status(), await describeResponse(res)).toBe(201);
		});

		await test.step(`AND the record is named "${name}"`, async () => {
			const thing = parseWith(Thing, await readBody(res, test.info()));
			cleanup.add((client) => client.delete(`<things>/${thing.id}`));
			expect(thing.name).toBe(name);
		});
	});

	test(
		"<the endpoint refuses a caller with no credentials>",
		{ tag: "@smoke" },
		async ({ anonApi }) => {
			const res = await test.step("WHEN we list <things> without credentials", async () => {
				const res = await anonApi.get("<things>");
				await readBody(res, test.info());
				return res;
			});

			await test.step("THEN the server refuses with 401 Unauthorized", async () => {
				expect(res.status(), await describeResponse(res)).toBe(401);
			});
		},
	);
});
