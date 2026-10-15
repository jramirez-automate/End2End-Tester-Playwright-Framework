import { NavLink } from "react-router-dom";
import { selectActivePipelines } from "../state/pipelines";
import { useRunsStore } from "../state/runsStore";
import { StateDot, stateLabel, stateTone } from "./StateEyebrow";

const tabClass = ({ isActive }: { isActive: boolean }): string =>
	`flex h-12 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors ${
		isActive ? "border-bone text-bone" : "border-transparent text-putty hover:text-bone"
	}`;

export function TabStrip() {
	const runs = useRunsStore((s) => s.runs);
	const active = selectActivePipelines(runs);

	return (
		<nav className="flex min-w-0 flex-1 items-stretch overflow-x-auto" aria-label="Runs">
			<NavLink to="/wall" className={tabClass}>
				Wall
			</NavLink>
			{active.map((run) => (
				<NavLink key={run.id} to={`/runs/${run.id}`} className={tabClass}>
					<StateDot tone={stateTone(run.state)} label={stateLabel(run.state)} />
					<span className="font-mono text-xs">{run.ticket}</span>
					{run.gate ? (
						<span className="badge badge-warning badge-xs font-bold" title="Waiting on you">
							<span aria-hidden>!</span>
							<span className="sr-only">waiting on you</span>
						</span>
					) : null}
				</NavLink>
			))}
			<NavLink to="/new" className={tabClass}>
				New run
			</NavLink>
			<NavLink to="/settings" className={tabClass}>
				Settings
			</NavLink>
		</nav>
	);
}
