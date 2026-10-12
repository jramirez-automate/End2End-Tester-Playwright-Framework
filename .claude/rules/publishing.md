---
description: How to publish results, and what a raised bug must carry.
alwaysApply: true
---

Publishing goes through `scripts/publish.mjs`. Providers come from
`.env.publish`; anything set to `none` or missing credentials is skipped.

- **Dry run first:** `node scripts/publish.mjs all --ticket <key> --dry-run`,
  and show the plan before writing to any external system.
- **Never hand-write results.** The table comes from
  `src/evidence/<key>/results-<env>.json`, which the run produces. A wrong row means
  the run was wrong.
- **One column per environment that actually ran.** Do not add a column of "not
  run" notes for an environment that was out of scope.
- Test case ids are `TC-001`, `TC-002`, and so on.
- **Specs first, then Zephyr.** Draft `src/evidence/<key>/test-cases.json`
  before the specs, but run `publish.mjs cases` only once every automated case
  has a passing spec and its `test` title filled in; `all` then records the run
  with `mark-pass` against those cases instead of creating new ones. The plan
  holds cases, never results.
- **Zephyr cannot delete a test case.** Creating one needs `--create-cases`;
  pass it only after the user approves the dry-run case list. Never `--force`.
- **Every bug raised from a failure carries its own proof:**
  `publish.mjs bug --ticket <BUG-KEY> --from <key> --tc <TC-00N>` copies that
  case's `*-FAILED.png` and `*-FAILED.webm` into `src/evidence/<BUG-KEY>/`,
  attaches them, embeds them in the bug's description, and links the bug to the
  ticket under test. It also builds a redacted `<BUG-KEY>-<env>.har` from the
  case's `*-FAILED-trace.zip` and embeds it under a **Network capture** note
  listing the failing calls. A manual finding's DevTools HAR goes in `--files`,
  with auth headers and cookies stripped first, since it is uploaded as it is.
  Proof left only on the parent ticket is incomplete.
- **UI Tests, then API Tests.** When a run has `*.api.spec.ts` cases, the
  summary, comment and wiki plan split into those two sections, with TC ids
  running on from the UI rows. On the wiki plan and the Jira comment each
  section's table has a title row, then `TC | Scenario | Steps | Expected
  result | <env>…`, then a bold row per feature group, which is the spec's
  `test.describe` title. Name describes as feature areas, since they become
  those group rows. An API case's proof is its `-response.json`, shown as a
  file card.
- **Links go in one place.** The publish run gathers the wiki page and the test
  cycles into a single comment. Do not scatter them or repeat them on the
  results table.
- **Chat notification is gated** to `NOTIFY_ON_ENVS` and a fully green run. Ask
  before sending one, and never re-send for the same result.
- Never delete attachments by hand. `publish.mjs cleanup` (ticket) and
  `publish.mjs prune` (wiki page) keep anything they did not upload and report
  what they kept.
