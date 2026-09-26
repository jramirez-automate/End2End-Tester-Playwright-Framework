---
name: test-case-design
description: Turn a ticket, user story or acceptance criteria into manual-QA test cases (TC-001, TC-002 …) before any Playwright spec exists — covering the happy path, refusals, edges and state, using input grouping, edge values and condition tables. Use when asked to "write test cases", "what should we test", "design the test scenario", "what are the edge cases" or "is this testable", or when drafting a ticket's TC table.
---

# Test-case design

A ticket's test cases are written **first**, in the ticket's language, and
everything else — the test-management cases, the Playwright specs, the
evidence table — is built from them. The bar for a finished case: a tester who
has never seen the feature can run it by hand and agree on pass or fail.

## The shape of one case

| Field           | What goes in it                                                                 |
|-----------------|---------------------------------------------------------------------------------|
| `tc`            | `TC-001`, `TC-002` … three digits. Numbers are never reused or shuffled.        |
| Name            | A single sentence that starts with **Verify**.                                  |
| Preconditions   | What must already be true: the account/role, the seed data, the environment.    |
| Steps           | Numbered things a person does — sign in, open the screen, act. One per line.    |
| Expected result | Written against the **last** step. One thing you can see: a heading, a message, a row, a URL. |
| Priority        | P1 release-blocking · P2 hurts users but has a workaround · P3 minor.            |
| Type            | Positive, Negative, Edge or Regression.                                         |
| Why this case   | Which criterion it covers and how it was found (see below).                     |
| Automate?       | UI spec, API spec, or manual — manual always says why.                          |

## Finding the cases — ask five questions per criterion

1. **What has to work?** The main flow, with realistic data.
2. **What has to be refused, and how?** The message shown, the button that
   stays disabled, the record that is *not* created.
3. **Where are the edges?** Nothing, one, lots; the smallest and largest
   allowed value and one past each; odd text (apostrophes, accents, emoji,
   spaces at either end, very long pasted values); the same thing twice.
4. **What changes the answer?** Role, record status (draft, archived,
   deactivated), a second user or tab touching the same record, a timeout.
5. **Where else does this show up?** Other screens, exports, emails or
   portals that display the same data — they drift out of sync.

## Three techniques that keep the list short

**Group the inputs.** Values that should be treated the same form one group;
one representative per group is enough. A checkout postcode has four groups:
valid, empty, letters only, too long — four cases, not forty.

**Test each side of a limit.** Mistakes hide on the edge of a rule. If a name
allows 1–50 characters, try 0, 1, 50 and 51 (add 2 and 49 when the rule is
risky).

**Tabulate combinations.** When several conditions decide the outcome, list
every combination in a table and give each row an expected result. Rows
nobody can fill in are questions for the ticket.

| Signed in | Items in cart | Details complete | Expected                    |
|-----------|---------------|------------------|-----------------------------|
| Yes       | Yes           | Yes              | Order confirmation shown    |
| Yes       | Yes           | No               | Field error, stays on form  |
| Yes       | No            | —                | Checkout not offered        |
| No        | —             | —                | Sent to the sign-in page    |

Note in **Why this case** which technique a case came from, so a reviewer can
see that the edges were deliberate.

## Worked example

| tc     | Name                                                  | Steps                                                                                                    | Expected result                          | P  | Type     | Why this case          | Automate? |
|--------|-------------------------------------------------------|----------------------------------------------------------------------------------------------------------|------------------------------------------|----|----------|------------------------|-----------|
| TC-001 | Verify a completed order shows the confirmation       | 1. Sign in 2. Add "Sauce Labs Backpack" to the cart 3. Open the cart 4. Check out with a name and postcode "4000" 5. Click **Finish** | "Thank you for your order!" is shown     | P1 | Positive | AC1 — main flow        | UI        |
| TC-002 | Verify checkout is refused without a postcode         | 1. Sign in 2. Add a product 3. Open the cart 4. Click **Checkout** 5. Enter a name, leave postcode empty, click **Continue** | "Postal Code is required" is shown       | P1 | Negative | AC2 — empty group      | UI        |
| TC-003 | Verify a 51-character first name is refused           | 1. Sign in 2. Add a product 3. Start checkout 4. Enter a 51-character first name, click **Continue**       | *Open question: limit and message not in the ticket* | P3 | Edge | AC2 — one past the limit | After the answer |

## Before handing off

- Every acceptance criterion has at least one case, or a written reason why not.
- Every "what has to work" case has a "what has to be refused" partner.
- No case relies on another case having run first.
- Steps contain no code words — no locators, helper names, file paths or
  `afterEach` — and no filler like "open the app" when the ticket has real steps.
- Anything the ticket doesn't settle (limits, exact wording, who may do it) is
  asked on the ticket, not guessed into an expected result.
- Keyboard use, error wording and slow-network behaviour are cases too when
  the ticket touches them.

## In this repo

- The table is the numbered checklist `/e2e-ticket` step 1 asks for — put it
  on the ticket (or `evidence/<KEY>/test-cases.md`) before any spec is written.
- Each automated case becomes one test: the title is the case name without
  "Verify", and its `test.step()` titles follow the case's steps
  (`e2e-testing-patterns` → Readable steps; `api-testing` for API cases).
  `publish.mjs cycles` creates the test-management cases from those titles, so
  a vague title becomes a vague case.
- Manual-only cases and their reasons go in `COVERAGE.md` and the final report.
