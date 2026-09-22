# Agent guide

This is the End2End Tester Playwright Framework. Specs hit a deployed app over HTTP. There is no app source in this repo.

## Conventions

- Import `test` and `expect` from `fixtures.ts`.
- Specs live in `tests/<feature>/`. Trace a ticket with a tag: `{ tag: "@ABC-123" }`.
- Selectors live in page objects. Prefer `getByRole` and `getByLabel`. Scope a dialog with `getByRole("dialog")`.
- Write flows run on `local`, `dev`, and `staging` only. `prod` is `@smoke`.
- Name created data with `e2eName()` and delete it in `test.afterEach` via `CleanupRegistry`.
- Read the site name from `siteName()`. Do not hardcode a tenant.
- Author one test at a time. Run that test alone. The failure that counts is the assertion of user-visible behaviour.
- Check `docs/APP-MAP.md` before adding a new route or a new widget helper. Record what you learn there.
- Credentials belong in gitignored `.env.<TEST_ENV>` files only.

## Commands

```bash
TEST_ENV=dev npx playwright test tests/<feature>/<file>.spec.ts -g "<title>"
TICKET=ABC-123 TEST_ENV=dev npx playwright test
EVIDENCE=true TEST_ENV=dev npx playwright test
npm run typecheck
```

Do not start a run against `prod` until the person who owns the suite has agreed in the conversation.
