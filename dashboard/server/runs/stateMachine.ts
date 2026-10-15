import type { RunState } from "../../shared/types.js";

/**
 * Lifecycle: queued -> provisioning (fresh worktree) | starting (reused checkout)
 * -> running <-> waiting_gate -> completed | failed | aborted; any active state
 * -> interrupted (server restart / child death); interrupted | failed -> starting (resume).
 */
const TRANSITIONS: Record<RunState, readonly RunState[]> = {
	queued: ["provisioning", "starting", "aborted", "interrupted"],
	provisioning: ["starting", "failed", "aborted", "interrupted"],
	starting: ["running", "failed", "aborted", "interrupted"],
	running: ["waiting_gate", "completed", "failed", "aborted", "interrupted"],
	waiting_gate: ["running", "completed", "failed", "aborted", "interrupted"],
	completed: [],
	failed: ["starting"],
	aborted: [],
	interrupted: ["starting"],
};

export function assertTransition(from: RunState, to: RunState): void {
	if (!TRANSITIONS[from].includes(to)) {
		throw new Error(`Illegal run state transition: ${from} -> ${to}`);
	}
}
