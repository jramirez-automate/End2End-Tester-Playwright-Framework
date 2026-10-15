import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { countOutcomes } from "../../../shared/history";
import type { HistoryOutcome, HistoryRun } from "../../../shared/types";
import { CountsReadout, runScope } from "../components/RunCounts";
import { EvidenceMedia } from "../components/EvidenceMedia";
import { LoadState } from "../components/LoadState";
import { OutcomeChip } from "../components/Verdict";
import { formatDuration } from "../format";
import { fetchHistoryRun, historyFileUrl } from "../state/api";
import { useLoad } from "../state/useLoad";

type OutcomeFilter = "all" | HistoryOutcome;

const FILTERS: OutcomeFilter[] = ["all", "failed", "flaky", "passed", "skipped"];

/** Failed first, then flaky, then the rest — the run page is read for what broke. */
const OUTCOME_ORDER: Record<HistoryOutcome, number> = { failed: 0, flaky: 1, passed: 2, skipped: 3 };

export function HistoryRunView() {
	const { id = "" } = useParams();
	const { data, error, loading, reload } = useLoad(() => fetchHistoryRun(id), id);

	return (
		<div className="h-full overflow-y-auto p-4">
			<div className="mx-auto flex max-w-7xl flex-col gap-4">
				<Link className="link w-fit text-sm text-putty" to="/coverage#health">
					← Suite health
				</Link>
				<LoadState loading={loading && !data} error={error} onRetry={reload} />
				{data ? <RunBody run={data} /> : null}
			</div>
		</div>
	);
}

function RunBody({ run }: { run: HistoryRun }) {
	const [filter, setFilter] = useState<OutcomeFilter>("all");
	const counts = useMemo(() => countOutcomes(run.tests), [run]);
	const tests = useMemo(
		() =>
			run.tests
				.filter((t) => filter === "all" || t.outcome === filter)
				.sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || a.key.localeCompare(b.key)),
		[run, filter],
	);

	return (
		<>
			<header className="flex flex-col gap-2">
				<div className="flex flex-wrap items-baseline gap-3">
					<h1 className="font-mono text-lg text-bone">{run.env}</h1>
					<span className="font-mono text-sm">{run.startedAt.replace("T", " ").slice(0, 19)}</span>
					<span className="font-mono text-xs text-putty">{formatDuration(run.durationMs)}</span>
					<span className="font-mono text-xs text-putty">playwright: {run.status}</span>
				</div>
				<div className="font-mono text-xs break-all text-putty">
					{run.ticket ? (
						<Link className="link text-feed" to={`/tickets/${run.ticket}`}>
							{run.ticket}
						</Link>
					) : (
						runScope(run)
					)}
					{run.evidence ? " · evidence capture" : ""}
					{run.ci ? " · ci" : ""}
				</div>
				<CountsReadout counts={counts} />
			</header>

			<div className="join" role="group" aria-label="Filter tests by outcome">
				{FILTERS.map((f) => (
					<button
						key={f}
						type="button"
						className={`btn join-item btn-sm ${filter === f ? "btn-active" : ""}`}
						aria-pressed={filter === f}
						onClick={() => setFilter(f)}
					>
						{f === "all" ? `All ${counts.total}` : `${f[0]!.toUpperCase()}${f.slice(1)} ${counts[f]}`}
					</button>
				))}
			</div>

			<section className="overflow-x-auto rounded-lg border border-line bg-ink-1">
				<table className="table table-sm [&_td]:align-top">
					<thead>
						<tr className="eyebrow border-line text-putty">
							<th>Outcome</th>
							<th>Test</th>
							<th>Attempts</th>
							<th>Duration</th>
						</tr>
					</thead>
					<tbody>
						{tests.map((t) => (
							<tr key={t.key} className="border-line">
								<td>
									<OutcomeChip outcome={t.outcome} />
								</td>
								<td className="text-sm">
									<div>{t.title}</div>
									<div className="font-mono text-xs break-all text-putty">{t.key}</div>
									{t.tags.length > 0 ? <div className="font-mono text-xs text-putty">{t.tags.join(" ")}</div> : null}
									{t.error ? (
										<pre className="mt-2 max-h-48 overflow-auto rounded border border-line bg-ink-0 p-2 font-mono text-xs whitespace-pre-wrap">
											{t.error}
										</pre>
									) : null}
									{t.screenshot ? (
										<div className="mt-2">
											<EvidenceMedia names={[t.screenshot]} url={(name) => historyFileUrl(run.id, name)} size="lg" />
										</div>
									) : null}
								</td>
								<td className="font-mono text-xs">{t.attempts}</td>
								<td className="font-mono text-xs whitespace-nowrap text-putty">{formatDuration(t.durationMs)}</td>
							</tr>
						))}
					</tbody>
				</table>
				{tests.length === 0 ? <p className="p-4 text-sm text-putty">No {filter} tests in this run.</p> : null}
			</section>
		</>
	);
}
