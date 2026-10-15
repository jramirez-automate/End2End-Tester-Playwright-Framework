import type { RunRecord } from "../../shared/types.js";

/** The run fields that shape a claude child's command line. */
export type SessionArgsSource = Pick<RunRecord, "sessionId" | "model" | "effort">;

/**
 * Args for the pipeline session child (fresh spawn or resume).
 * Model/effort come from the persisted run record so a resume always
 * re-applies the exact settings the run was created with.
 */
export function buildSessionArgs(run: SessionArgsSource, resume: boolean): string[] {
	const args = [
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--include-partial-messages",
		"--verbose",
		"--permission-mode",
		"bypassPermissions",
		// claude >= 2.1 no longer honors `bypassPermissions` on its own — the mode
		// must be explicitly enabled or the CLI exits 1 with no output at startup.
		"--allow-dangerously-skip-permissions",
	];
	if (resume && run.sessionId) args.push("--resume", run.sessionId);
	args.push(...modelEffortArgs(run));
	return args;
}

function modelEffortArgs(run: SessionArgsSource): string[] {
	const args: string[] = [];
	if (run.model) args.push("--model", run.model);
	if (run.effort) args.push("--effort", run.effort);
	return args;
}
