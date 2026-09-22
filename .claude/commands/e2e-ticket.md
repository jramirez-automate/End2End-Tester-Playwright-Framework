---
description: Run one ticket end to end: explore, author test-first, run, evidence, publish.
argument-hint: <TICKET-KEY>
---

Run one ticket end to end: explore, author specs test-first, get them green,
evidence them, publish, then record what was learned.

Ticket key: `$ARGUMENTS`

## 0 · Ground rules

- Specs live in `tests/<feature>/`, named by feature, never by ticket. The
  ticket is a tag: `test.describe("…", { tag: "@ABC-123" }, …)`.
- Import `test` and `expect` from `fixtures.ts`.
- Write flows run on write environments only. Production is `@smoke`.
  **Ask before any run against a shared or production environment.**
- Data the tests create is named with `e2eName()` and deleted in `afterEach`.

## 1 · Requirements

Read the ticket. Turn it into a numbered checklist of testable statements. Stop
and ask if a requirement has no observable outcome. Check `COVERAGE.md`: if this
is already covered, say so and ask what to add.

## 2 · Map the screens

Delegate to **e2e-explorer** with the feature and the checklist. You want routes,
selectors, async behaviour, and existing page objects, not source code. Persist
anything expensive it found into `docs/APP-MAP.md` at step 7.

## 3 · Author, one slice at a time

For each checklist item, in order:

1. Write **one** test, from `templates/spec.template.ts`.
2. Run that test alone: `npx playwright test <file> -g "<title>"`.
3. See it fail for the right reason. A setup or selector error is not a red
   proof; keep going until the failure is the assertion that encodes the
   requirement. If the feature already works and it passes first time, mutate
   the assertion, confirm it fails there, and revert exactly.
4. Drive it to green, then move to the next item.

Never write several specs and run them as a batch. Selectors belong in page
objects, from `templates/page-object.template.ts`.

## 4 · Regression

Delegate to **e2e-runner** for the whole ticket set, then the full suite on a
write environment. Ask before adding another environment. If the runner reports
an app bug, stop and surface it rather than bending the test.

## 5 · Evidence

Delegate to **e2e-evidence**: capture with `EVIDENCE=true`, verify every
screenshot and video actually shows the subject, write `SUMMARY.md`.

## 6 · Publish

Delegate to **e2e-publisher**: dry run, then publish, then a bug per failure
with the failure media attached to that bug.

## 7 · Record

- Append the ticket's row to `COVERAGE.md`.
- Add any `NEW NAV FACT` to the Navigation index and any `NEW HELPER` to the
  Helpers index in `docs/APP-MAP.md`, extracting the helper into
  `utils/interactions.ts` first.

## Final report

Coverage per requirement, spec paths, run results per environment, bundle path,
published links, bugs raised, and anything left manual with the reason.
