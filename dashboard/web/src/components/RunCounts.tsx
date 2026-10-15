import type { HistoryCounts, HistoryRunSummary } from "../../../shared/types";
import { StatusChip } from "./Verdict";

/** "ABC-21091" for ticket runs, else the CLI args, else "full suite". */
export function runScope(run: Pick<HistoryRunSummary, "ticket" | "args">): string {
	if (run.ticket) return run.ticket;
	const args = run.args.filter((a) => a !== "--reporter" && !a.startsWith("--reporter="));
	return args.length > 0 ? args.join(" ") : "full suite";
}

export function CountsReadout({ counts }: { counts: HistoryCounts }) {
	return (
		<span className="inline-flex flex-wrap gap-3">
			<StatusChip tone="ok" label={String(counts.passed)} detail="passed" />
			{counts.failed > 0 ? <StatusChip tone="fault" label={String(counts.failed)} detail="failed" /> : null}
			{counts.flaky > 0 ? <StatusChip tone="standby" label={String(counts.flaky)} detail="flaky" /> : null}
			{counts.skipped > 0 ? <StatusChip tone="idle" label={String(counts.skipped)} detail="skipped" /> : null}
		</span>
	);
}
