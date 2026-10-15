import { isHumanOnlyStep } from "../../shared/pipeline";
import type { GateInfo } from "../../shared/types";

/**
 * "Safe" auto-approve: when a run has auto-mode on, advance the pipeline's flow
 * gates (continue, start authoring) automatically, but never the publishing gate
 * or the regression gate that asks to run on another environment — those always
 * need a human OK.
 */
export function shouldAutoApprove(gate: GateInfo, auto: boolean): boolean {
	return auto && !isHumanOnlyStep(gate.step);
}

/** The reply auto-mode sends: the first (affirmative) quick reply, if any. */
export function autoReply(gate: GateInfo): string | null {
	return gate.quickReplies[0] ?? null;
}
