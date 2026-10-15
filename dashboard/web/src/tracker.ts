import type { EvidenceEnv, TicketSummary } from "../../shared/types";

export type TicketFilter = "all" | "failing" | "blocked" | "final-pass";

/** `final` is the last env in promotion order — where a ticket is finally verified. */
export function ticketFilters(
	final: EvidenceEnv | undefined,
): Array<{ id: TicketFilter; label: string }> {
	return [
		{ id: "all", label: "All" },
		{ id: "failing", label: "Failing" },
		{ id: "blocked", label: "Pipeline blocked" },
		...(final ? [{ id: "final-pass" as const, label: `Passed on ${final}` }] : []),
	];
}

function matchesFilter(
	t: TicketSummary,
	filter: TicketFilter,
	final: EvidenceEnv | undefined,
): boolean {
	switch (filter) {
		case "all":
			return true;
		case "failing":
			return Object.values(t.envs).some((tally) => tally?.verdict === "fail");
		case "blocked":
			return t.pipeline?.status === "blocked" && !t.pipeline.complete;
		case "final-pass":
			return final !== undefined && t.envs[final]?.verdict === "pass";
	}
}

/** Case-insensitive match on key and title; whitespace-separated terms must all match. */
export function filterTickets(
	tickets: TicketSummary[],
	query: string,
	filter: TicketFilter,
	final?: EvidenceEnv,
): TicketSummary[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	return tickets.filter((t) => {
		if (!matchesFilter(t, filter, final)) return false;
		const haystack = `${t.key} ${t.title ?? ""}`.toLowerCase();
		return terms.every((term) => haystack.includes(term));
	});
}
