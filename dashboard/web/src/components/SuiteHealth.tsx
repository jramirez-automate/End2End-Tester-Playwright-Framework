import { Link } from "react-router-dom";
import type { HistoryOverview, HistoryRunSummary, HistoryTestStat } from "../../../shared/types";
import { CountsReadout, runScope } from "./RunCounts";
import { EvidenceMedia } from "./EvidenceMedia";
import { OutcomeChip } from "./Verdict";
import { formatAgo, formatDuration, formatPercent } from "../format";
import { historyFileUrl } from "../state/api";
import { Panel } from "./Panel";

/** Runs per env shown as the LED strip on each env card. */
const STRIP_RUNS = 12;

export function EmptyHistory({ dir }: { dir: string }) {
	return (
		<div className="flex flex-col items-center gap-2 py-8 text-center text-putty">
			<p>No run history yet.</p>
			<p className="max-w-xl text-sm">
				Every Playwright run now writes a summary to <span className="font-mono">{dir}</span>. Run any spec — for
				example <span className="font-mono">npm run test:dev -- &lt;spec&gt;</span> — and it shows up here.
			</p>
		</div>
	);
}

/**
 * Suite health: per-env pass rate + recent-runs strip, the run list, flaky and
 * slowest tests, and recent failures — all from run-history (history-reporter.ts).
 */
export function SuiteHealth({ data }: { data: HistoryOverview }) {
	return (
		<>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
				{data.envs.map((e) => (
					<EnvCard key={e.env} env={e} runs={data.runs.filter((r) => r.env === e.env).slice(0, STRIP_RUNS)} />
				))}
			</div>

			<Panel title={`Runs · ${data.runs.length}`}>
				<div className="overflow-x-auto">
					<table className="table table-sm">
						<thead>
							<tr className="eyebrow border-line text-putty">
								<th>Started</th>
								<th>Env</th>
								<th>Scope</th>
								<th>Result</th>
								<th>Duration</th>
							</tr>
						</thead>
						<tbody>
							{data.runs.map((r) => (
								<tr key={r.id} className="border-line hover:bg-ink-2">
									<td className="font-mono text-xs whitespace-nowrap" title={r.startedAt}>
										<Link className="link text-bone" to={`/results/${r.id}`}>
											{formatAgo(r.startedAt)}
										</Link>
									</td>
									<td className="font-mono text-xs">{r.env}</td>
									<td className="max-w-md font-mono text-xs break-all">
										{r.ticket ? (
											<Link className="link text-feed" to={`/tickets/${r.ticket}`}>
												{r.ticket}
											</Link>
										) : (
											runScope(r)
										)}
										{r.evidence ? <span className="eyebrow ml-2 text-putty">evidence</span> : null}
										{r.ci ? <span className="eyebrow ml-2 text-putty">ci</span> : null}
									</td>
									<td>
										<CountsReadout counts={r.counts} />
									</td>
									<td className="font-mono text-xs text-putty">{formatDuration(r.durationMs)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Panel>

			<div className="grid gap-4 lg:grid-cols-2">
				<Panel title={`Flaky tests · last 30 runs`}>
					{data.flaky.length === 0 ? (
						<p className="text-sm text-putty">Nothing flaky — no test both passed and failed, or needed a retry.</p>
					) : (
						<StatTable stats={data.flaky} columns="flaky" />
					)}
				</Panel>
				<Panel title="Slowest tests · average">
					<StatTable stats={data.slowest} columns="slow" />
				</Panel>
			</div>

			<Panel title={`Recent failures · ${data.recentFailures.length}`}>
				{data.recentFailures.length === 0 ? (
					<p className="text-sm text-putty">No failures in the recorded runs.</p>
				) : (
					<ul className="flex flex-col gap-4">
						{data.recentFailures.map((f) => (
							<li key={`${f.runId}-${f.test.key}`} className="flex flex-col gap-2 border-b border-line pb-4 last:border-0">
								<div className="flex flex-wrap items-center gap-3 text-sm">
									<OutcomeChip outcome={f.test.outcome} />
									<span className="font-medium">{f.test.title}</span>
									<span className="font-mono text-xs text-putty">{f.test.file}</span>
									<Link className="link ml-auto font-mono text-xs text-putty" to={`/results/${f.runId}`} title={f.runAt}>
										{f.env} · {formatAgo(f.runAt)}
									</Link>
								</div>
								{f.test.error ? (
									<pre className="max-h-32 overflow-auto rounded border border-line bg-ink-0 p-2 font-mono text-xs whitespace-pre-wrap">
										{f.test.error.split("\n").slice(0, 8).join("\n")}
									</pre>
								) : null}
								{f.test.screenshot ? (
									<EvidenceMedia names={[f.test.screenshot]} url={(name) => historyFileUrl(f.runId, name)} />
								) : null}
							</li>
						))}
					</ul>
				)}
			</Panel>
		</>
	);
}

function stripTone(r: HistoryRunSummary): string {
	if (r.counts.failed > 0) return "bg-fault";
	if (r.counts.flaky > 0) return "bg-standby";
	if (r.counts.passed > 0) return "bg-ok";
	return "bg-line";
}

function EnvCard({ env, runs }: { env: HistoryOverview["envs"][number]; runs: HistoryRunSummary[] }) {
	// Strip reads oldest → newest, left to right.
	const strip = [...runs].reverse();
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-line bg-ink-2 p-4">
			<div className="flex items-baseline gap-2">
				<span className="font-mono text-sm text-bone">{env.env}</span>
				<span className="font-mono text-xs text-putty" title={env.lastRun.startedAt}>
					last run {formatAgo(env.lastRun.startedAt)}
				</span>
			</div>
			<div className="flex items-baseline gap-2">
				<span className="font-mono text-2xl text-bone">{formatPercent(env.passRate)}</span>
				<span className="text-xs text-putty">pass rate over the last {env.recentRuns === 1 ? "run" : `${env.recentRuns} runs`}</span>
			</div>
			<div className="meter" role="img" aria-label={`Last ${strip.length} runs, oldest first`}>
				{strip.map((r) => (
					<Link
						key={r.id}
						to={`/results/${r.id}`}
						className={`meter__seg ${stripTone(r)}`}
						title={`${r.startedAt} — ${r.counts.passed} passed, ${r.counts.failed} failed, ${r.counts.flaky} flaky`}
						aria-label={`Run ${r.startedAt}: ${r.counts.failed} failed`}
					/>
				))}
			</div>
			<CountsReadout counts={env.lastRun.counts} />
		</div>
	);
}

function StatTable({ stats, columns }: { stats: HistoryTestStat[]; columns: "flaky" | "slow" }) {
	return (
		<div className="overflow-x-auto">
			<table className="table table-sm [&_td]:align-top">
				<thead>
					<tr className="eyebrow border-line text-putty">
						<th>Test</th>
						{columns === "flaky" ? (
							<>
								<th>Failed</th>
								<th>Flaky</th>
							</>
						) : (
							<>
								<th>Avg</th>
								<th>Max</th>
							</>
						)}
						<th>Runs</th>
						<th>Last</th>
					</tr>
				</thead>
				<tbody>
					{stats.map((s) => (
						<tr key={s.key} className="border-line">
							<td className="text-sm">
								<div>{s.title}</div>
								<div className="font-mono text-xs break-all text-putty">{s.file}</div>
							</td>
							{columns === "flaky" ? (
								<>
									<td className="font-mono text-xs">{s.failed}</td>
									<td className="font-mono text-xs">{s.flaky}</td>
								</>
							) : (
								<>
									<td className="font-mono text-xs whitespace-nowrap">{formatDuration(s.avgDurationMs)}</td>
									<td className="font-mono text-xs whitespace-nowrap text-putty">{formatDuration(s.maxDurationMs)}</td>
								</>
							)}
							<td className="font-mono text-xs text-putty">{s.runs}</td>
							<td>
								<OutcomeChip outcome={s.lastOutcome} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
