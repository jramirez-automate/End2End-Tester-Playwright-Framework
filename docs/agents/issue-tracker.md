# Issue tracker: Jira or GitHub, read by hand

Tickets live in the tracker named by `PUBLISH_TRACKER` in `.env.publish`. No
skill or agent here reads the tracker: the user pastes a ticket's acceptance
criteria into the chat.

## When a skill says "fetch the relevant ticket"

The ticket key is the spec's tag (`{ tag: "@ABC-123" }`) or the key in the
branch name. Its spec, in order:

1. `src/evidence/<KEY>/test-cases.json` — the TC rows (`tc`, `name`,
   `precondition`, `steps`, `expected`, `test`) drafted from the criteria.
2. The acceptance criteria the user pasted in this conversation.
3. Neither exists: ask the user to paste the criteria.

## When a skill says "publish to the issue tracker"

Results, test cases and bugs go through `scripts/publish.mjs`, dry run first,
and bugs through the `bug-reporting` skill. Nothing else writes to the
tracker.

## Standards for the Standards axis

`AGENTS.md`, `.cursor/rules/e2e-conventions.mdc`, and the Best practices
section of `README.md`.
