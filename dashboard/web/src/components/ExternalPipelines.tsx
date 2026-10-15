import { Link } from "react-router-dom";
import type { ExternalPipeline } from "../../../shared/types";
import { formatAgo } from "../format";
import { ACTIVE_STATES } from "../../../shared/types";
import { useRunsStore } from "../state/runsStore";
import { StepChip } from "./Verdict";

/**
 * Pipelines running outside the dashboard (a terminal /e2e-ticket session),
 * minus any ticket the dashboard is already running. Read from the ticket's
 * pipeline-status.ndjson only — there's no session here to open.
 */
export function useOutsidePipelines(external: ExternalPipeline[] | null): ExternalPipeline[] {
	const runs = useRunsStore((s) => s.runs);
	const live = new Set(
		Object.values(runs)
			.filter((r) => ACTIVE_STATES.includes(r.state))
			.map((r) => r.ticket),
	);
	return (external ?? []).filter((e) => !live.has(e.key));
}

export function ExternalPipelineRow({ pipeline, onGo }: { pipeline: ExternalPipeline; onGo?: () => void }) {
	const p = pipeline.progress;
	return (
		<Link
			to={`/tickets/${pipeline.key}`}
			onClick={onGo}
			className="flex w-full flex-col gap-0.5 rounded-field px-2 py-1.5 text-left transition-colors hover:bg-ink-2"
			title={pipeline.title}
		>
			<span className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-bone">{pipeline.key}</span>
				<StepChip step={p.step} status={p.status} />
			</span>
			{p.updatedAt ? <span className="font-mono text-[10px] text-putty">updated {formatAgo(p.updatedAt)}</span> : null}
		</Link>
	);
}
