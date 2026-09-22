# Agent guide

This is the End2End Tester Playwright Framework: a standalone Playwright suite plus
a ticket workflow that authors specs, evidences them, and publishes the result.
Tests run against a deployed app over HTTP. There is no application source here.

The default environment is `demo`, which targets public sample apps and needs no
credentials, so a fresh clone runs green.

## Conventions

- Import `test` and `expect` from `fixtures.ts`.
- Specs live in `tests/<feature>/`. Trace a ticket with a tag: `{ tag: "@ABC-123" }`.
- Selectors live in page objects under `pages/`. Prefer `getByRole` and
  `getByLabel`; scope a dialog with `getByRole("dialog")`. Put `.first()` on an
  `.or()` composition, not on each side.
- Write flows run on write environments only (`WRITE_ENVS` in `utils/env.ts`).
  Production is `@smoke`. Never edit that guard to make a run possible.
- Name created data with `e2eName()` and delete it in `test.afterEach` through
  `CleanupRegistry`.
- Author one test at a time. Run it alone. The failure that counts is the
  assertion of user-visible behaviour, not a setup error.
- Check `docs/APP-MAP.md` before adding a route or a widget helper, and record
  what you learn there.
- Credentials belong in gitignored `.env.<TEST_ENV>` and `.env.publish` only.
- Read the app surgically. Never dump whole files or raw API responses into chat.

## Commands

```bash
npm test                                            # demo suite, no credentials
TEST_ENV=dev npx playwright test tests/<f>/<x>.spec.ts -g "<title>"
TICKET=ABC-123 TEST_ENV=dev npx playwright test     # one ticket's tag
TICKET=ABC-123 EVIDENCE=true npx playwright test    # evidence bundle
node scripts/publish.mjs all --ticket ABC-123 --dry-run
npm run typecheck && npm run check:tool-sync
```

**Ask before running against a shared or production environment.** Demo and local
need no approval.

## Tooling layout

- `.agents/skills/` — shared skills, symlinked into `.claude/skills/` and `.cursor/skills/`
- `.claude/agents/`, `.cursor/agents/` — explorer, runner, evidence, publisher
- `.claude/commands/`, `.cursor/commands/` — the `e2e-ticket` pipeline
- `.cursor/rules/` — conventions, environment approval, evidence, publishing

Both tool trees must say the same thing. `npm run check:tool-sync` fails when they
drift; edit both copies in one change.
