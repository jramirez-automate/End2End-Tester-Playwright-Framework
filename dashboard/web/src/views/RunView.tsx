import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RunEvent, RunRecord } from "../../../shared/types";
import { ACTIVE_STATES, AUTO_RESUME_MAX } from "../../../shared/types";
import { shouldAutoApprove } from "../autoApprove";
import { ActivityStrip } from "../components/ActivityStrip";
import { AgentCard } from "../components/AgentCard";
import { CustomReply } from "../components/CustomReply";
import { GateCard } from "../components/GateCard";
import { LiveFeedPanel } from "../components/LiveFeedPanel";
import { PartialActions } from "../components/PartialActions";
import { PipelineRail } from "../components/PipelineRail";
import { StateEyebrow } from "../components/StateEyebrow";
import { ToolCallCard, type RunningNote } from "../components/ToolCallCard";
import {
	deriveArtifacts,
	derivePlaywrightProgress,
	deriveProvisionLines,
	detailSuggestsPlaywright,
	looksLikePlaywright,
	type PlaywrightProgress,
} from "../derive";
import { formatCost, formatElapsed, useNow } from "../format";
import { renderMarkdown } from "../markdown";
import { useRunsStore } from "../state/runsStore";
import { transcriptFor, type TranscriptItem } from "../transcript";

const EMPTY_EVENTS: RunEvent[] = [];
const RENDER_CAP = 400;
/** Pixels from the bottom within which auto-scroll stays pinned. */
const PIN_THRESHOLD = 80;

export function RunView() {
	const { id = "" } = useParams();
	const run = useRunsStore((s) => s.runs[id]);
	const events = useRunsStore((s) => s.events[id]) ?? EMPTY_EVENTS;
	const connectRun = useRunsStore((s) => s.connectRun);
	const disconnectRun = useRunsStore((s) => s.disconnectRun);

	useEffect(() => {
		connectRun(id);
		return () => disconnectRun(id);
	}, [id, connectRun, disconnectRun]);

	if (!run) {
		return (
			<div className="p-10 text-center text-putty">
				<p>
					No run with this id. Back to the{" "}
					<a className="link text-feed" href="/wall">
						wall
					</a>
					.
				</p>
			</div>
		);
	}
	return <RunViewLoaded run={run} events={events} />;
}

function RunViewLoaded({ run, events }: { run: RunRecord; events: RunEvent[] }) {
	const sendMessage = useRunsStore((s) => s.sendMessage);
	const sending = useRunsStore((s) => s.sending[run.id] ?? false);
	const auto = useRunsStore((s) => s.autoApprove[run.id] ?? false);
	const executing = run.state === "running" && detailSuggestsPlaywright(run.steps);
	const artifacts = deriveArtifacts(events);
	const active = ACTIVE_STATES.includes(run.state);

	return (
		<div className="grid h-full min-h-0 grid-cols-[260px_1fr] xl:grid-cols-[260px_1fr_380px]">
			<PipelineRail
				steps={run.steps}
				artifacts={artifacts}
				executing={executing}
				runActive={active}
				provisionLines={deriveProvisionLines(events)}
				provisioning={run.state === "provisioning"}
			/>
			<section className="flex min-h-0 min-w-0 flex-col" aria-label="Session">
				<RunHeader run={run} />
				<ActivityStrip run={run} events={events} sending={sending} />
				<Transcript run={run} events={events} />
				<div className="shrink-0 border-t border-line bg-ink-1 p-3">
					{run.gate ? (
						<GateCard
							gate={run.gate}
							busy={sending}
							auto={auto && shouldAutoApprove(run.gate, auto)}
							onAnswer={(text) => void sendMessage(run.id, text)}
						/>
					) : active ? (
						<div className="collapse-arrow collapse border border-line bg-ink-2">
							<input type="checkbox" aria-label="Send a custom instruction" />
							<div className="collapse-title min-h-0 py-2 text-xs text-putty">Send a custom instruction…</div>
							<div className="collapse-content">
								<CustomReply onSend={(text) => void sendMessage(run.id, text)} busy={sending} />
							</div>
						</div>
					) : (
						<PartialActions run={run} events={events} />
					)}
				</div>
			</section>
			<div className="hidden min-h-0 xl:flex xl:flex-col">
				<LiveFeedPanel run={run} events={events} />
			</div>
		</div>
	);
}

function RunHeader({ run }: { run: RunRecord }) {
	const now = useNow();
	const navigate = useNavigate();
	const interrupt = useRunsStore((s) => s.interrupt);
	const abort = useRunsStore((s) => s.abort);
	const resume = useRunsStore((s) => s.resume);
	const deleteRun = useRunsStore((s) => s.deleteRun);
	const auto = useRunsStore((s) => s.autoApprove[run.id] ?? false);
	const setAutoApprove = useRunsStore((s) => s.setAutoApprove);
	const [actionError, setActionError] = useState<string | null>(null);
	const [actionBusy, setActionBusy] = useState<string | null>(null);

	const act = (name: string, fn: (id: string) => Promise<void>): void => {
		setActionError(null);
		setActionBusy(name);
		fn(run.id)
			.catch((err: unknown) => setActionError(err instanceof Error ? err.message : "Action failed."))
			.finally(() => setActionBusy(null));
	};

	const del = (): void => {
		setActionError(null);
		setActionBusy("delete");
		deleteRun(run.id)
			.then(() => navigate("/wall"))
			.catch((err: unknown) => {
				setActionError(err instanceof Error ? err.message : "Delete failed.");
				setActionBusy(null);
			});
	};

	const active = ACTIVE_STATES.includes(run.state);
	// While the server retries a crashed session, the Resume button yields to a status readout.
	const autoResuming = run.state === "failed" && run.autoResumeAttempt !== undefined && Boolean(run.sessionId);
	const resumable = (run.state === "interrupted" || run.state === "failed") && Boolean(run.sessionId) && !autoResuming;
	const elapsed = (run.endedAt ? Date.parse(run.endedAt) : now) - Date.parse(run.createdAt);

	return (
		<header className="shrink-0 border-b border-line bg-ink-1 px-4 py-2.5">
			<div className="flex flex-wrap items-center gap-3">
				<StateEyebrow state={run.state} />
				<span className="font-mono text-sm font-medium">{run.ticket}</span>
				<span className="badge badge-ghost badge-sm font-mono text-[10px] uppercase">{run.env}</span>
				{run.model ? <span className="badge badge-ghost badge-sm font-mono text-[10px]">{run.model}</span> : null}
				<span className="font-mono text-xs text-putty">{formatElapsed(elapsed)}</span>
				{run.costUsd > 0 ? <span className="font-mono text-xs text-putty">{formatCost(run.costUsd)}</span> : null}
				<div className="ml-auto flex items-center gap-3">
					{active ? (
						<label
							className="flex cursor-pointer items-center gap-1.5 text-xs text-putty"
							title="Safe auto — auto-approve flow gates (continue, start authoring). The extra-environment and publish gates still pause for you."
						>
							<input
								type="checkbox"
								className="toggle toggle-primary toggle-xs"
								checked={auto}
								onChange={(e) => setAutoApprove(run.id, e.target.checked)}
							/>
							Auto
						</label>
					) : null}
					{run.state === "running" ? (
						<ActionButton name="interrupt" busy={actionBusy} onClick={() => act("interrupt", interrupt)}>
							Interrupt
						</ActionButton>
					) : null}
					{active ? (
						<ActionButton name="abort" busy={actionBusy} onClick={() => act("abort", abort)}>
							Abort
						</ActionButton>
					) : null}
					{autoResuming ? (
						<span className="flex items-center gap-2 text-xs text-standby">
							<span className="loading loading-spinner loading-xs" aria-hidden />
							Auto-resuming ({run.autoResumeAttempt}/{AUTO_RESUME_MAX})
						</span>
					) : null}
					{resumable ? (
						<ActionButton name="resume" busy={actionBusy} onClick={() => act("resume", resume)}>
							Resume
						</ActionButton>
					) : null}
					{!active && !autoResuming ? (
						<ActionButton name="delete" busy={actionBusy} onClick={del}>
							Delete
						</ActionButton>
					) : null}
				</div>
			</div>
			{actionError ? <div className="mt-1 text-xs text-fault">{actionError}</div> : null}
			{run.error ? <div className="mt-1 text-xs text-fault">{run.error}</div> : null}
		</header>
	);
}

function ActionButton({
	name,
	busy,
	onClick,
	children,
}: {
	name: string;
	busy: string | null;
	onClick: () => void;
	children: string;
}) {
	return (
		<button type="button" className="btn btn-sm" disabled={busy !== null} onClick={onClick}>
			{busy === name ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
			{children}
		</button>
	);
}

function Transcript({ run, events }: { run: RunRecord; events: RunEvent[] }) {
	const active = ACTIVE_STATES.includes(run.state);
	const items = transcriptFor(events);
	const pwProgress = active ? derivePlaywrightProgress(events) : null;
	const visible = items.length > RENDER_CAP ? items.slice(items.length - RENDER_CAP) : items;
	const scrollRef = useRef<HTMLDivElement>(null);
	const [tailing, setTailing] = useState(true);
	// items.length when tailing paused — anything beyond it is "new".
	const anchorRef = useRef(0);
	const newCount = tailing ? 0 : Math.max(0, items.length - anchorRef.current);

	// events.length (not items.length) so streamed text keeps the tail pinned.
	useEffect(() => {
		const el = scrollRef.current;
		if (el && tailing) el.scrollTop = el.scrollHeight;
	}, [events.length, run.gate, tailing]);

	const pauseTail = (): void => {
		anchorRef.current = items.length;
		setTailing(false);
	};
	const resumeTail = (): void => {
		setTailing(true);
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	};

	return (
		<div className="relative min-h-0 flex-1">
			<div
				ref={scrollRef}
				role="log"
				aria-label="Transcript"
				className="h-full overflow-y-auto px-4 py-3"
				onScroll={(e) => {
					const el = e.currentTarget;
					const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
					if (atBottom && !tailing) resumeTail();
					else if (!atBottom && tailing) pauseTail();
				}}
			>
				{items.length === 0 ? (
					<div className="flex items-center gap-2 p-4 text-sm text-putty">
						<span className="loading loading-dots loading-sm text-feed" aria-hidden />
						Waiting for the session to speak…
					</div>
				) : (
					visible.map((item) => <TranscriptRow key={item.id} item={item} active={active} pwProgress={pwProgress} />)
				)}
			</div>
			{active || !tailing ? (
				<button
					type="button"
					aria-pressed={tailing}
					title={tailing ? "Auto-scroll is on — click to pause" : "Auto-scroll is paused — click to jump to the latest"}
					className="absolute right-4 bottom-3 flex items-center gap-1.5 rounded-full border border-line bg-ink-2/95 px-2.5 py-1"
					onClick={() => (tailing ? pauseTail() : resumeTail())}
				>
					{tailing ? (
						<>
							<span className="h-1.5 w-1.5 rounded-full bg-feed" aria-hidden />
							<span className="eyebrow text-putty">Tailing</span>
						</>
					) : (
						<>
							<span aria-hidden>↓</span>
							<span className="eyebrow text-bone">
								{newCount > 0 ? `${newCount} new · jump to latest` : "Jump to latest"}
							</span>
						</>
					)}
				</button>
			) : null}
		</div>
	);
}

const USER_CLAMP_CHARS = 500;
const USER_CLAMP_LINES = 8;

/** Long user messages (pasted prompts, gate replies) clamp behind "Show all". */
function UserBubble({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	const lines = text.split("\n");
	const long = text.length > USER_CLAMP_CHARS || lines.length > USER_CLAMP_LINES;
	const shown =
		expanded || !long ? text : `${lines.slice(0, USER_CLAMP_LINES).join("\n").slice(0, USER_CLAMP_CHARS)}…`;
	return (
		<div className="my-2 ml-auto w-fit max-w-[80%] rounded-lg border border-line bg-ink-2 px-3 py-2">
			<span className="eyebrow text-putty">You</span>
			<div className="text-sm whitespace-pre-wrap">{shown}</div>
			{long ? (
				<button
					type="button"
					className="mt-1 cursor-pointer text-xs text-feed hover:underline"
					onClick={() => setExpanded((v) => !v)}
				>
					{expanded ? "Show less" : `Show all (${lines.length} lines)`}
				</button>
			) : null}
		</div>
	);
}

/** A running Bash that looks like a Playwright run gets the live progress note. */
function playwrightNote(item: TranscriptItem, pwProgress: PlaywrightProgress | null): RunningNote | undefined {
	if (item.type !== "tool" || item.result !== undefined) return undefined;
	if (item.name !== "Bash" || !looksLikePlaywright(`${item.detail ?? ""} ${item.summary}`)) return undefined;
	return { line: pwProgress?.line ?? null, ts: pwProgress?.ts ?? null };
}

function TranscriptRow({
	item,
	active,
	pwProgress = null,
}: {
	item: TranscriptItem;
	active: boolean;
	pwProgress?: PlaywrightProgress | null;
}) {
	switch (item.type) {
		case "user":
			return <UserBubble text={item.text} />;
		case "assistant":
			return (
				<div className="my-2 max-w-[92%]">
					<span className="eyebrow text-putty">Claude</span>
					<div className="md text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />
					{item.streaming ? <span className="loading loading-dots loading-xs text-feed" aria-hidden /> : null}
				</div>
			);
		case "tool":
			return <ToolCallCard item={item} active={active} liveNote={playwrightNote(item, pwProgress)} />;
		case "agent":
			return <AgentCard item={item} active={active} pwProgress={pwProgress} />;
		case "turn":
			return (
				<div className="my-3 flex items-center gap-2 font-mono text-[11px] text-putty before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
					{item.durationMs !== undefined ? <span>turn · {Math.round(item.durationMs / 1000)}s</span> : <span>turn</span>}
				</div>
			);
	}
}
