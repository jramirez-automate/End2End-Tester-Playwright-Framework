---
name: bug-reporting
description: Write and file a bug a developer can reproduce on the first try — Environment block first, exact steps from a known state, expected vs actual, severity and priority kept separate, the failure media attached to the bug itself — and only after the user confirms. Use when asked to "raise a bug", "log a defect", "write this up", when a tester describes a problem, or when a test case fails in an evidence run.
---

# Bug reporting

The reader of a bug is a developer who wasn't there. They need to know
where it happens, how to make it happen, what should have happened, and see
it happening — nothing else. Everything in this skill serves those four.

## Before writing

**Get the facts, not an interview.** Take the tester's description (or the
failed test case and its `*-FAILED` media) and fill only the gaps:
expected vs actual, the exact data used, and whether it happens every time.
Don't ask for what's already in front of you.

**Make sure it's a bug.** Compare it with the ticket's criteria and with one
other reference — last release, another screen showing the same data, the
help text. If the ticket never said what should happen, it's a question for
the ticket, not a bug.

**Look for it first.** If a bug for the same behaviour exists, add your
evidence there.

**Decide how many.** One bug per wrong behaviour. Two different screens, two
failure modes, or two fixes that could ship separately means two bugs, linked
to each other and to the ticket under test.

## The report

```markdown
Environment:
URL: <the exact page where it happens — page.url() at the failure, not the home page>
Browser ver: <automated: the Playwright Chromium build and mode; manual: your browser and version>
Build: <version under test>   Env: <env name>   Account: <test user / role>

Summary:
<one line, product words: what is wrong, and where>

Steps to reproduce:
1. Sign in as <role>
2. Open <screen>
3. <action, with the exact value — e.g. search for "O'Brien">

Expected result:
<what should happen — quote the criterion or TC-### it breaks>

Actual result:
<what happens — exact message text; what was or wasn't saved>

Frequency: every time | intermittent (<n> of <m> tries, and what differed)
Severity: Critical | High | Medium | Low
Priority: <suggested — the lead / PO decides>
Found by: <TC-### in <KEY> evidence run | exploratory session "<mission>">
Evidence: <attached screenshot / recording, embedded below>
```

## Writing rules

- The **Environment block comes first**, before the summary.
- Write what a user sees. "The badge shows 2 after removing an item", not the
  function or query you suspect. Leave out file paths, line numbers, selectors
  and code names — the developer will find those, and they date quickly.
- Steps start from signing in and name the exact values used.
- One expected result and one actual result. Quote on-screen text exactly.
- If a sentence wouldn't change what the developer does next, delete it.

## Severity is not priority

- **Severity** is how badly users are hurt:
  **Critical** — data lost or exposed, or a core flow is impossible with no
  workaround; **High** — a main feature is broken; **Medium** — it works with a
  workaround, or only an edge case fails; **Low** — cosmetic or wording.
- **Priority** is how soon it gets fixed, and it's the team's call. A typo on
  the sign-in page is Low severity but may still be fixed first.

## Filing

Show the draft and wait for an explicit yes — nothing is filed without it.
After it's filed, the bug carries its own proof: the screenshot and recording
are attached to **the bug**, not only to the ticket it was found on.

When the fix lands, retest with the bug's own steps on the environment where
it was found, then rerun the related test cases. If nothing in the suite
would catch it coming back, add a case (`test-case-design`) and automate it.

## In this repo

1. Create the bug in the configured tracker (`.env.publish`: Jira or GitHub),
   linked to the ticket under test.
2. Attach the failure media to the bug and embed it in a comment:
   ```
   mkdir -p evidence/<BUG-KEY>
   cp evidence/<KEY>/*<case>*-FAILED.png evidence/<KEY>/*<case>*-FAILED.webm evidence/<BUG-KEY>/
   node scripts/publish.mjs attach --ticket <BUG-KEY> --dry-run
   node scripts/publish.mjs attach --ticket <BUG-KEY>
   node scripts/publish.mjs comment --ticket <BUG-KEY>
   ```
   A manual finding's screenshot or recording goes into
   `evidence/<BUG-KEY>/` and is attached the same way.
3. List it in the parent ticket's final report:
   `Bugs raised: <BUG-KEY> — one line — evidence attached y/n`.
4. Browser version for automated runs: the Chromium bundled with the pinned
   `@playwright/test` (runs are headless unless headed mode was used).
