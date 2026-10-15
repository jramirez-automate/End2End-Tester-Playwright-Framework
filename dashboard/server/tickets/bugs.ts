import type { BugSummary, EnvVerdict, TicketCase, TicketSummary } from "../../shared/types.js";
import type { BugRecord } from "./parse.js";

/** A bug bundle's own results: any failing env → fail, else any pass → pass. */
export function retestVerdict(bug: TicketSummary | undefined): EnvVerdict | undefined {
	if (!bug) return undefined;
	const tallies = Object.values(bug.envs);
	if (tallies.some((t) => t?.verdict === "fail")) return "fail";
	if (tallies.some((t) => t && t.pass > 0)) return "pass";
	return undefined;
}

/**
 * Bugs = folders holding a `bug.json` from `publish.mjs bug`. Its media are the
 * failure proof copied into the bug's own folder; the parent case names what broke.
 */
export function deriveBugs(
	records: Map<string, BugRecord>,
	summaries: Map<string, TicketSummary>,
	casesByTicket: Map<string, TicketCase[]>,
): BugSummary[] {
	const bugs: BugSummary[] = [];
	for (const [key, record] of records) {
		if (record.raisedFrom === key) continue;
		const own = summaries.get(key);
		const parentCase = record.tc
			? casesByTicket.get(record.raisedFrom)?.find((c) => c.tc === record.tc)
			: undefined;
		const retest = retestVerdict(own);
		const title = parentCase?.case ?? own?.title;
		bugs.push({
			key,
			...(title ? { title } : {}),
			raisedFrom: [{ ticket: record.raisedFrom, ...(record.tc ? { tc: record.tc } : {}) }],
			...(parentCase?.expectedResult
				? { description: `Expected: ${parentCase.expectedResult}` }
				: {}),
			replicate: parentCase?.steps ?? [],
			media: record.media.map((name) => ({ ticket: key, name })),
			hasFolder: true,
			...(retest ? { retest } : {}),
			...(own ? { updatedAt: own.updatedAt } : {}),
		});
	}
	return bugs.sort(
		(a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.key.localeCompare(a.key),
	);
}
