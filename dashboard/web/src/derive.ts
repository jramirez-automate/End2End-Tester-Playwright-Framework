/** Pure derivations over run records + event logs. */
import type { ArtifactRef, RunEvent, RunRecord, StepState } from "../../shared/types";
import type { ThumbMeta } from "./state/api";

export interface StepArtifact {
	ref: ArtifactRef;
	step: number;
}

const artifactCache = new WeakMap<RunEvent[], StepArtifact[]>();

const EVIDENCE_STEP = 6;

/**
 * Well-known artifact kinds always belong to a fixed pipeline step, regardless
 * of which step is active when their file event lands — the watcher re-fires
 * "add" for every existing file whenever it (re)attaches mid-run, which would
 * otherwise re-stamp the whole evidence folder onto the current step.
 */
const PINNED_KIND_STEP: Partial<Record<ArtifactRef["kind"], number>> = {
	screenshot: EVIDENCE_STEP,
	video: EVIDENCE_STEP,
	trace: EVIDENCE_STEP,
	summary: EVIDENCE_STEP,
};

function stepForArtifact(ref: ArtifactRef, activeStep: number): number {
	const base = baseName(ref.relPath).toLowerCase();
	if (base === "comment-rows.json") return 8; // Jira results-comment payload
	if (base.startsWith("zephyr-")) return 9;
	return PINNED_KIND_STEP[ref.kind] ?? activeStep;
}

/**
 * Artifact events tagged with a pipeline step: well-known kinds are pinned to
 * the step that produces them; anything else gets the step that was active
 * when it landed (defaults to step 6, evidence capture). Deduped by relPath —
 * the newest event for a file wins.
 */
export function deriveArtifacts(events: RunEvent[]): StepArtifact[] {
	const hit = artifactCache.get(events);
	if (hit) return hit;
	const byPath = new Map<string, StepArtifact>();
	let currentStep = EVIDENCE_STEP;
	for (const ev of events) {
		if (ev.kind === "step") {
			const step = ev.payload as Partial<StepState> | null;
			if (
				step &&
				typeof step === "object" &&
				typeof step.step === "number" &&
				step.status === "active"
			) {
				currentStep = step.step;
			}
		} else if (ev.kind === "artifact") {
			const ref = ev.payload as Partial<ArtifactRef> | null;
			if (
				ref &&
				typeof ref === "object" &&
				typeof ref.url === "string" &&
				typeof ref.relPath === "string"
			) {
				byPath.set(ref.relPath, {
					ref: ref as ArtifactRef,
					step: stepForArtifact(ref as ArtifactRef, currentStep),
				});
			}
		}
	}
	const out = [...byPath.values()];
	artifactCache.set(events, out);
	return out;
}

const PLAYWRIGHT_DETAIL = /playwright|e2e-runner|npm run test|test:[a-z]+/i;

/** Does this text (step detail, command, description) suggest a Playwright run? */
export function looksLikePlaywright(text: string): boolean {
	return PLAYWRIGHT_DETAIL.test(text);
}

/** Does the current active step's detail suggest Playwright is driving a browser? */
export function detailSuggestsPlaywright(steps: StepState[]): boolean {
	return steps.some((s) => s.status === "active" && PLAYWRIGHT_DETAIL.test(s.detail ?? ""));
}

/** Any worker thumbnail updated within the last 5 seconds? */
export function thumbsFresh(workers: ThumbMeta[], now: number): boolean {
	return workers.some((w) => typeof w.ts === "string" && now - Date.parse(w.ts) < 5000);
}

/** Tally-lamp rule: running AND (Playwright-ish step detail OR a fresh thumb). */
export function isExecuting(run: RunRecord, thumbFresh: boolean): boolean {
	return run.state === "running" && (detailSuggestsPlaywright(run.steps) || thumbFresh);
}

export function baseName(relPath: string): string {
	return relPath.split("/").at(-1) ?? relPath;
}

// ---------------------------------------------------------------------------
// Live activity — what the session is doing RIGHT NOW.
// A tool_use block without its tool_result yet is an in-flight operation.
// ---------------------------------------------------------------------------

export interface LiveActivity {
	id: string;
	kind: "agent" | "command" | "tool";
	/** Short display name: subagent type, command, or tool name. */
	label: string;
	detail?: string;
	startedAt: string;
	/** True when the command looks like a Playwright run (gets live progress). */
	playwright?: boolean;
	/** Live token count for a subagent, from its task_progress usage. */
	tokens?: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
	return typeof v === "string" ? v : null;
}

function activityFor(
	name: string,
	input: Record<string, unknown>,
	id: string,
	ts: string,
): LiveActivity {
	if (name === "Task" || name === "Agent") {
		return {
			id,
			kind: "agent",
			label: asString(input["subagent_type"]) ?? "subagent",
			detail: asString(input["description"]) ?? undefined,
			startedAt: ts,
		};
	}
	if (name === "Bash") {
		const description = asString(input["description"]);
		const command = asString(input["command"]) ?? "";
		const firstLine = command.split("\n")[0] ?? "";
		return {
			id,
			kind: "command",
			label: (description ?? firstLine).slice(0, 80),
			startedAt: ts,
			playwright: PLAYWRIGHT_DETAIL.test(`${command} ${description ?? ""}`),
		};
	}
	const file = asString(input["file_path"]);
	return {
		id,
		kind: "tool",
		label: name,
		detail: file ? baseName(file) : undefined,
		startedAt: ts,
	};
}

const activityCache = new WeakMap<RunEvent[], LiveActivity[]>();

/** In-flight tool calls, oldest first (the outermost operation leads). */
export function deriveActivity(events: RunEvent[]): LiveActivity[] {
	const hit = activityCache.get(events);
	if (hit) return hit;
	const open = new Map<string, LiveActivity>();
	for (const ev of events) {
		if (ev.kind === "action") {
			// Live playwright progress attaches to the newest in-flight test command.
			const payload = asRecord(ev.payload);
			const line = payload ? asString(payload["line"]) : null;
			if (line && payload?.["action"] === "playwright") {
				const target = [...open.values()].reverse().find((a) => a.playwright);
				if (target) target.detail = line;
			}
			continue;
		}
		if (ev.kind !== "claude") continue;
		const msg = asRecord(ev.payload);
		if (!msg) continue;
		const type = asString(msg["type"]);
		if (type === "result") {
			// A finished turn does NOT stop a background subagent — keep agents (they
			// clear on their own task_notification / tool_result). Only synchronous
			// commands/tools, which cannot outlive the turn, are dropped here.
			for (const [id, a] of open) if (a.kind !== "agent") open.delete(id);
			continue;
		}
		if (type === "system") {
			const subtype = asString(msg["subtype"]);
			// A (re)started session: in-flight rows from the previous process are dead.
			if (subtype === "init") {
				open.clear();
				continue;
			}
			// Live subagent progress: keep the in-flight agent row's detail + tokens current.
			if (subtype === "task_progress") {
				const agent = open.get(asString(msg["tool_use_id"]) ?? "");
				if (agent) {
					const description = asString(msg["description"]);
					if (description) agent.detail = description;
					const tokens = asRecord(msg["usage"])?.["total_tokens"];
					if (typeof tokens === "number") agent.tokens = tokens;
				}
				continue;
			}
			// The subagent finished — its final report arrives separately in the transcript.
			if (subtype === "task_notification") {
				const id = asString(msg["tool_use_id"]);
				if (id) open.delete(id);
			}
			continue;
		}
		if (type !== "assistant" && type !== "user") continue;
		const content = asRecord(msg["message"])?.["content"];
		if (!Array.isArray(content)) continue;
		for (const raw of content) {
			const block = asRecord(raw);
			if (!block) continue;
			const blockType = asString(block["type"]);
			if (blockType === "tool_use") {
				const id = asString(block["id"]) ?? `t-${ev.seq}`;
				const input = asRecord(block["input"]) ?? {};
				open.set(id, activityFor(asString(block["name"]) ?? "tool", input, id, ev.ts));
			} else if (blockType === "tool_result") {
				const id = asString(block["tool_use_id"]);
				if (id) open.delete(id);
			}
		}
	}
	const out = [...open.values()];
	activityCache.set(events, out);
	return out;
}

// ---------------------------------------------------------------------------
// Partial-action output (kind "action", excluding live playwright progress).
// ---------------------------------------------------------------------------

export interface ActionLogEntry {
	action: string;
	line: string;
	done?: boolean;
	ok?: boolean;
	dryRun?: boolean;
}

const actionLogCache = new WeakMap<RunEvent[], ActionLogEntry[]>();

/** Partial-action output lines in arrival order (playwright progress excluded). */
export function deriveActionLog(events: RunEvent[]): ActionLogEntry[] {
	const hit = actionLogCache.get(events);
	if (hit) return hit;
	const out: ActionLogEntry[] = [];
	for (const ev of events) {
		if (ev.kind !== "action") continue;
		const payload = asRecord(ev.payload);
		const action = payload ? asString(payload["action"]) : null;
		const line = payload ? asString(payload["line"]) : null;
		if (!payload || !action || !line || action === "playwright") continue;
		out.push({
			action,
			line,
			done: payload["done"] === true || undefined,
			ok: typeof payload["ok"] === "boolean" ? payload["ok"] : undefined,
			dryRun: typeof payload["dryRun"] === "boolean" ? payload["dryRun"] : undefined,
		});
	}
	actionLogCache.set(events, out);
	return out;
}

/** The most recent terminal outcome per action — drives the two-step publish flow. */
export function latestActionOutcomes(log: ActionLogEntry[]): Map<string, ActionLogEntry> {
	const out = new Map<string, ActionLogEntry>();
	for (const entry of log) {
		if (entry.done) out.set(entry.action, entry);
	}
	return out;
}

const provisionCache = new WeakMap<RunEvent[], string[]>();

/** Workspace-provisioning log lines (step 0), in arrival order. */
export function deriveProvisionLines(events: RunEvent[]): string[] {
	const hit = provisionCache.get(events);
	if (hit) return hit;
	const out: string[] = [];
	for (const ev of events) {
		if (ev.kind !== "provision") continue;
		const line = asRecord(ev.payload)?.["line"];
		if (typeof line === "string") out.push(line);
	}
	provisionCache.set(events, out);
	return out;
}

export interface PlaywrightProgress {
	line: string;
	/** When the line landed — lets the UI flag a stalled run. */
	ts: string;
}

const progressCache = new WeakMap<RunEvent[], PlaywrightProgress | null>();

/** Latest live playwright progress line ("▶ 2/7 Create tier — …"), if any. */
export function derivePlaywrightProgress(events: RunEvent[]): PlaywrightProgress | null {
	const hit = progressCache.get(events);
	if (hit !== undefined) return hit;
	let latest: PlaywrightProgress | null = null;
	for (const ev of events) {
		if (ev.kind !== "action") continue;
		const payload = asRecord(ev.payload);
		const line = payload ? asString(payload["line"]) : null;
		if (line && payload?.["action"] === "playwright") latest = { line, ts: ev.ts };
	}
	progressCache.set(events, latest);
	return latest;
}
