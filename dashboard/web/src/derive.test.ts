import { beforeEach, describe, expect, it } from "vitest";
import type { RunEvent } from "../../shared/types";
import { deriveActivity } from "./derive";

let seq = 0;
beforeEach(() => {
	seq = 0;
});

const claude = (payload: unknown): RunEvent => ({
	seq: ++seq,
	ts: "2026-01-01T00:00:00.000Z",
	kind: "claude",
	payload,
});
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): RunEvent =>
	claude({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id: string): RunEvent =>
	claude({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id }] } });
const result = (): RunEvent => claude({ type: "result" });
const taskProgress = (id: string, description: string, usage?: Record<string, number>): RunEvent =>
	claude({ type: "system", subtype: "task_progress", tool_use_id: id, description, usage });
const taskNotification = (id: string): RunEvent =>
	claude({ type: "system", subtype: "task_notification", tool_use_id: id });

describe("deriveActivity", () => {
	it("surfaces an in-flight subagent as an agent activity", () => {
		const acts = deriveActivity([
			toolUse("a1", "Task", { subagent_type: "e2e-explorer", description: "explore" }),
		]);
		expect(acts).toHaveLength(1);
		expect(acts[0]?.kind).toBe("agent");
		expect(acts[0]?.label).toBe("e2e-explorer");
	});

	it("keeps a background subagent visible after the orchestrator's turn ends", () => {
		// The reported "stuck" state: the orchestrator ends its turn (result) while
		// a background agent is still running — the agent must NOT disappear.
		const acts = deriveActivity([
			toolUse("bg", "Task", { subagent_type: "e2e-explorer" }),
			result(),
		]);
		expect(acts.map((a) => a.label)).toContain("e2e-explorer");
	});

	it("clears synchronous commands on turn end but keeps agents", () => {
		const acts = deriveActivity([
			toolUse("cmd", "Bash", { command: "npm test" }),
			toolUse("ag", "Task", { subagent_type: "e2e-runner" }),
			result(),
		]);
		expect(acts.some((a) => a.kind === "command")).toBe(false);
		expect(acts.some((a) => a.kind === "agent")).toBe(true);
	});

	it("removes a subagent when its task_notification arrives", () => {
		const acts = deriveActivity([
			toolUse("ag", "Task", { subagent_type: "e2e-explorer" }),
			taskProgress("ag", "Reading source"),
			taskNotification("ag"),
		]);
		expect(acts).toHaveLength(0);
	});

	it("carries the agent's live token count from task_progress", () => {
		const acts = deriveActivity([
			toolUse("ag", "Task", { subagent_type: "e2e-explorer" }),
			taskProgress("ag", "Reading pages/index.ts", { total_tokens: 4200, tool_uses: 5 }),
		]);
		expect(acts[0]?.detail).toBe("Reading pages/index.ts");
		expect(acts[0]?.tokens).toBe(4200);
	});

	it("still closes a foreground agent on its tool_result", () => {
		const acts = deriveActivity([toolUse("ag", "Task", { subagent_type: "x" }), toolResult("ag")]);
		expect(acts).toHaveLength(0);
	});
});
