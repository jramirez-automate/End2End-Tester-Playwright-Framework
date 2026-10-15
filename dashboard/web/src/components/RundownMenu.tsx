import { useEffect, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import type { RunRecord } from "../../../shared/types";
import { formatDuration } from "../format";
import { fetchExternalPipelines } from "../state/api";
import { selectActivePipelines, selectWrappedByTicket, type WrappedGroup } from "../state/pipelines";
import { useRunsStore } from "../state/runsStore";
import { useLoad } from "../state/useLoad";
import { ExternalPipelineRow, useOutsidePipelines } from "./ExternalPipelines";
import { LedMeter } from "./LedMeter";
import { StateDot, stateLabel, stateTone, TONE_TEXT } from "./StateEyebrow";

/**
 * The Rundown — one place to switch between every pipeline. Active runs sit under
 * "On Air"; finished ones under "Wrapped", grouped by ticket so a ticket that ran
 * several times reads as one pipeline's history. Purely navigational: rows deep-link
 * to /runs/:id. All ordering/grouping is the tested selectors in state/pipelines.ts.
 */
export function RundownMenu() {
	const runs = useRunsStore((s) => s.runs);
	const active = selectActivePipelines(runs);
	const wrapped = selectWrappedByTicket(runs);
	const currentId = useMatch("/runs/:id")?.params.id ?? null;
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();
	const externalLoad = useLoad(fetchExternalPipelines, "external");
	const outside = useOutsidePipelines(externalLoad.data);

	// Close on outside click or Escape while open.
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent): void => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const go = (id: string): void => {
		setOpen(false);
		navigate(`/runs/${id}`);
	};

	const total = active.length + wrapped.reduce((n, g) => n + g.runs.length, 0) + outside.length;

	return (
		<div ref={ref} className="relative flex items-stretch">
			<button
				type="button"
				className="flex h-12 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm whitespace-nowrap text-putty transition-colors hover:text-bone"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => {
					// Terminal pipelines change without telling us — re-read on every open.
					if (!open) externalLoad.reload();
					setOpen((v) => !v);
				}}
			>
				<span className="eyebrow">Rundown</span>
				<span aria-hidden className="text-[10px]">
					▾
				</span>
			</button>
			{open ? (
				<div
					role="menu"
					aria-label="Pipelines"
					className="absolute top-12 left-0 z-30 max-h-[70vh] w-72 overflow-y-auto rounded-box border border-line bg-ink-1 p-1.5 shadow-lg"
				>
					{total === 0 ? (
						<p className="px-2 py-3 text-center text-xs text-putty">No pipelines yet.</p>
					) : null}

					{active.length > 0 ? (
						<>
							<div className="eyebrow px-2 pt-1 pb-1 text-putty">On Air</div>
							{active.map((run) => (
								<PipelineRow key={run.id} run={run} current={run.id === currentId} onGo={go} />
							))}
						</>
					) : null}

					{outside.length > 0 ? (
						<>
							<div className="eyebrow px-2 pt-2 pb-1 text-putty" title="Started in a terminal session — status from pipeline-status.ndjson">
								Outside the dashboard
							</div>
							{outside.map((p) => (
								<ExternalPipelineRow key={p.key} pipeline={p} onGo={() => setOpen(false)} />
							))}
						</>
					) : null}

					{wrapped.length > 0 ? (
						<>
							<div className="eyebrow px-2 pt-2 pb-1 text-putty">Wrapped</div>
							{wrapped.map((group) => (
								<WrappedGroupRows key={group.ticket} group={group} currentId={currentId} onGo={go} />
							))}
						</>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/** A single-ticket group. One run → a plain row; several → a ticket header + one row per run. */
function WrappedGroupRows({
	group,
	currentId,
	onGo,
}: {
	group: WrappedGroup;
	currentId: string | null;
	onGo: (id: string) => void;
}) {
	if (group.runs.length === 1) {
		return <PipelineRow run={group.latest} current={group.latest.id === currentId} onGo={onGo} />;
	}
	return (
		<div className="mb-0.5">
			<div className="flex items-center gap-1.5 px-2 pt-1 pb-0.5">
				<span className="font-mono text-xs text-bone">{group.ticket}</span>
				<span className="font-mono text-[10px] text-putty">×{group.runs.length}</span>
			</div>
			{group.runs.map((run) => (
				<PipelineRow key={run.id} run={run} current={run.id === currentId} onGo={onGo} indent showLabel />
			))}
		</div>
	);
}

function PipelineRow({
	run,
	current,
	onGo,
	indent = false,
	showLabel = false,
}: {
	run: RunRecord;
	current: boolean;
	onGo: (id: string) => void;
	indent?: boolean;
	showLabel?: boolean;
}) {
	const tone = stateTone(run.state);
	const label = stateLabel(run.state);
	const ended = run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.createdAt) : null;
	return (
		<button
			type="button"
			role="menuitem"
			onClick={() => onGo(run.id)}
			aria-current={current ? "true" : undefined}
			className={`flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left transition-colors hover:bg-ink-2 ${
				current ? "bg-ink-2" : ""
			} ${indent ? "pl-4" : ""}`}
		>
			<StateDot tone={tone} label={label} />
			{showLabel ? (
				<span className={`eyebrow ${TONE_TEXT[tone]}`}>{label}</span>
			) : (
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-bone">{run.ticket}</span>
			)}
			{ended !== null ? <span className="font-mono text-[10px] text-putty">{formatDuration(ended)}</span> : null}
			<div className={showLabel ? "ml-auto" : ""}>
				<LedMeter steps={run.steps} mini />
			</div>
		</button>
	);
}
