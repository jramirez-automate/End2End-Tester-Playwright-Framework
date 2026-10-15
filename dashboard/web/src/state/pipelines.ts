/**
 * Pure selectors over the runs map for the pipeline switcher (Rundown), the
 * Go-Live / Return-to-air pill, and the Monitor Wall's On Air / Wrapped split.
 *
 * A "pipeline" is one RunRecord. These functions are DOM-free so they can be
 * unit-tested under the repo's node-env Vitest convention; components stay thin
 * shells that call them.
 */
import { ACTIVE_STATES } from "../../../shared/types";
import type { RunRecord, RunState } from "../../../shared/types";

function isActive(run: RunRecord): boolean {
	return ACTIVE_STATES.includes(run.state);
}

/** When a pipeline wrapped — endedAt, else last update, else creation. NaN → 0 so a
 *  bad timestamp sinks to the bottom of a newest-first sort instead of throwing. */
function endedTime(run: RunRecord): number {
	const t = Date.parse(run.endedAt ?? run.updatedAt ?? run.createdAt);
	return Number.isNaN(t) ? 0 : t;
}

/** Active pipelines, createdAt ascending (the order TabStrip already tabbed). */
export function selectActivePipelines(runs: Record<string, RunRecord>): RunRecord[] {
	return Object.values(runs)
		.filter(isActive)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Terminal pipelines (completed|failed|aborted|interrupted), newest-ended first. */
export function selectWrappedPipelines(runs: Record<string, RunRecord>): RunRecord[] {
	return Object.values(runs)
		.filter((r) => !isActive(r))
		.sort((a, b) => endedTime(b) - endedTime(a));
}

export interface WrappedGroup {
	ticket: string;
	/** This ticket's terminal runs, newest-ended first. */
	runs: RunRecord[];
	/** === runs[0] — the most recent wrapped run for the ticket. */
	latest: RunRecord;
}

/** Terminal runs grouped by ticket. Runs within a group are newest-ended first; groups
 *  are ordered by their latest run's end time, descending — a ticket that ran several
 *  times reads as one pipeline's history. */
export function selectWrappedByTicket(runs: Record<string, RunRecord>): WrappedGroup[] {
	const byTicket = new Map<string, RunRecord[]>();
	for (const run of selectWrappedPipelines(runs)) {
		const bucket = byTicket.get(run.ticket);
		if (bucket) bucket.push(run);
		else byTicket.set(run.ticket, [run]);
	}
	// Map insertion order already follows newest-ended-first (selectWrappedPipelines is
	// sorted), so the first-seen run per ticket is its latest and groups come out ordered.
	return [...byTicket.values()].map((groupRuns) => ({
		ticket: groupRuns[0]!.ticket,
		runs: groupRuns,
		latest: groupRuns[0]!,
	}));
}

/** How "live" each active state reads — higher wins when several runs are on air. */
const LIVENESS: Record<RunState, number> = {
	running: 5,
	waiting_gate: 4,
	starting: 3,
	provisioning: 2,
	queued: 1,
	completed: 0,
	failed: 0,
	aborted: 0,
	interrupted: 0,
};

/** The run id the Go-Live / Return-to-air control jumps to, or null when there's nothing
 *  to return to — no active runs, or the current view is already a live run. Among several
 *  active runs, ranks by liveness then updatedAt desc, createdAt desc, id asc. */
export function selectLiveTarget(
	runs: Record<string, RunRecord>,
	currentId: string | null,
): string | null {
	const current = currentId ? runs[currentId] : undefined;
	if (current && isActive(current)) return null;
	const active = Object.values(runs)
		.filter(isActive)
		.sort(
			(a, b) =>
				LIVENESS[b.state] - LIVENESS[a.state] ||
				b.updatedAt.localeCompare(a.updatedAt) ||
				b.createdAt.localeCompare(a.createdAt) ||
				a.id.localeCompare(b.id),
		);
	return active[0]?.id ?? null;
}
