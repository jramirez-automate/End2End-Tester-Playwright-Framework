#!/usr/bin/env node
/**
 * Demo-mode stand-in for the claude CLI. Speaks just enough stream-json for
 * the dashboard to exercise its full run lifecycle — init, streaming text,
 * tool cards, a gate, and completion — with zero cost and zero side effects.
 *
 * Use: CLAUDE_BIN=<this file> npm run dev   (then start any run in the UI)
 *
 * Turn 1 answers the initial /e2e-ticket command with a fake step-1 flow and
 * ends the turn on a question (the dashboard shows a gate). Your reply
 * completes the pipeline: the mock appends {"pipeline":"complete"} telemetry,
 * which is exactly how the real command signals completion.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

// The status probe calls `--version` / `mcp list`; answer like a CLI, not a session.
if (process.argv.includes("--version")) {
	console.log("0.0.0-mock (E2E Control Room demo)");
	process.exit(0);
}
if (process.argv[2] === "mcp") {
	console.error("mock-claude has no MCP servers (demo mode)");
	process.exit(1);
}

const sessionId = `mock-${process.pid}-${Date.now().toString(36)}`;
let ticket = "DEMO-000";
let turn = 0;

function out(obj) {
	process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function assistantText(text) {
	out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
}

function assistantTool(name, input) {
	out({
		type: "assistant",
		message: { role: "assistant", content: [{ type: "tool_use", id: `t-${turn}`, name, input }] },
	});
}

function result() {
	out({
		type: "result",
		subtype: "success",
		total_cost_usd: turn * 0.01,
		duration_ms: 1500,
		is_error: false,
	});
}

function telemetry(line) {
	const dir = path.join(process.cwd(), "src", "evidence", ticket);
	mkdirSync(dir, { recursive: true });
	appendFileSync(path.join(dir, "pipeline-status.ndjson"), `${JSON.stringify(line)}\n`);
}

out({ type: "system", subtype: "init", session_id: sessionId, model: "mock-claude" });

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return;
	}
	if (msg?.type !== "user") return;
	turn += 1;
	const text = JSON.stringify(msg.message?.content ?? "");
	const ticketMatch = /\b[A-Z][A-Z0-9]*-\d+\b/.exec(text);
	if (ticketMatch) ticket = ticketMatch[0];

	if (turn === 1) {
		telemetry({ step: 1, status: "started", ts: new Date().toISOString() });
		assistantText(`Demo run for **${ticket}** (mock claude — nothing real happens).`);
		assistantTool("mcp__atlassian__getJiraIssue", { issueIdOrKey: ticket });
		setTimeout(() => {
			telemetry({ step: 1, status: "blocked", ts: new Date().toISOString() });
			assistantText(
				`${ticket} already appears in COVERAGE.md, so this is where the real pipeline would stop and ask.\n\nContinue anyway?`,
			);
			result();
		}, 1200);
		return;
	}

	telemetry({ step: 1, status: "done", ts: new Date().toISOString() });
	assistantText(
		"Understood — wrapping the demo here. In a real run the remaining steps would proceed.",
	);
	for (let step = 2; step <= 7; step += 1) {
		telemetry({ step, status: "skipped", ts: new Date().toISOString() });
	}
	telemetry({ pipeline: "complete", ts: new Date().toISOString() });
	result();
});

// stdin closing is the dashboard's graceful shutdown signal.
rl.on("close", () => process.exit(0));
