# E2E Control Room

A local dashboard that starts and supervises `/e2e-ticket` Claude Code runs, and
reads the evidence the suite has already produced.

- One tab per run: the 7-step pipeline rail, the live chat (answer the pipeline's
  gates with buttons), subagent cards, live browser video, evidence as it lands.
- Read-only views over `src/evidence/`, `COVERAGE.md`, `src/tests/` and
  `run-history/`: what needs attention, tickets, a release board, bugs, coverage.
- Per-environment run locks, a worktree per ticket, a credentials manager, and
  partial actions (rerun failing, recapture evidence, publish steps) on ended runs.

Design notes: [web/DESIGN.md](web/DESIGN.md).

## Requirements

- Node 20 or later, Playwright browsers.
- For real runs: the `claude` CLI, installed and logged in. Demo mode needs neither.
- For write environments and publishing: `.env.<env>` and `.env.publish` at the repo
  root, as described in the main README.

## Run

```bash
cd dashboard
npm install
npm run dev:demo   # no Claude, no cost: a mock pipeline that raises a gate in ~1s
npm run dev        # real runs: server on 127.0.0.1:5511, Vite web on 5173 (proxies /api)
```

`npm run build && npm start` serves the built `web/dist` from the server on :5511.

In demo mode the server spawns `server/mock-claude.mjs` instead of `claude`, always
uses this checkout (no worktree) and skips onboarding. Start a run with any ticket
key, answer the gate, and it completes. Delete `src/evidence/<KEY>/` afterwards.

## Configuration

| Env var | Default | Use |
| --- | --- | --- |
| `DASHBOARD_ENVS` | `demo` plus every `.env.<name>` at the repo root | environments the New run form offers, in promotion order (`demo, local, dev, staging, prod`, then others) |
| `DASHBOARD_ENV_CAPS` | 1 per environment | concurrent runs per environment, e.g. `dev=2,staging=1` |
| `DASHBOARD_BASE_BRANCH` | `main` | branch a fresh worktree starts from |
| `DASHBOARD_MODEL` / `DASHBOARD_EFFORT` | `sonnet` / the CLI default | model and effort for spawned runs |
| `DASHBOARD_SUITE_DIR` | this repo | the checkout the read-only views read |
| `DASHBOARD_HISTORY_DIR` | `<suite>/run-history` | run history somewhere else |
| `DASHBOARD_DATA_DIR` | `server/data` | run records and logs, e.g. for an isolated instance |
| `PORT` | `5511` | server port |

From `.env.publish` it reads `TICKET_PATTERN` (which ticket keys a run accepts),
`JIRA_BASE_URL` (ticket links and read-only status) and `EVIDENCE_DIR`.

## How it works

- Each run is a `claude -p` child in stream-json mode, with this checkout (or the
  ticket's worktree) as its working directory. The first message is
  `/e2e-ticket <KEY>`. Every event goes to a write-ahead log
  (`server/data/runs/<id>/events.ndjson`) that also feeds the UI over SSE, so a tab
  survives a restart.
- Step progress merges `src/evidence/<KEY>/pipeline-status.ndjson` telemetry, which
  wins, with steps inferred from tool calls (`shared/pipeline.ts`).
- A gate is the session going idle mid-pipeline. Your answer goes to the child's
  stdin. Safe auto-approve answers flow gates only: steps 4 (another environment)
  and 6 (publish) always wait for you.
- The suite carries the hooks the dashboard switches on. Each is a no-op unless
  its variable is set:
  - `src/fixtures.ts` streams a CDP screencast to `THUMBS_DIR`;
  - `progress-reporter.ts` writes test lifecycle lines to `PW_PROGRESS_FILE`;
  - `src/utils/env-lock.ts`, from global setup and teardown, takes an environment
    lock from `E2E_ENV_LOCK_URL`;
  - `history-reporter.ts` is always on (`E2E_HISTORY=off` skips it) and writes
    `run-history/<timestamp>-<env>.json`.
- Partial actions on an ended run: Rerun failing (`playwright test --last-failed`),
  Recapture evidence (`EVIDENCE=true`), and the `publish.mjs` steps `attach`,
  `comment`, `mark-pass` and `plan`. Publish actions always dry-run first; the real
  post is a second, explicit click.

## Read-only views

None of these start anything. They read files on disk, plus Jira status (GET only,
cached 5 minutes) when `.env.publish` has Jira credentials.

- **Attention** (`/`): runs at a gate, pipelines blocked in the last 14 days, bugs to
  retest, tickets Jira marks Ready for test, failing tickets, and recent passes still
  waiting on the last environment.
- **Tickets** (`/tickets`, `/tickets/:key`): every `src/evidence/<KEY>/` bundle. The
  per-environment verdicts come from `results-<env>.json`, the case table from
  `test-cases.json` matched on each case's `test` title, plus media inline, bugs
  raised from the ticket, the `COVERAGE.md` row, telemetry and every file.
- **Board** (`/board`): tickets by the furthest environment with a result, done once
  the last environment passes.
- **Bugs** (`/bugs`): bundles with a `bug.json`, written by `publish.mjs bug`, grouped
  Ready to retest, Retest failed, Waiting on a fix and Fixed.
- **Coverage** (`/coverage`): specs by `src/tests/<feature>/`, their ticket tags and
  latest run, then suite health from run history.

Files are served only from inside a ticket's evidence folder or the run history
folder (`server/http/files.ts`).

## Gotchas

- `npm run dev` restarts the server when a server file changes, which interrupts
  every active run. Supervise real runs under `npm start`.
- The credential store lives outside the repo (`~/.config/e2e-dashboard`, or
  `%APPDATA%\e2e-dashboard`). `XDG_CONFIG_HOME` isolates it for a test instance.
- Fresh worktrees live in `<repo>.worktrees/<KEY>` on `feature/<KEY>`. An existing
  worktree on that branch is reused; anything else by that name is refused.
- Vite binds `::1` and the server binds `127.0.0.1`. The proxy is set up for that.
- The approval rules still apply: starting a run against a shared or production
  environment from the dashboard needs the same go-ahead as from a terminal.
