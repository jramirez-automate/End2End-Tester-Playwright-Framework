import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RunRecord } from "../../../shared/types";
import { ACTIVE_STATES } from "../../../shared/types";
import { deriveActivity, isExecuting, thumbsFresh } from "../derive";
import { formatCost, formatElapsed, useNow } from "../format";
import { fetchThumbs, type ThumbMeta } from "../state/api";
import { useRunsStore } from "../state/runsStore";
import { GateCard } from "./GateCard";
import { LedMeter } from "./LedMeter";
import { StateEyebrow } from "./StateEyebrow";
import { WorkerThumb } from "./WorkerThumb";

/** One studio monitor on the wall. */
export function RunCard({ run }: { run: RunRecord }) {
	const navigate = useNavigate();
	const sendMessage = useRunsStore((s) => s.sendMessage);
	const sending = useRunsStore((s) => s.sending[run.id] ?? false);
	const events = useRunsStore((s) => s.events[run.id]);
	const now = useNow();
	const [thumbMeta, setThumbMeta] = useState<ThumbMeta[]>([]);

	const activeRun = ACTIVE_STATES.includes(run.state);

	// Thumb metadata drives the tally lamp's "fresh frame" rule.
	useEffect(() => {
		if (run.state !== "running") return;
		let alive = true;
		const poll = (): void => {
			fetchThumbs(run.id)
				.then((res) => {
					if (alive) setThumbMeta(res.workers);
				})
				.catch(() => {});
		};
		poll();
		const timer = window.setInterval(poll, 2000);
		return () => {
			alive = false;
			window.clearInterval(timer);
		};
	}, [run.id, run.state]);

	const executing = isExecuting(run, thumbsFresh(thumbMeta, now));
	const lampClass = executing ? "lamp lamp--tally" : run.state === "waiting_gate" ? "lamp lamp--standby" : "lamp";
	const firstWorker = thumbMeta[0]?.worker ?? 0;
	const elapsed = (run.endedAt ? Date.parse(run.endedAt) : now) - Date.parse(run.createdAt);
	const currentActivity = run.state === "running" ? deriveActivity(events ?? []).at(-1) : undefined;

	return (
		<article className="flex flex-col gap-2.5 rounded-lg border border-line bg-ink-2 p-2.5">
			<div className="flex items-center justify-between gap-2">
				<span className={lampClass} aria-hidden />
				<StateEyebrow state={run.state} />
			</div>
			<a
				className="block rounded"
				href={`/runs/${run.id}`}
				onClick={(e) => {
					e.preventDefault();
					navigate(`/runs/${run.id}`);
				}}
			>
				<WorkerThumb url={`/api/runs/${run.id}/thumbs/${firstWorker}`} live={executing} dim={!activeRun} />
			</a>
			<div className="flex min-w-0 items-center gap-2">
				<button
					type="button"
					className="cursor-pointer font-mono text-[13px] font-medium text-bone hover:underline"
					onClick={() => navigate(`/runs/${run.id}`)}
				>
					{run.ticket}
				</button>
				<span className="badge badge-ghost badge-sm font-mono text-[10px] uppercase">{run.env}</span>
				{run.model ? <span className="badge badge-ghost badge-sm font-mono text-[10px]">{run.model}</span> : null}
				<div className="ml-auto">
					<LedMeter steps={run.steps} executing={executing} mini />
				</div>
			</div>
			{run.state === "provisioning" ? (
				<div className="flex min-w-0 items-center gap-2 text-xs" aria-live="polite">
					<span className="loading loading-dots loading-xs text-feed" aria-hidden />
					<span className="min-w-0 flex-1 truncate font-mono text-putty">Preparing workspace…</span>
				</div>
			) : null}
			{currentActivity ? (
				<div className="flex min-w-0 items-center gap-2 text-xs" aria-live="polite">
					<span className="loading loading-dots loading-xs text-feed" aria-hidden />
					<span className="min-w-0 flex-1 truncate font-mono text-putty">
						{currentActivity.kind === "agent"
							? `${currentActivity.label} — ${currentActivity.detail ?? "working"}`
							: currentActivity.label}
					</span>
				</div>
			) : null}
			{run.gate ? (
				<GateCard gate={run.gate} compact busy={sending} onAnswer={(text) => void sendMessage(run.id, text)} />
			) : null}
			<div className="flex justify-between gap-2 font-mono text-xs text-putty">
				<span>{formatElapsed(elapsed)}</span>
				<span>{run.costUsd > 0 ? formatCost(run.costUsd) : ""}</span>
				<span>{run.turns > 0 ? `${run.turns} turns` : ""}</span>
			</div>
		</article>
	);
}
