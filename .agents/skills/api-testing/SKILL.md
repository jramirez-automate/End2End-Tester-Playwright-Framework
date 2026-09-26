---
name: api-testing
description: Playwright API testing practices — authenticated APIRequestContext, status/body/schema assertions, error and auth-negative cases, API data seeding, readable GIVEN/WHEN/THEN steps, and API-vs-UI decisions. Use when writing or reviewing `*.api.spec.ts` files, adding an API helper to `utils/`, seeding prerequisite data via the API, or deciding whether a check belongs in an API or UI test.
---

# API testing

How API tests are written in this suite. Where this page and `AGENTS.md`
disagree, `AGENTS.md` wins.

## Setup

- Import `test` / `expect` from `fixtures.ts`, never `@playwright/test`.
- Do **not** rely on the built-in `request` fixture: it inherits
  `use.baseURL`, which is the app (UI) origin, and it carries no auth. Build a
  context from the API origin and token instead. The first spec that needs it
  adds `utils/api.ts` (and re-exports it from `utils/index.ts`):

  ```typescript
  import { request, type APIRequestContext } from "@playwright/test";

  export async function apiContext(): Promise<APIRequestContext> {
  	const token = (process.env.API_TOKEN ?? "").trim();
  	return request.newContext({
  		baseURL: process.env.API_BASE_URL ?? process.env.BASE_URL,
  		extraHTTPHeaders: {
  			Accept: "application/json",
  			...(token ? { Authorization: `Bearer ${token}` } : {}),
  		},
  	});
  }
  ```

  `dispose()` every context after the test — each one holds a socket pool.
  Add `API_BASE_URL` / `API_TOKEN` to `.env.example` with a comment; real
  values live only in gitignored `.env.<env>` files.
- If `API_BASE_URL` has a path (`https://host/api/`), end it with `/` and write
  request paths **without** a leading slash (`"orders/42"`) — a leading `/`
  resolves against the host root and drops the `/api/` prefix.
- Use `playwright.request.newContext({ baseURL })` with no token only for
  deliberately unauthenticated calls (the 401 test).
- Name specs `tests/<feature>/<name>.api.spec.ts` beside the UI spec of the
  same feature — by domain, never by ticket. Tag with the ticket like any spec.
- Data safety (`@smoke` vs write envs), `e2eName()`, `CleanupRegistry`,
  env-run approval and the one-slice-at-a-time TDD loop apply exactly as for
  UI specs.

## API vs UI

- Prerequisite data that merely has to **exist** → create it via the API,
  register its delete with `CleanupRegistry`.
- The behaviour the ticket is about, as the user sees it → UI test.
- Contract facts the UI can't show (status codes, field types, auth refusals,
  empty-result semantics) → API test.

## Writing a test

1. Copy the exact request from the browser (DevTools → Network → Fetch/XHR):
   path, query params, method and headers.
2. Assert the status first, with the URL and the start of the body as the
   message: `expect(res.status(), debugInfo).toBe(200)` where `debugInfo` is
   `res.url()` plus the first ~500 chars of `await res.text()`.
3. Then assert the body against expectations derived from the **inputs**
   (search term, sort order, the `e2eName()` you created) — never values read
   back from the same response.
4. Cover the negatives the endpoint owns: 401 without a token, empty / no
   match, invalid input (400 / 422), 403 where a lower-privilege user exists.
5. Attach the raw body (`test.info().attach("response.json", …)`) so the
   report shows what the server returned. Read with `res.text()` then
   `JSON.parse` — it tolerates `204 No Content` empty bodies.
6. Schema checks (optional, needs `zod`): build the schema from fields the
   server actually returns, keep `z.object` non-strict so new fields don't
   fail, derive the TS type with `z.infer`, and assert via `safeParse` +
   `z.prettifyError` so the failure names the exact field path.

## Readable steps (for manual QA)

API tests have no screenshot or video, so the report's step list is what a
manual QA engineer reads. Write every test as `test.step()` blocks, not comments:

- One step per action or check, titled `GIVEN …` / `WHEN …` / `THEN …` / `AND …`
  in plain English — the same wording as the manual test case when one exists.
- Put real values in titles: `WHEN we search orders for "E2E-Order-…"`,
  `THEN the server refuses with 401 Unauthorized` — never "call endpoint" or
  "check status".
- Pass data between steps by returning it — no `let` declared outside the steps.
- Send the request inside the WHEN step so the attached `response.json` shows
  under that step in the report.
- Keep the `expect` inside the THEN / AND step it proves.
- `try` / `finally` (e.g. `dispose()`) stays outside the steps.

```typescript
test("an unknown order id returns 404", async () => {
	const api = await apiContext();
	try {
		const orderId = await test.step("GIVEN an order id that does not exist", () => e2eName("NoSuchOrder"));

		const res = await test.step(`WHEN we fetch order "${orderId}"`, async () => {
			const res = await api.get(`orders/${orderId}`);
			await test.info().attach("response.json", { body: await res.text(), contentType: "application/json" });
			return res;
		});

		await test.step("THEN the server answers 404 Not Found", () => {
			expect(res.status(), res.url()).toBe(404);
		});
	} finally {
		await api.dispose();
	}
});
```
