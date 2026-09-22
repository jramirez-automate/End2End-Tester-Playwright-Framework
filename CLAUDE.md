# Claude Code entry point

The conventions contract for this repository is `AGENTS.md`. Read it first.

- Layout, tags, data discipline, and the authoring loop: `AGENTS.md`
- Routes and reusable helpers: `docs/APP-MAP.md`
- What is already covered: `COVERAGE.md`
- Debugging and selector lessons: `README.md`

Subagents live in `.claude/agents/`, the ticket pipeline in
`.claude/commands/e2e-ticket.md`, and shared skills in `.agents/skills/`
(symlinked into `.claude/skills/`). The `.cursor/` tree mirrors all of it;
`npm run check:tool-sync` fails when the two drift apart.
