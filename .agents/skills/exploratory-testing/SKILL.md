---
name: exploratory-testing
description: Plan, run and debrief a time-boxed exploratory testing session on a ticket or feature — a written mission, a notes sheet, idea lists for what to try, checks for what counts as wrong, and a debrief that turns findings into bugs and new test cases. Use when asked to "test this manually", "explore the feature", "bug hunt", "find edge cases", "risk-based" or "session-based" testing. Not for writing automated specs.
---

# Exploratory testing

Scripted cases confirm what we already expect. An exploratory session is for
what nobody wrote down: you try something, watch what the product does, and
let that decide the next thing to try. It still needs discipline — a mission
to aim at, a clock, notes, and a debrief — otherwise it turns into clicking
around the happy path.

## Before: write the mission

One sentence, three parts — *what* you'll explore, *what you'll use to put
pressure on it*, and *what kind of problem you're looking for*
(the charter form from Elisabeth Hendrickson's *Explore It!*):

> Explore **checkout** using **the back button and a second browser tab** to
> find **orders placed twice or carts that lose items**.

Check the mission before starting:

- **Too broad** ("test checkout") gives no direction — you'll drift to the
  flow the suite already covers.
- **Too narrow** ("add item, pay, check the total") is a test case — write it
  as one instead.
- **More than one mission?** Split it and queue the rest.
- **No pressure in the middle part?** Add one: a low-privilege role, slow
  network, keyboard only, a very large list, two people editing one record.

Read the area's entries in `docs/APP-MAP.md` and `COVERAGE.md` first so the
session aims at what isn't covered yet.

## During: time-box and take notes

Pick 45, 60 or 90 minutes and protect it. Notes are part of the output even
when nothing breaks — they're the record of what was covered.

```markdown
# Session — <KEY> <mission, short>
Mission: Explore … using … to find …
Tester: … | Env: … | Build: … | Started: 14:00 | Length: 60 min

## Log (tried → saw)
- 14:05 Back button after Finish → cart empty, one order ✓
- 14:12 Finish in two tabs → both tabs show a confirmation ⚠ → Bug A

## Bugs
- Bug A — order confirmed twice from two tabs

## Questions (not bugs yet)
- Should a stale tab be allowed to resubmit? → ask the PO

## Not covered
- Card declines (no test card on this env)
```

Stay on a write environment unless the mission is read-only, and ask before
touching shared or production environments. Anything you create gets the
`E2E-` prefix and is deleted afterwards.

## Ideas for what to try

Say which list you're working from in the log, so coverage is visible.

- **Product sweep** — go through the feature's structure, functions, data,
  interfaces, platform, the way people actually operate it, and anything
  time-based (James Bach's SFDIPOT list).
- **Inputs** — at, just under and just over each limit; none / one / many;
  empty, whitespace, very long, pasted, accented, emoji, `' " < > &`, negative
  numbers, dates at month and year ends.
- **Interruptions** — refresh during a save, back button, second tab,
  double-click on submit, session expiry, network drop right after submit.
- **Journeys** — follow the money; follow one record through every screen
  that shows it; try to break it on purpose; look only at layout, wording and
  focus order (after James Whittaker's "tours").

## Is it wrong? Check more than one reference

A single reference can mislead, so compare what you see against several:
the ticket and help text, how the product behaves elsewhere, how it behaved
last release, comparable products, what a user would reasonably expect, the
feature's purpose, and standards such as accessibility (Michael Bolton's
*FEW HICCUPPS* list names these). Write down the contradiction you saw — "the
badge says 2, the cart lists 1" — not a guess at the cause.

## After: debrief

Close the session with five short headings on the ticket or the notes sheet:

- **Covered** — mission, environment, how long, which idea lists.
- **Found** — bugs raised (with keys) and questions asked.
- **Blocked by** — missing data, access, a broken environment.
- **Still open** — the follow-up missions, written out.
- **Risk call** — ship / ship with known issues / hold, and why.

Then route what you found:

- Each problem → the **`bug-reporting`** skill, with the screenshot or
  recording you took while it was on screen.
- Anything that could break again, or that is now just fixed inputs and one
  expected result → a new case via **`test-case-design`**, then a spec. Once
  it's predictable it belongs in the suite, not in the next session.
- Lasting facts (fragile flow, environment trap) → `docs/APP-MAP.md`.

## In this repo

- Write envs are `WRITE_ENVS` in `utils/env.ts`; everything else runs `@smoke`
  only. Ask before any shared or production session (`env-run-approval`).
- Durable facts go to `docs/APP-MAP.md` → **Quirks**.
- Save session notes and media under `evidence/<KEY>/` (gitignored).
