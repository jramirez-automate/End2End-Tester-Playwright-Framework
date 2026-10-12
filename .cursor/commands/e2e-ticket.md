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
for the key and its acceptance criteria.

**Fetch the ticket.** If an Atlassian MCP is configured, get it with `getJiraIssue`,
requesting only the fields you need: summary, description, acceptance or testing
criteria, parent, components, status, comments, attachments and remote links. Never
echo the raw issue JSON. With no tracker MCP, ask the user to paste the ticket and
its criteria.

**Show the issue first.** Give the user a condensed readout in chat, so they have
the same context you do: summary, status, reporter and component, the reported
symptom with repro and expected versus actual, and the key findings from the
comment thread (root cause, the dev fix or PR, QA notes, Zendesk ids).

Check `COVERAGE.md`: if this ticket or feature is already covered, say so and stop
to ask what to add. Otherwise turn the ticket into a numbered checklist of testable
behaviours, and note each criterion that can't be automated and why. Stop and ask
if a requirement has no observable outcome.

**Zendesk context.** Run this whenever the ticket points at Zendesk, however full
the description is:

- **A Zendesk id is mentioned.** Scan the summary, description, comments and remote
  links for an id (`Zendesk ticket #1546818`, `ZD: 1342215`) or an
  `…zendesk.com/agent/tickets/…` URL. If you find one, tell the user the id and ask
  them to print that Zendesk ticket as a PDF and upload it here. Ask, then carry on
  with the checklist if they decline or it isn't available.
- **The ticket is thin** (no description, or a title or one-liner too thin to derive
  criteria from). Check the issue's attachments for a Zendesk PDF export. If there
  is one, name it and ask the user to download it from Jira and upload it here;
  nothing here pulls attachment binaries. If there is neither an attachment nor a
  Zendesk id, say so and continue with the checklist as it is. A thin description
  alone doesn't block the pipeline.

Once the PDF arrives, read it and take the customer-facing context: symptom, repro
steps, expected behaviour, any acceptance detail. Re-derive the checklist from it
before step 2; it also feeds the layer table and the test plan. If the PDF adds
anything, show the whole readout again (ticket and Zendesk detail merged, with new
or changed points marked) and the re-derived checklist, not just a diff.

**Description edit (optional, thin tickets only).** When the description was thin
and the ticket was not raised by support staff from a Zendesk template, show the
user what you would add and ask. On yes, `editJiraIssue` the `description` (ADF
`contentFormat`), appending an "Additional context (from Zendesk)" section. Never
overwrite or delete what is there. For support-raised tickets skip the edit and
keep the context in the test plan.

Then draft the cases, using the `test-case-design` skill: write the checklist
as `src/evidence/<key>/test-cases.json`, one `TC-00N` per item, from
`templates/test-cases.example.json`. Leave `test` empty, and mark a case that
will stay manual with `"manual": true`. The plan stays local: nothing goes to
Zephyr until the specs pass (step 6).

## 2 · Map the screens and the API behind them

Delegate to **e2e-explorer** with the feature and the checklist. You want routes,
selectors, async behaviour, and existing page objects, not source code. Always
ask for its **API map** too: per checklist item, the endpoint behind it (method
and path), the payload fields that matter, the success status and body field,
and the error status with its body shape. Persist anything expensive it found
into `docs/APP-MAP.md` at step 7.

Then give each checklist item a **layer**, using the `api-testing` skill, and
show the table (`# | Requirement | Layer | Spec file | Test title`) so the user
can steer before any spec is written:

- **API** when the requirement is a server contract: validation, status codes,
  persistence, permissions.
- **UI** when it is rendering or interaction.
- **UI + API** when a defect crosses the boundary, for example the page sends a
  bad value and the server must refuse it cleanly. That is two rows, one per
  layer, both mapped to the requirement.

An API row's case in `test-cases.json` gets `"layer": "api"` and a name starting
"Verify (API)". Its steps are: authenticate, send `<METHOD> <path>` with the
stated payload, read the response. Its expected result is the status code plus
the body field or error that proves the requirement. Plan an API case only when
it maps to a requirement; exploratory API checks stay out of Zephyr.

## 3 · Author, one slice at a time

For each checklist item, in order:

1. Write **one** test. A UI slice starts from `templates/spec.template.ts`. An
   API slice goes in `src/tests/<feature>/<name>.api.spec.ts`, beside the UI
   spec and under the same ticket tag, from `templates/api.spec.template.ts`:
   call through the `api` / `anonApi` fixtures, never the built-in `request`,
   and read bodies with `readBody()` so the case records its `-response.json`
   proof. For a UI + API requirement, write the API slice first: it is fast and
   deterministic, and it tells a front-end cause apart from a back-end one.
2. Run that test alone: `npx playwright test <file> -g "<title>"`.
3. See it fail for the right reason. A setup or selector error is not a red
   proof; keep going until the failure is the assertion that encodes the
   requirement (for an API slice, the status code or the deciding body field).
   If the feature already works and it passes first time, mutate the assertion,
   confirm it fails there, and revert exactly.
4. Drive it to green, then move to the next item.
5. Put the test's title in its case's `test` field in `test-cases.json`.

Never write several specs and run them as a batch. Selectors belong in page
objects, from `templates/page-object.template.ts`.

## 4 · Regression

Delegate to **e2e-runner** for the whole ticket set, UI and `*.api.spec.ts`
together, then the full suite on a
write environment. Ask before adding another environment. If the runner reports
an app bug, stop and surface it rather than bending the test.

## 5 · Evidence

Delegate to **e2e-evidence**: capture with `EVIDENCE=true`, verify every
screenshot and video actually shows the subject, write `SUMMARY.md`. An API
case's proof is its `<test>-<env>-response.json`, checked for the status and
body the requirement needs. Once the run has API cases, the summary, the results
comment and the wiki plan split into **UI Tests** then **API Tests**, with TC ids
running on from the UI rows into the API rows.

## 6 · Publish

Specs first, then Zephyr. Once every automated case has a passing spec, its
`test` title in `test-cases.json`, and a result in the evidence run from step 5
(`cases` refuses any case whose title is not in that run's results):

1. `node scripts/publish.mjs cases --ticket <key> --dry-run`, and show the user
   every case name, step, expected result, and linked test title.
2. **Zephyr cannot delete a test case.** Wait until the user approves that exact
   list, then run it with `--create-cases`. Never add `--force` unless the user
   asks for duplicates. If the user wants no cases in test management, skip it.

API cases (`"layer": "api"`) are created labelled `API` and `Automated`. They
record a result only on environments where they ran, so on an environment that
runs only `@smoke` they are reported as not run there, not as missing.

Then delegate to **e2e-publisher**: dry run, then publish, then a bug per
failure with the failure media and a redacted HAR of the failing run attached to
that bug. `all` records the run
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
