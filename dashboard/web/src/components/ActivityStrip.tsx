import { ACTIVE_STATES } from "../../../shared/types";
import type { RunEvent, RunRecord } from "../../../shared/types";
import { deriveActivity, type LiveActivity } from "../derive";
import { formatElapsed, formatTokens, useNow } from "../format";

const KIND_LABEL: Record<LiveActivity["kind"], string> = {
	agent: "Agent",
	command: "Command",
	tool: "Tool",
};

const MAX_ROWS = 4;

/**
 * Realtime "what is happening" readout: every in-flight subagent, command and
 * tool gets a row with a loader and a ticking clock. Visible whenever the
 * session is mid-turn, so the operator never stares at a silent screen.
 */
export function ActivityStrip({
	run,
	events,
	sending = false,
}: {
	run: RunRecord;
	events: RunEvent[];
	sending?: boolean;
}) {
	const now = useNow();
	const activity = deriveActivity(events);
	// A background subagent can still be working after the orchestrator's turn ends
	// (even while a gate is up) — keep the strip visible so it never looks stuck.
	// Only while the run is still active, so a lingering row can't spin on a dead run.
	const hasLiveAgent = activity.some((a) => a.kind === "agent") && ACTIVE_STATES.includes(run.state);
	const working = run.state === "running" || run.state === "starting";
	if (!working && !sending && !hasLiveAgent) return null;

	const visible = activity.slice(-MAX_ROWS);

	return (
		<div className="flex flex-col gap-1.5 border-b border-line bg-ink-1 px-4 py-2.5" aria-live="polite">
			{sending ? (
				<Row spinner="spinner" kind="Sending" label="Delivering your reply to the session…" tone="text-standby" />
			) : null}
			{run.state === "starting" ? (
				<Row spinner="dots" kind="Session" label="Starting the Claude session…" tone="text-feed" />
			) : null}
			{run.state === "running" && visible.length === 0 && !sending ? (
				<Row spinner="dots" kind="Claude" label="Thinking…" tone="text-feed" />
			) : null}
			{visible.map((a) => (
				<Row
					key={a.id}
					spinner={a.kind === "agent" ? "bars" : "spinner"}
					kind={KIND_LABEL[a.kind]}
					label={a.detail ? `${a.label} — ${a.detail}` : a.label}
					tone={a.kind === "agent" ? "text-feed" : "text-putty"}
					elapsed={formatElapsed(now - Date.parse(a.startedAt))}
					tokens={a.tokens}
					mono={a.kind !== "agent"}
				/>
			))}
			{activity.length > MAX_ROWS ? (
				<span className="text-xs text-putty">+{activity.length - MAX_ROWS} more in flight</span>
			) : null}
		</div>
	);
}

const SPINNER_CLASS: Record<"dots" | "spinner" | "bars", string> = {
	dots: "loading loading-dots loading-xs",
	spinner: "loading loading-spinner loading-xs",
	bars: "loading loading-bars loading-xs",
};

function Row({
	spinner,
	kind,
	label,
	tone,
	elapsed,
	tokens,
	mono = false,
}: {
	spinner: "dots" | "spinner" | "bars";
	kind: string;
	label: string;
	tone: string;
	elapsed?: string;
	tokens?: number;
	mono?: boolean;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2 text-xs">
			<span className={`${SPINNER_CLASS[spinner]} ${tone}`} aria-hidden />
			<span className={`eyebrow shrink-0 ${tone}`}>{kind}</span>
			<span className={`min-w-0 flex-1 truncate ${mono ? "font-mono" : ""} text-bone/90`}>{label}</span>
			{tokens !== undefined ? <span className="shrink-0 font-mono text-putty">{formatTokens(tokens)} tok</span> : null}
			{elapsed ? <span className="shrink-0 font-mono text-putty">{elapsed}</span> : null}
		</div>
	);
}
