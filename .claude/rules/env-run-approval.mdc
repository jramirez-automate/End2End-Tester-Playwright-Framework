---
description: Ask before running tests against shared or production environments.
alwaysApply: true
---

**Never start a Playwright run against a shared, staging, or production
environment until the user approves that environment in this conversation.**

That covers the full suite, a single spec, a `--grep` run, evidence capture,
headed or UI mode, and dispatching a CI workflow with those environment values.

- Ask first, and name the environment. One environment per ask when several are
  in play.
- "Run the tests" is not approval for a shared environment. Neither is approval
  given in an earlier conversation.
- The demo environment and a local server need no approval: the demo targets are
  public sample apps and create nothing.
- On a decline, or no answer, skip that environment. Do not run it anyway.
- Do not route around this through CI triggers or write-enable flags.
