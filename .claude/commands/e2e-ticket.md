---
description: Run one ticket end to end: explore, author test-first, run, evidence, publish.
argument-hint: <TICKET-KEY>
---

Run one ticket end to end: explore, author specs test-first, get them green,
evidence them, publish, then record what was learned.

Ticket key: `$ARGUMENTS`

## 0 · Ground rules

- Specs live in `src/tests/<feature>/`, named by feature, never by ticket. The
  ticket is a tag: `test.describe("…", { tag: "@ABC-123" }, …)`.
- Import `test` and `expect` from `src/fixtures.ts`.
- Write flows run on write environments only. Production is `@smoke`.
  **Ask before any run against a shared or production environment.**
- Data the tests create is named with `e2eName()` and deleted in `afterEach`.

## 1 · Requirements

If the ticket key above is empty or is not a key like `ABC-123`, stop and ask
for the key and its acceptance criteria. Nothing here fetches a ticket, so ask
the user to paste the criteria.

Read the ticket. Turn it into a numbered checklist of testable statements. Stop
and ask if a requirement has no observable outcome. Check `COVERAGE.md`: if this
is already covered, say so and ask what to add.

Then draft the cases, using the `test-case-design` skill: write the checklist
as `src/evidence/<key>/test-cases.json`, one `TC-00N` per item, from
`templates/test-cases.example.json`. Leave `test` empty, and mark a case that
will stay manual with `"manual": true`. The plan stays local: nothing goes to
Zephyr until the specs pass (step 6).

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
5. Put the test's title in its case's `test` field in `test-cases.json`.

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

Specs first, then Zephyr. Once every automated case has a passing spec, its
`test` title in `test-cases.json`, and a result in the evidence run from step 5
(`cases` refuses any case whose title is not in that run's results):

1. `node scripts/publish.mjs cases --ticket <key> --dry-run`, and show the user
   every case name, step, expected result, and linked test title.
2. **Zephyr cannot delete a test case.** Wait until the user approves that exact
   list, then run it with `--create-cases`. Never add `--force` unless the user
   asks for duplicates. If the user wants no cases in test management, skip it.

Then delegate to **e2e-publisher**: dry run, then publish, then a bug per
failure with the failure media attached to that bug. `all` records the run
against the created cases with `mark-pass`. Without
`src/evidence/<key>/zephyr.json` it falls back to `cycles`, which creates a new
case for every test: ask before passing `--create-cases` to it, and never
publish the same ticket's cases twice.

## 7 · Record

- Append the ticket's row to `COVERAGE.md`.
- Add any `NEW NAV FACT` to the Navigation index and any `NEW HELPER` to the
  Helpers index in `docs/APP-MAP.md`, extracting the helper into
  `src/utils/interactions.ts` first.

## Final report

Coverage per requirement, spec paths, run results per environment, bundle path,
published links, bugs raised, and anything left manual with the reason.
