import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { FeatureCoverage, SpecCoverage } from "../../../shared/types";
import { LoadState } from "../components/LoadState";
import { Panel } from "../components/Panel";
import { CountsReadout } from "../components/RunCounts";
import { EmptyHistory, SuiteHealth } from "../components/SuiteHealth";
import { formatAgo } from "../format";
import { fetchCoverage, fetchHistory } from "../state/api";
import { useLoad } from "../state/useLoad";

function isSeedOnly(f: FeatureCoverage): boolean {
	return f.specs.every((s) => s.seed);
}

function LastRun({ last }: { last: SpecCoverage["last"] }) {
	if (!last) return <span className="font-mono text-xs text-putty">never recorded</span>;
	return (
		<Link className="flex flex-wrap items-center gap-2 hover:underline" to={`/results/${last.runId}`} title={last.at}>
			<CountsReadout counts={last.counts} />
			<span className="font-mono text-xs text-putty">
				{last.env} · {formatAgo(last.at)}
			</span>
		</Link>
	);
}

function TicketLinks({ tickets }: { tickets: string[] }) {
	if (tickets.length === 0) return <span className="font-mono text-xs text-putty">—</span>;
	return (
		<span className="flex flex-wrap gap-x-2 gap-y-0.5">
			{tickets.map((t) => (
				<Link key={t} className="link font-mono text-xs text-feed" to={`/tickets/${t}`}>
					{t}
				</Link>
			))}
		</span>
	);
}

/**
 * Coverage map: the suite by feature folder (src/tests/<app>/<feature>/) — specs,
 * tests, linked tickets and the latest recorded run — then Suite health from
 * run history. Answers "is X tested, and is it still green?".
 */
export function CoverageView() {
	const coverage = useLoad(fetchCoverage, "coverage");
	const history = useLoad(fetchHistory, "history");
	const [showSeeds, setShowSeeds] = useState(false);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<string | null>(null);
	const { hash } = useLocation();

	// /results and run pages link to #health — jump there once it has content.
	useEffect(() => {
		if (hash === "#health" && history.data) document.getElementById("health")?.scrollIntoView();
	}, [hash, history.data]);

	const features = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (coverage.data?.features ?? []).filter((f) => {
			if (!showSeeds && isSeedOnly(f)) return false;
			if (!q) return true;
			return `${f.app}/${f.feature} ${f.tickets.join(" ")} ${f.specs.map((s) => s.file).join(" ")}`.toLowerCase().includes(q);
		});
	}, [coverage.data, showSeeds, query]);

	const totals = useMemo(() => {
		const specs = features.flatMap((f) => f.specs);
		return {
			features: features.length,
			specs: specs.length,
			tests: specs.reduce((n, s) => n + s.tests, 0),
			tickets: new Set(specs.flatMap((s) => s.tickets)).size,
			neverRun: specs.filter((s) => !s.last).length,
		};
	}, [features]);

	return (
		<section className="h-full overflow-y-auto p-4">
			<div className="mx-auto flex max-w-7xl flex-col gap-4">
				<div className="flex flex-wrap items-center gap-3">
					<div className="eyebrow text-putty">Coverage map</div>
					<input
						type="search"
						className="input input-sm ml-auto w-64 border-line bg-ink-1"
						placeholder="Feature, spec or ticket"
						aria-label="Filter features"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					<label className="flex cursor-pointer items-center gap-2 text-sm">
						<input type="checkbox" className="checkbox checkbox-sm" checked={showSeeds} onChange={(e) => setShowSeeds(e.target.checked)} />
						Include seed fixtures
					</label>
					<button
						type="button"
						className="btn btn-sm"
						onClick={() => {
							coverage.reload();
							history.reload();
						}}
					>
						Refresh
					</button>
				</div>

				<LoadState loading={coverage.loading && !coverage.data} error={coverage.error} onRetry={coverage.reload} />

				{coverage.data ? (
					<>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
							{(
								[
									["Features", totals.features],
									["Spec files", totals.specs],
									["Tests", totals.tests],
									["Tickets tagged", totals.tickets],
									["Specs never recorded", totals.neverRun],
								] as const
							).map(([label, value]) => (
								<div key={label} className="rounded-lg border border-line bg-ink-2 p-3">
									<div className="font-mono text-2xl text-bone">{value}</div>
									<div className="eyebrow text-putty">{label}</div>
								</div>
							))}
						</div>

						<Panel title="Features">
							<div className="overflow-x-auto">
								<table className="table table-sm [&_td]:align-top">
									<thead>
										<tr className="eyebrow border-line text-putty">
											<th>Feature</th>
											<th>Specs</th>
											<th>Tests</th>
											<th>Tickets</th>
											<th>Latest run</th>
										</tr>
									</thead>
									<tbody>
										{features.map((f) => {
											const id = `${f.app}/${f.feature}`;
											const expanded = open === id;
											return (
												<FeatureRows key={id} feature={f} expanded={expanded} onToggle={() => setOpen(expanded ? null : id)} />
											);
										})}
									</tbody>
								</table>
								{features.length === 0 ? <p className="p-4 text-sm text-putty">No features match.</p> : null}
							</div>
						</Panel>
					</>
				) : null}

				{/* Its own band (not a panel) — SuiteHealth renders panels of its own. */}
				<div id="health" className="flex flex-col gap-4 pt-2">
					<div className="eyebrow text-putty">Suite health</div>
					<LoadState loading={history.loading && !history.data} error={history.error} onRetry={history.reload} />
					{history.data && history.data.runs.length === 0 ? <EmptyHistory dir={history.data.dir} /> : null}
					{history.data && history.data.runs.length > 0 ? <SuiteHealth data={history.data} /> : null}
				</div>
			</div>
		</section>
	);
}

function FeatureRows({ feature, expanded, onToggle }: { feature: FeatureCoverage; expanded: boolean; onToggle: () => void }) {
	return (
		<>
			<tr className="border-line hover:bg-ink-2">
				<td>
					<button type="button" className="flex items-center gap-2 text-left" aria-expanded={expanded} onClick={onToggle}>
						<span aria-hidden className="font-mono text-xs text-putty">
							{expanded ? "▾" : "▸"}
						</span>
						<span className="font-mono text-xs text-putty">{feature.app}/</span>
						<span className="font-medium">{feature.feature}</span>
					</button>
				</td>
				<td className="font-mono text-xs">{feature.specs.length}</td>
				<td className="font-mono text-xs">{feature.tests}</td>
				<td className="max-w-sm">
					<TicketLinks tickets={feature.tickets} />
				</td>
				<td>
					<LastRun last={feature.last} />
				</td>
			</tr>
			{expanded
				? feature.specs.map((s) => (
						<tr key={s.file} className="border-line bg-ink-2">
							<td className="pl-8">
								<div className="font-mono text-xs break-all">{s.file.replace(/^src\/tests\//, "")}</div>
								<div className="mt-0.5 flex gap-2">
									{s.kind === "api" ? <span className="eyebrow text-putty">api</span> : null}
									{s.smoke ? <span className="eyebrow text-putty">smoke</span> : null}
									{s.seed ? <span className="eyebrow text-putty">seed</span> : null}
								</div>
							</td>
							<td />
							<td className="font-mono text-xs">{s.tests}</td>
							<td className="max-w-sm">
								<TicketLinks tickets={s.tickets} />
							</td>
							<td>
								<LastRun last={s.last} />
							</td>
						</tr>
					))
				: null}
		</>
	);
}
