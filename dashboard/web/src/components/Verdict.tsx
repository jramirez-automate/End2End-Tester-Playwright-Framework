import type { CaseVerdict, EnvTally, EvidenceEnv, HistoryOutcome, JiraIssueInfo, StepStatus } from "../../../shared/types";

export type Tone = "ok" | "fault" | "standby" | "feed" | "idle";

const DOT: Record<Tone, string> = {
	ok: "bg-ok",
	fault: "bg-fault",
	standby: "bg-standby",
	feed: "bg-feed",
	idle: "bg-line",
};

const TEXT: Record<Tone, string> = {
	ok: "text-ok",
	fault: "text-fault",
	standby: "text-standby",
	feed: "text-feed",
	idle: "text-putty",
};

/**
 * Status chip: colored dot + the state in words (DESIGN.md — a dot never carries
 * status alone). Signal color lands on the dot and the label only.
 */
export function StatusChip({ tone, label, detail }: { tone: Tone; label: string; detail?: string }) {
	return (
		<span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap">
			<span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden />
			<span className={TEXT[tone]}>{label}</span>
			{detail ? <span className="text-putty">{detail}</span> : null}
		</span>
	);
}

export function EnvTallyChip({ tally }: { tally: EnvTally | undefined }) {
	if (!tally) return <span className="font-mono text-xs text-putty">—</span>;
	const ran = tally.pass + tally.fail + tally.other;
	const tone: Tone = tally.verdict === "fail" ? "fault" : tally.verdict === "pass" ? "ok" : "standby";
	const label = tally.verdict === "fail" ? "FAIL" : tally.verdict === "pass" ? "PASS" : "PART";
	return <StatusChip tone={tone} label={label} detail={`${tally.pass}/${ran}`} />;
}

const CASE_TONE: Record<CaseVerdict, [Tone, string]> = {
	pass: ["ok", "PASS"],
	fail: ["fault", "FAIL"],
	skipped: ["idle", "SKIP"],
	"not-run": ["idle", "NOT RUN"],
	unknown: ["standby", "SEE NOTE"],
};

export function CaseVerdictChip({ verdict }: { verdict: CaseVerdict }) {
	const [tone, label] = CASE_TONE[verdict];
	return <StatusChip tone={tone} label={label} />;
}

const OUTCOME_TONE: Record<HistoryOutcome, [Tone, string]> = {
	passed: ["ok", "PASS"],
	failed: ["fault", "FAIL"],
	flaky: ["standby", "FLAKY"],
	skipped: ["idle", "SKIP"],
};

export function OutcomeChip({ outcome }: { outcome: HistoryOutcome }) {
	const [tone, label] = OUTCOME_TONE[outcome];
	return <StatusChip tone={tone} label={label} />;
}

const STEP_TONE: Record<StepStatus, [Tone, string]> = {
	done: ["ok", "done"],
	active: ["feed", "running"],
	blocked: ["standby", "blocked"],
	skipped: ["idle", "skipped"],
	pending: ["idle", "pending"],
};

export function StepChip({ step, status, complete }: { step: string; status: StepStatus; complete?: boolean }) {
	if (complete) return <StatusChip tone="ok" label="WRAP" detail={`step ${step}`} />;
	const [tone, label] = STEP_TONE[status];
	return <StatusChip tone={tone} label={`step ${step}`} detail={label} />;
}

/** Jira status, toned by category: QA-ready reads standby (it's waiting on you), done ok, in flight feed. */
export function JiraChip({ info }: { info: JiraIssueInfo | undefined }) {
	if (!info) return null;
	const tone: Tone = /ready for test|in test/i.test(info.status)
		? "standby"
		: info.category === "done"
			? "ok"
			: info.category === "indeterminate"
				? "feed"
				: "idle";
	return (
		<span title={info.assignee ? `Assignee: ${info.assignee}` : undefined}>
			<StatusChip tone={tone} label={info.status} />
		</span>
	);
}
