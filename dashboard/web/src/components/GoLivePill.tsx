import { useMatch, useNavigate } from "react-router-dom";
import { selectLiveTarget } from "../state/pipelines";
import { useRunsStore } from "../state/runsStore";

/**
 * Jump back to the pipeline that's currently on air. Shows only when there's a live run
 * to return to that you aren't already watching (selectLiveTarget). Reads "Go Live" from
 * anywhere off a run, "Return to air" while watching a wrapped run.
 */
export function GoLivePill() {
	const runs = useRunsStore((s) => s.runs);
	const currentId = useMatch("/runs/:id")?.params.id ?? null;
	const target = selectLiveTarget(runs, currentId);
	const navigate = useNavigate();

	if (target === null) return null;

	const label = currentId ? "Return to air" : "Go live";
	return (
		<button
			type="button"
			onClick={() => navigate(`/runs/${target}`)}
			title="Jump to the pipeline that's on air"
			className="flex items-center gap-2 rounded-field border border-tally/40 px-2 py-1 whitespace-nowrap text-tally transition-colors hover:bg-tally/10"
		>
			<span className="lamp lamp--tally" aria-hidden />
			<span className="eyebrow">{label}</span>
		</button>
	);
}
