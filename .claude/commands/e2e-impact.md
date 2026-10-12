---
description: Map an app branch's changes to the specs that cover them, then run only those.
argument-hint: <app-branch> [base]
---

Map what an app branch changed to the specs that exercise it, and to the changes
no spec covers. Then, with approval, run only the selected specs.

Arguments: `$ARGUMENTS` (app branch, optional base; both default as below)

## 1 · Map

Dispatch the `e2e-impact` agent with the branch and base. It diffs the checkout
in `APP_SOURCE_DIR` and returns the selection. With no branch given it uses the
checkout's current branch; with no base, the checkout's default branch.

On `Source: none`, stop and say `APP_SOURCE_DIR` is not set for this
environment (`.env.example` shows the key). Do not guess a selection from the
branch name.

## 2 · Report

Show the agent's selection as it came back: selected specs with their grade,
the `Run:` and `Wider:` commands, and the uncovered changes. Add nothing it did
not find.

## 3 · Run, on approval

Ask which environment to run against, and whether to run `Run:` (the specs that
depend on the change) or `Wider:` (plus those that pass through it). Wait for
approval of that environment. Then run it as given, with `TEST_ENV=<env>` in
front and
`--retries=0 --trace=retain-on-failure` after. Hand any failures to the
`e2e-runner` agent to triage; it decides between a stale selector and an app
change the branch introduced.

## 4 · Close

Report passed and failed per spec, and list the uncovered changes again. Offer
to cover them through `/e2e-ticket` when the branch has a ticket; write nothing
for them here.
