import type {
	BugSummary,
	EnvTally,
	EvidenceEnv,
	ExternalPipeline,
	JiraIssueInfo,
	RunRecord,
	TicketSummary,
} from "../../shared/types";

// ---------------------------------------------------------------------------
// Release board
// ---------------------------------------------------------------------------

/** "planning", an env name, or "done" (the last env passed). */
export type Stage = string;

/** Promotion order: the configured envs, then any other env a ticket has results for. */
export function orderEnvs(configured: EvidenceEnv[], tickets: TicketSummary[] = []): EvidenceEnv[] {
	const extra = new Set<string>();
	for (const t of tickets)
		for (const env of Object.keys(t.envs)) if (!configured.includes(env)) extra.add(env);
	return [...configured, ...[...extra].sort()];
}

export function stagesFor(envs: EvidenceEnv[]): Array<{ id: Stage; label: string }> {
	const last = envs[envs.length - 1];
	return [
		{ id: "planning", label: "Not tested yet" },
		...envs.map((env) => ({ id: env, label: env })),
		...(last ? [{ id: "done", label: `Passed on ${last}` }] : []),
	];
}

/** Where a ticket sits: the furthest env with a result, or done once the last env passes. */
export function stageOf(t: TicketSummary, envs: EvidenceEnv[]): { stage: Stage; tally?: EnvTally } {
	const last = envs[envs.length - 1];
	if (last && t.envs[last]?.verdict === "pass") return { stage: "done", tally: t.envs[last] };
	for (const env of [...envs].reverse()) {
		const tally = t.envs[env];
		if (tally) return { stage: env, tally };
	}
	return { stage: "planning" };
}

// ---------------------------------------------------------------------------
// Jira status helpers
// ---------------------------------------------------------------------------

/** Jira says "your turn": the issue is waiting on QA. */
export function isReadyForTest(info: JiraIssueInfo | undefined): boolean {
	return !!info && /ready for test|in test/i.test(info.status);
}

// ---------------------------------------------------------------------------
// Bugs board
// ---------------------------------------------------------------------------

export type BugGroup = "retest" | "retest-failed" | "open" | "fixed";

export const BUG_GROUPS: Array<{ id: BugGroup; label: string; hint: string }> = [
	{
		id: "retest",
		label: "Ready to retest",
		hint: "Jira says it's waiting on QA and no passing retest exists yet",
	},
	{
		id: "retest-failed",
		label: "Retest failed",
		hint: "The bug's own evidence bundle still fails",
	},
	{ id: "open", label: "Waiting on a fix", hint: "Open in Jira, nothing to retest yet" },
	{ id: "fixed", label: "Fixed", hint: "Retest passed, or the Jira issue is done" },
];

export function bugGroup(bug: BugSummary, info: JiraIssueInfo | undefined): BugGroup {
	if (bug.retest === "pass") return "fixed";
	if (isReadyForTest(info)) return "retest";
	if (info?.category === "done") return "fixed";
	if (bug.retest === "fail") return "retest-failed";
	return "open";
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export type AttentionKind =
	"gate" | "blocked" | "bug-retest" | "ready-for-test" | "failing" | "awaiting-final";

export const ATTENTION_SECTIONS: Array<{ id: AttentionKind; label: string }> = [
	{ id: "gate", label: "Gates waiting on you" },
	{ id: "blocked", label: "Pipelines blocked" },
	{ id: "bug-retest", label: "Bugs to retest" },
	{ id: "ready-for-test", label: "Ready for test in Jira" },
	{ id: "failing", label: "Failing" },
	{ id: "awaiting-final", label: "Waiting on the last environment" },
];

export interface AttentionItem {
	kind: AttentionKind;
	key: string;
	title?: string;
	detail: string;
	href: string;
	at?: string;
}

/** demo targets public sample apps — a pass there promotes nothing. */
const NOT_A_STAGE = new Set(["demo"]);

/** A pass waiting on the last env longer than this stops nagging — it's history, not a to-do. */
export const AWAITING_FINAL_DAYS = 30;
/** A pipeline blocked longer than this was abandoned, not waiting. */
export const BLOCKED_DAYS = 14;

export interface AttentionInput {
	/** Promotion order (orderEnvs); the last one is where a ticket is finally verified. */
	envs: EvidenceEnv[];
	tickets: TicketSummary[];
	bugs: BugSummary[];
	jira: Record<string, JiraIssueInfo>;
	runs: RunRecord[];
	external: ExternalPipeline[];
	now?: number;
}

export function attentionItems({
	envs,
	tickets,
	bugs,
	jira,
	runs,
	external,
	now = Date.now(),
}: AttentionInput): AttentionItem[] {
	const final = envs[envs.length - 1];
	const items: AttentionItem[] = [];
	const ticketHref = (key: string) => `/tickets/${key}`;

	for (const run of runs) {
		if (run.state !== "waiting_gate" || !run.gate) continue;
		items.push({
			kind: "gate",
			key: run.ticket,
			detail: run.gate.question.split("\n")[0]?.slice(0, 200) ?? "Waiting on your answer",
			href: `/runs/${run.id}`,
			...(run.updatedAt ? { at: run.updatedAt } : {}),
		});
	}
	const gated = new Set(items.map((i) => i.key));

	for (const t of tickets) {
		const p = t.pipeline;
		// A dashboard run sitting at a gate already shows above; a closed issue or a
		// pipeline blocked for weeks is abandoned, not waiting.
		if (!p || p.complete || p.status !== "blocked" || gated.has(t.key)) continue;
		if (jira[t.key]?.category === "done") continue;
		if (!p.updatedAt || now - Date.parse(p.updatedAt) > BLOCKED_DAYS * 86_400_000) continue;
		const outside = external.some((e) => e.key === t.key) ? " (session outside the dashboard)" : "";
		items.push({
			kind: "blocked",
			key: t.key,
			...(t.title ? { title: t.title } : {}),
			detail: `Step ${p.step} blocked${p.note ? ` — ${p.note}` : ""}${outside}`,
			href: ticketHref(t.key),
			...(p.updatedAt ? { at: p.updatedAt } : {}),
		});
	}

	for (const bug of bugs) {
		const info = jira[bug.key];
		const group = bugGroup(bug, info);
		if (group !== "retest" && group !== "retest-failed") continue;
		items.push({
			kind: "bug-retest",
			key: bug.key,
			...(bug.title ? { title: bug.title } : {}),
			detail:
				group === "retest"
					? `Jira: ${info?.status} — raised from ${bug.raisedFrom.map((r) => r.ticket).join(", ")}`
					: `Last retest failed${info ? ` — Jira: ${info.status}` : ""}`,
			href: bug.hasFolder ? ticketHref(bug.key) : "/bugs",
			...(bug.updatedAt ? { at: bug.updatedAt } : {}),
		});
	}

	for (const t of tickets) {
		if (t.kind !== "ticket") continue;
		const info = jira[t.key];
		const failing = (Object.entries(t.envs) as Array<[EvidenceEnv, EnvTally]>).filter(
			([, v]) => v.verdict === "fail",
		);

		if (isReadyForTest(info)) {
			const { stage } = stageOf(t, envs);
			items.push({
				kind: "ready-for-test",
				key: t.key,
				title: t.title ?? info!.summary,
				detail: `Jira: ${info!.status}${stage === "planning" ? " — no results yet" : ""}`,
				href: ticketHref(t.key),
				...(info!.updated ? { at: info!.updated } : {}),
			});
		}

		// A closed issue's old failure is history, not a to-do.
		if (failing.length > 0 && info?.category !== "done") {
			items.push({
				kind: "failing",
				key: t.key,
				...(t.title ? { title: t.title } : {}),
				detail: failing
					.map(([env, v]) => `${env} ${v.pass}/${v.pass + v.fail + v.other}`)
					.join(" · "),
				href: ticketHref(t.key),
				at: t.updatedAt,
			});
			continue;
		}

		if (!final) continue;
		const earlierPass = Object.entries(t.envs).some(
			([env, v]) => env !== final && !NOT_A_STAGE.has(env) && v?.verdict === "pass",
		);
		const finalPass = t.envs[final]?.verdict === "pass";
		const recent = now - Date.parse(t.updatedAt) < AWAITING_FINAL_DAYS * 86_400_000;
		if (earlierPass && !finalPass && failing.length === 0 && recent) {
			items.push({
				kind: "awaiting-final",
				key: t.key,
				...(t.title ? { title: t.title } : {}),
				detail: `Needs ${final}${info ? ` — Jira: ${info.status}` : ""}`,
				href: ticketHref(t.key),
				at: t.updatedAt,
			});
		}
	}

	const order = new Map(ATTENTION_SECTIONS.map((s, i) => [s.id, i]));
	return items.sort(
		(a, b) => order.get(a.kind)! - order.get(b.kind)! || (b.at ?? "").localeCompare(a.at ?? ""),
	);
}
