# End2End Tester Playwright Framework

Playwright starter for a web app. Use this repository as a GitHub template, then point it at your product.

What you get:

- One login per run, reused as saved browser state
- `local`, `dev`, and `staging` can create data; `prod` runs smoke tests only
- Page objects, unique test names, and cleanup after each test
- Screenshots and video per environment when you turn evidence on

## Setup

```bash
nvm use
npm ci
npx playwright install --with-deps chromium
cp .env.example .env.local
```

Fill `BASE_URL`, `E2E_USERNAME`, and `E2E_PASSWORD` in `.env.local`. Those files stay untracked.

## Run

```bash
npm run test:local
npm run test:dev
npm run test:staging
npm run test:prod
TICKET=ABC-123 npm run test:dev
EVIDENCE=true npm run test:dev
HEADED=true npm run test:dev
npm run test:ui
npm run typecheck
```

`tests/example/` is skipped until you adapt it and set `E2E_INCLUDE_EXAMPLES=1`.

Open an authenticated codegen window after a login has written `.auth/user.json`:

```bash
npx playwright codegen --load-storage=.auth/user.json "$BASE_URL"
```

## Point it at your app

1. Set `BASE_URL` and a dedicated test account in `.env.<environment>`.
2. Match `pages/LoginPage.ts` to your sign-in form (roles and labels first).
3. Set `E2E_HOME_PATH` and `E2E_HOME_HEADING` so the smoke test proves the shell loaded.
4. If write tests must pick a tenant or site, set `E2E_SITE_NAME` and implement `HomePage.ensureSiteSelected`.
5. Copy `templates/page-object.template.ts` and `templates/spec.template.ts` for each new behaviour.

## Data safety

- Name created records with `e2eName()` so leftovers are obvious (`E2E-Item-...`).
- Delete them in `test.afterEach` through `CleanupRegistry` (last in, first out).
- `prod` runs tests tagged `@smoke` only. Do not create or delete data there.
- Staging in CI is also read-only unless `E2E_STAGING_WRITES=true`.

## Evidence

`EVIDENCE=true` writes `evidence/<ticket>/` with a screenshot, video, and trace per test. The environment name is part of the filename, so a dev run and a staging run can sit side by side. Failed tests are suffixed `-FAILED`.

Frame the thing under test before the screenshot. Scroll it into view, leave the dialog or toast open, or attach a shot mid-test:

```ts
await test.info().attach("screenshot", {
  body: await locator.screenshot(),
  contentType: "image/png",
});
```

## Layout

| Path | Role |
| --- | --- |
| `tests/<feature>/` | Specs, grouped by feature. Ticket id is a tag, not a folder. |
| `pages/` | Page objects. Selectors live here. |
| `utils/` | Env loading, test names, cleanup, small UI helpers. |
| `fixtures.ts` | Import `test` and `expect` from here. |
| `docs/APP-MAP.md` | How to reach each page, and helpers you already have. |
| `templates/` | Copy-paste starting points. Not compiled. |

## CI

Pushes and pull requests typecheck only. Run the suite from the Actions tab (`workflow_dispatch`) after you add `BASE_URL`, `E2E_USERNAME`, and `E2E_PASSWORD` as repository secrets. `prod` stays on `@smoke`.
