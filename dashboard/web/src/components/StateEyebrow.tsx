import type { RunState } from "../../../shared/types";

/** Broadcast vocabulary per DESIGN.md — one label + signal tone per state. */
const MAP: Record<RunState, { label: string; tone: Tone }> = {
	queued: { label: "CUE", tone: "feed" },
	provisioning: { label: "CUE", tone: "feed" },
	starting: { label: "CUE", tone: "feed" },
	running: { label: "ON AIR", tone: "tally" },
	waiting_gate: { label: "STANDBY", tone: "standby" },
	completed: { label: "WRAP", tone: "ok" },
	failed: { label: "FAULT", tone: "fault" },
	aborted: { label: "CUT", tone: "putty" },
	interrupted: { label: "HOLD", tone: "putty" },
};

export type Tone = "tally" | "standby" | "ok" | "fault" | "feed" | "putty";

/* Static class maps — Tailwind only generates classes it can see verbatim. */
export const TONE_TEXT: Record<Tone, string> = {
	tally: "text-tally",
	standby: "text-standby",
	ok: "text-ok",
	fault: "text-fault",
	feed: "text-feed",
	putty: "text-putty",
};

export const TONE_BG: Record<Tone, string> = {
	tally: "bg-tally",
	standby: "bg-standby",
	ok: "bg-ok",
	fault: "bg-fault",
	feed: "bg-feed",
	putty: "bg-putty",
};

export function stateTone(state: RunState): Tone {
	return MAP[state].tone;
}

export function stateLabel(state: RunState): string {
	return MAP[state].label;
}

export function StateEyebrow({ state }: { state: RunState }) {
	const { label, tone } = MAP[state];
	return (
		<span className={`eyebrow ${TONE_TEXT[tone]}`} aria-live="polite">
			{label}
		</span>
	);
}

/** Small status dot in a signal tone; `label` names the state for screen readers. */
export function StateDot({ tone, label }: { tone: Tone; label?: string }) {
	return (
		<>
			<span className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_BG[tone]}`} aria-hidden />
			{label ? <span className="sr-only">{label}</span> : null}
		</>
	);
}
