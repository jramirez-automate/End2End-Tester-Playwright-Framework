import type { RunRecord } from "../../../shared/types";

/**
 * WAL replays deliver historical run snapshots; never let an OLDER one roll a
 * fresher record back to "running" (that resurrects a dead run). When either
 * `updatedAt` is unparseable we can't prove the incoming is stale, so we accept
 * it — a NaN comparison must not silently freeze a card on its last state.
 */
export function shouldReplaceRecord(existing: RunRecord | undefined, incoming: RunRecord): boolean {
	if (!existing) return true;
	const incomingT = Date.parse(incoming.updatedAt);
	const existingT = Date.parse(existing.updatedAt);
	if (Number.isNaN(incomingT) || Number.isNaN(existingT)) return true;
	return incomingT >= existingT;
}
