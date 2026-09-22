# End2End Tester Playwright Framework

A Playwright end-to-end suite you can point at any web app, together with the
ticket workflow that authors specs, evidences them, and publishes the result to
your tracker, wiki, test management tool, and chat.

Clone it and run `npm test`. The default environment targets public sample apps,
so the suite is green before you configure anything.

```bash
nvm use && npm ci && npx playwright install --with-deps chromium
npm test
```

## What is in the box

| Piece | What it gives you |
| --- | --- |
| Multi-environment config | `TEST_ENV` picks the target; write flows are blocked on production by a guard, not by discipline |
| Saved sign-in | One login per run as a setup project, reused by every spec |
| Page objects | `BasePage` plus working examples; selectors never leak into specs |
| Data discipline | `e2eName()` for unique records, `CleanupRegistry` for last-in-first-out teardown |
| Evidence bundles | A screenshot, video, and trace per test, plus a machine-written results file |
| Publishing pipeline | Attach media, post an inline-media results table, publish a test plan, create test cycles, notify chat |
| Allure reporting | Trend-friendly results alongside the built-in HTML report |
| Agent tooling | `.claude/` and `.cursor/` trees with the same four agents, the ticket command, and shared skills |
| CI | Typecheck, tree-sync, and the demo suite on every push, with no secrets |

## Run

```bash
npm test                              # demo suite (public sample apps)
npm run test:dev                      # your dev environment
npm run test:staging
npm run test:prod                     # @smoke only
npm run test:headed                   # watch it
npm run test:ui                        # Playwright UI mode
TICKET=ABC-123 npm run test:dev        # only tests tagged @ABC-123
TICKET=ABC-123 npm run test:evidence   # evidence bundle → evidence/ABC-123/
npm run allure                         # generate and open the Allure report
npm run typecheck && npm run check:tool-sync
```

Use `--` before Playwright options so npm passes them through:

```bash
npm run test:dev -- tests/checkout/cart-checkout.spec.ts -g "confirmation"
```

## Point it at your app

1. `cp .env.example .env.dev`, then set `BASE_URL` and a dedicated test account.
2. Adapt `pages/LoginPage.ts` to your sign-in form. It already handles a single
   form and the email-then-password pattern, and it is the only file most apps
   need to change.
3. Replace the demo specs and page objects under `tests/` and `pages/demo/` with
   your own features. Scaffolds live in `templates/`.
4. If write tests must pick a tenant or site, set `E2E_SITE_NAME` and read it
   through `siteName()`.

### Environments

`TEST_ENV` selects `.env.<TEST_ENV>`. **Data safety is enforced in
`playwright.config.ts`:** only write environments (`WRITE_ENVS` in
`utils/env.ts`) run state-changing flows. Everything else is filtered to
`@smoke`, so a write test cannot touch production even when pointed there.

| TEST_ENV | Target | Tests that run |
| --- | --- | --- |
| `demo` | public sample apps, no credentials | all (write + smoke) |
| `local` | your dev server | all (write + smoke) |
| `dev` | your deployed dev host | all (write + smoke) |
| `staging` | your deployed staging host | all (write + smoke)¹ |
| `prod` | your production host | `@smoke` only |

¹ Staging stays read-only in CI unless `E2E_STAGING_WRITES=true` is set
deliberately.

Ask before running against a shared or production environment. That is a rule the
agents follow too (`.cursor/rules/env-run-approval.mdc`).

## Data safety

- `@smoke` marks read-only tests. Safe anywhere, including production.
- Write tests carry only their ticket tag, so the guard keeps them off production.
- Every record a test creates is named with `e2eName()` (`E2E-Item-…`, so strays
  from a crashed run are obvious) and deleted in `afterEach` through
  `CleanupRegistry`, which unwinds last in, first out.
- Watch for paginated, sorted lists: search for the name before asserting a row.

## Evidence

```bash
TICKET=ABC-123 npm run test:evidence
```

`EVIDENCE=true` keeps a screenshot, video, and trace for **every** test, pass or
fail, and routes them into `evidence/ABC-123/` with the environment in each
filename, so two environments coexist:

```
evidence/ABC-123/
  a-cart-can-be-checked-out-to-a-confirmation-dev.png / .webm / -trace.zip
  adding-products-updates-the-cart-badge-dev-FAILED.png     (failures keep their proof)
  results-dev.json        # machine-written: status, tags, media, error per test
  SUMMARY.md              # generated table, one column per environment
  report/                 # npx playwright show-report evidence/ABC-123/report
```

`results-<env>.json` is what makes publishing hands-off: the results table is
generated from the run, never typed out. Everything under `evidence/` is
gitignored.

### The subject must be visible

A green test whose screenshot shows a blank page, a spinner, or a closed dialog
is not proof. Playwright's end-of-test shot is the final viewport, so frame the
subject: scroll it into view, keep the proving dialog or toast open, and attach a
focused shot when the end state would hide it.

```ts
await test.info().attach("screenshot", {
  body: await locator.screenshot(),
  contentType: "image/png",
});
```

Mid-test attachments are used as the primary image for exactly this reason.

## Publishing

One command turns a verified bundle into published results. Every provider is
configured, never hardcoded, and anything set to `none` is skipped.

```bash
cp .env.publish.example .env.publish        # then fill in what you use
node scripts/publish.mjs all --ticket ABC-123 --dry-run
node scripts/publish.mjs all --ticket ABC-123 --summary "Checkout regression"
```

| Command | What it does |
| --- | --- |
| `summary` | Write `SUMMARY.md` from the run results |
| `attach` | Upload the media the results table references, skipping duplicates |
| `comment` | Post the results table with media **embedded inline**, not linked |
| `plan` | Create or update the test plan page on the wiki |
| `cycles` | Create test cases, a cycle per environment, and an execution per case |
| `notify` | Post a chat card, gated to `NOTIFY_ON_ENVS` and a green run |
| `cleanup` | Delete attachments no comment references, keeping anything it did not upload |
| `all` | The whole sequence |

Providers: tracker `jira` or `github`, wiki `confluence`, test management
`zephyr`, chat `teams` or `slack`. Swapping one means writing one adapter in
`scripts/lib/providers/`; the CLI and the evidence format do not change.

Two details worth knowing:

- **Inline media needs ADF.** A markdown comment can only link to an attachment.
  The Jira adapter resolves each attachment to its media services id and builds
  real media nodes, so screenshots and playable video render in the table.
- **Cleanup is guarded.** A file is only a delete candidate when this pipeline
  uploaded it, it looks like a capture artifact, and no comment references it.
  Anything else is kept and reported, so nobody's source material disappears.

Without credentials every command runs as a dry run, which is also how you demo
the pipeline safely.

## Agent tooling

The same workflow ships for two AI tools, and a checker keeps them honest.

- `.agents/skills/` — shared skills (`e2e-testing-patterns`, `tdd`), symlinked
  into `.claude/skills/` and `.cursor/skills/`
- Four agents in both trees: **explorer** (maps routes and selectors, read-only),
  **runner** (runs and triages until green), **evidence** (captures and verifies),
  **publisher** (dry-runs, publishes, raises bugs with their own proof)
- `e2e-ticket` command — the staged pipeline from requirements to published result
- `.cursor/rules/` — conventions, environment approval, evidence visibility, publishing
- `npm run check:tool-sync` fails when the two trees drift apart

`skills-lock.json` lists useful third-party Playwright skills. They are not
vendored here; install them into `.agents/skills/` if you want them.

## CI

`.github/workflows/e2e.yml`:

- **Push and pull request** — typecheck, tree-sync, and the full demo suite. No
  secrets needed, so the badge means something on a fresh fork.
- **On demand** — pick an environment from the Actions tab, optionally with a
  ticket key to capture and upload an evidence bundle. Production stays `@smoke`
  through the config guard regardless of what you select.
- Secrets for your own environments: `BASE_URL`, `E2E_USERNAME`, `E2E_PASSWORD`,
  and optionally `E2E_SITE_NAME` and `E2E_LOGIN_PATH`.

## Layout

| Path | Role |
| --- | --- |
| `tests/<feature>/` | Specs by feature. The ticket is a tag, not a folder. |
| `tests/auth.setup.ts` | Signs in once; the `setup` project every test depends on |
| `pages/` | Page objects. Selectors live here. |
| `utils/` | Environment loading, test data, cleanup, shared interactions |
| `scripts/` | Publishing pipeline and the tool-sync checker |
| `templates/` | Scaffolds for a new spec and a new page object |
| `docs/APP-MAP.md` | How to reach each page, and the helpers that already exist |
| `fixtures.ts` | Import `test` and `expect` from here |

## Selectors: lessons learned

- **Prefer `getByRole` and `getByLabel` over ids and CSS.** Responsive pages
  often render mobile and desktop copies of the same form sharing ids;
  `locator("#id")` picks the first in DOM order, which may be the hidden one, so
  the test fills an invisible field and appears to do nothing.
- **`.or()` needs `.first()` on the composition.** Two single-element locators
  combined with `.or()` resolve to two elements and trip strict mode.
- **Never wait on the app URL alone after a sign-in submit.** Sign-in URLs embed
  `redirect_uri`, so a URL match can succeed while the browser is still on the
  identity provider. Wait for something that only exists afterwards.
- **Dialog first, then toast.** Wait for the dialog to detach, then assert the
  toast. Asserting the toast while the dialog is still open races with its DOM.
  `waitForModalDetachedThenToast` does both.
- **Trust the deployed DOM over the source you are reading.** What is deployed can
  lag or lead the branch in front of you.

## Adding a feature test

1. Map the screen. `docs/APP-MAP.md` first, the app second.
2. Copy `templates/spec.template.ts` and `templates/page-object.template.ts`.
3. Write **one** test, run it alone, and watch it fail at the assertion that
   encodes the requirement. If the feature already works and it passes first
   time, mutate the assertion, confirm it fails there, and revert exactly.
4. Drive it green, then write the next one. Never batch-write specs.
5. Tag the describe with the ticket, add `@smoke` only when it is read-only.
6. Capture evidence, publish, and append the row to `COVERAGE.md`.
