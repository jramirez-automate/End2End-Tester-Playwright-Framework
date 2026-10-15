import { Link } from "react-router-dom";
import type { RunRecord } from "../../../shared/types";
import { ExternalPipelineRow, useOutsidePipelines } from "../components/ExternalPipelines";
import { RunCard } from "../components/RunCard";
import { fetchExternalPipelines } from "../state/api";
import { selectActivePipelines, selectWrappedPipelines } from "../state/pipelines";
import { useRunsStore } from "../state/runsStore";
import { useLoad } from "../state/useLoad";

export function MonitorWall() {
	const runs = useRunsStore((s) => s.runs);
	const loaded = useRunsStore((s) => s.loaded);
	const loadError = useRunsStore((s) => s.loadError);
	const loadRuns = useRunsStore((s) => s.loadRuns);

	const onAir = selectActivePipelines(runs);
	const wrapped = selectWrappedPipelines(runs);
	const outside = useOutsidePipelines(useLoad(fetchExternalPipelines, "external").data);
	const empty = onAir.length === 0 && wrapped.length === 0 && outside.length === 0;

	return (
		<section className="h-full overflow-y-auto p-4">
			<div className="eyebrow mb-3 text-putty">Monitor wall</div>
			{loadError ? (
				<div className="alert alert-error mb-3 text-sm">
					<span>{loadError}</span>
					<button type="button" className="btn btn-sm" onClick={() => void loadRuns()}>
						Retry
					</button>
				</div>
			) : null}
			{!loaded ? (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
					<div className="skeleton h-64 bg-ink-2" />
					<div className="skeleton h-64 bg-ink-2" />
				</div>
			) : empty && !loadError ? (
				<div className="flex flex-col items-center gap-3 py-24 text-putty">
					<p>No runs on the wall.</p>
					<Link className="btn btn-primary" to="/new">
						Start one
					</Link>
				</div>
			) : (
				<div className="flex flex-col gap-5">
					<WallSection title="On Air" runs={onAir} />
					{outside.length > 0 ? (
						<div>
							<div className="eyebrow mb-2 flex items-center gap-2 text-putty">
								Outside the dashboard
								<span className="font-mono text-[10px] normal-case">{outside.length}</span>
							</div>
							<p className="mb-2 text-xs text-putty">
								Started in a terminal session. Status comes from the ticket's pipeline-status.ndjson; the chat and gates
								stay in that session.
							</p>
							<div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
								{outside.map((p) => (
									<div key={p.key} className="rounded-lg border border-line bg-ink-2 p-1">
										<ExternalPipelineRow pipeline={p} />
										{/* Padding on a wrapper — inside the clamped element it would reveal line 3. */}
										{p.title ? (
											<div className="px-2 pb-1.5">
												<p className="line-clamp-2 text-xs">{p.title}</p>
											</div>
										) : null}
									</div>
								))}
							</div>
						</div>
					) : null}
					<WallSection title="Wrapped" runs={wrapped} />
				</div>
			)}
		</section>
	);
}

/** One labelled band of the wall — hidden entirely when it has no pipelines. */
function WallSection({ title, runs }: { title: string; runs: RunRecord[] }) {
	if (runs.length === 0) return null;
	return (
		<div>
			<div className="eyebrow mb-2 flex items-center gap-2 text-putty">
				{title}
				<span className="font-mono text-[10px] normal-case">{runs.length}</span>
			</div>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
				{runs.map((run) => (
					<RunCard key={run.id} run={run} />
				))}
			</div>
		</div>
	);
}
