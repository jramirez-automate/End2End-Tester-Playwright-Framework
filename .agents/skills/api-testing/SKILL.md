---
name: api-testing
description: Playwright API testing practices — authenticated APIRequestContext, status/body/schema assertions, error and auth-negative cases, API data seeding, readable GIVEN/WHEN/THEN steps, and API-vs-UI decisions. Use when writing or reviewing `*.api.spec.ts` files, adding an API helper to `src/utils/`, seeding prerequisite data via the API, or deciding whether a check belongs in an API or UI test.
---

# API testing

How API tests are written in this suite. Where this page and `AGENTS.md`
disagree, `AGENTS.md` wins.

## Setup

- Import `test` / `expect` from `src/fixtures.ts`, never `@playwright/test`.
- Use the **`api`** fixture, never the built-in `request` fixture: `request`
  inherits `use.baseURL` (the UI origin) and carries no auth. `api` is built by
  `apiContext()` in `src/utils/api.ts` for `API_BASE_URL` (falls back to
  `BASE_URL`) and disposed after the test. Its auth is `API_TOKEN` when set
  (header and scheme from `API_AUTH_HEADER` / `API_AUTH_SCHEME`, default
  `Authorization: Bearer`), otherwise the signed-in browser session.
- Use **`anonApi`** for deliberately unauthenticated calls (the 401 test).
- Real values for `API_BASE_URL` / `API_TOKEN` live only in gitignored
  `.env.<env>` files; `.env.example` documents them.
- If `API_BASE_URL` has a path (`https://host/api/`), `apiBaseURL()` adds the
  trailing `/`; write request paths **without** a leading slash
  (`"orders/42"`) — a leading `/` resolves against the host root and drops the
  `/api/` prefix.
- Start from `templates/api.spec.template.ts`. The worked example is
  `src/tests/posts/posts.api.spec.ts`.
- Name specs `src/tests/<feature>/<name>.api.spec.ts` beside the UI spec of the
  same feature — by domain, never by ticket. Tag with the ticket like any spec.
- Cleanup: `new CleanupRegistry<APIRequestContext>()`, run with the `api`
  fixture in `afterEach`. Register the delete as soon as the record exists,
  before asserting on it.
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
   message: `expect(res.status(), await describeResponse(res)).toBe(200)`.
3. Then assert the body against expectations derived from the **inputs**
   (search term, sort order, the `e2eName()` you created) — never values read
   back from the same response.
4. Cover the negatives the endpoint owns: 401 without a token, empty / no
   match, invalid input (400 / 422), 403 where a lower-privilege user exists.
5. Read the body with `readBody(res, test.info())`. It attaches the request
   URL, status and body as `response.json` — the case's evidence, which the
   evidence reporter saves as `<test>-<env>-response.json` and publishing
   attaches — and tolerates `204 No Content` empty bodies.
6. Schema checks with `zod`: build the schema from fields the server actually
   returns, keep `z.object` non-strict so new fields don't fail, and assert with
   `parseWith(schema, body)`, which returns the typed body and names the exact
   field path on failure.

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
```typescript
test("an unknown order id returns 404", async ({ api }) => {
	const orderId = await test.step("GIVEN an order id that does not exist", () => e2eName("NoSuchOrder"));

	const res = await test.step(`WHEN we fetch order "${orderId}"`, async () => {
		const res = await api.get(`orders/${orderId}`);
		await readBody(res, test.info());
		return res;
	});

	await test.step("THEN the server answers 404 Not Found", async () => {
		expect(res.status(), await describeResponse(res)).toBe(404);
	});
});
```
