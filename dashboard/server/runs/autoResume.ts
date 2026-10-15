/**
 * Auto-resume budget accounting — kept pure so the crash-loop guard is testable.
 *
 * The budget caps how many times a crashed claude session is auto-respawned
 * WITHOUT making pipeline progress. A completed turn refreshes the budget only
 * when the run has advanced to a NEW high-water pipeline step; otherwise a
 * session that emits one result then crashes every cycle would reset the
 * counter forever and respawn infinitely.
 */

export type AfterCrash = { attempt: number; giveUp: false } | { attempt: undefined; giveUp: true };

/** Budget after a crashed (non-zero) exit: bump the attempt, or give up at the cap. */
export function afterCrash(attempt: number | undefined, max: number): AfterCrash {
	const used = attempt ?? 0;
	if (used < max) return { attempt: used + 1, giveUp: false };
	return { attempt: undefined, giveUp: true };
}

/** A completed turn refreshes the budget only when the pipeline reached a new step. */
export function isForwardProgress(currentStep: number, maxStepSeen: number): boolean {
	return currentStep > maxStepSeen;
}
