/**
 * Pure builder: a run's claude WAL events -> chat transcript items.
 * Stream deltas accumulate into a live assistant bubble that is replaced by
 * the final assistant text block when it arrives. Messages tagged with
 * parent_tool_use_id belong to a subagent and nest under its AgentItem
 * instead of appearing as top-level chat bubbles.
 */
import type { RunEvent } from "../../shared/types";

export interface UserItem {
	type: "user";
	id: string;
	text: string;
}

export interface AssistantItem {
	type: "assistant";
	id: string;
	text: string;
	streaming: boolean;
}

export interface ToolCallItem {
	type: "tool";
	id: string;
	/** Raw tool name from the API (e.g. "mcp__atlassian__getJiraIssue"). */
	name: string;
	/** Short chip label (e.g. "atlassian:getJiraIssue"). */
	label: string;
	/** Friendly verb-first one-liner (e.g. "List dashboard source files"). */
	summary: string;
	/** Raw input worth expanding: full command, path, or pretty-printed args. */
	detail?: string;
	/** Event timestamp of the tool_use — drives the "Running… 1m 32s" clock. */
	startedAt: string;
	result?: string;
	isError?: boolean;
}

export interface AgentNote {
	type: "note";
	id: string;
	text: string;
}

export type AgentChild = ToolCallItem | AgentNote;

export interface AgentItem {
	type: "agent";
	id: string;
	/** Subagent type, e.g. "e2e-explorer". */
	agentType: string;
	/** The orchestrator's short task description. */
	description: string;
	/** Full prompt sent to the subagent (behind the Instructions expander). */
	prompt?: string;
	/** The subagent's own tool calls and interim notes, in order. */
	children: AgentChild[];
	/** Latest task_progress description, e.g. "Reading pages/index.ts". */
	progress?: string;
	toolUses?: number;
	totalTokens?: number;
	/** Final report text (Agent tool_result, or task_notification summary). */
	result?: string;
	isError?: boolean;
	/** The session was resumed before this agent finished — neutral dot, not ok/fault. */
	interrupted?: boolean;
	done: boolean;
}

export interface TurnResultItem {
	type: "turn";
	id: string;
	durationMs?: number;
	totalCostUsd?: number;
}

export type TranscriptItem = UserItem | AssistantItem | ToolCallItem | AgentItem | TurnResultItem;

const RESULT_LIMIT = 4000;
const PROMPT_LIMIT = 8000;
const SUMMARY_LIMIT = 140;
const DETAIL_LIMIT = 2000;

function asRecord(v: unknown): Record<string, unknown> | null {
	return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
	return typeof v === "string" ? v : null;
}

function asNumber(v: unknown): number | null {
	return typeof v === "number" ? v : null;
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

function firstLine(s: string): string {
	return truncate((s.split("\n")[0] ?? "").trim(), SUMMARY_LIMIT);
}

/** Last two path segments — enough to recognize a file without the noise. */
function shortPath(p: string): string {
	const parts = p.split("/").filter(Boolean);
	return parts.slice(-2).join("/");
}

/** "getJiraIssue" -> "Get jira issue". */
function humanize(camel: string): string {
	const words = camel
		.replace(/[_-]+/g, " ")
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : camel;
}

/** Chip label: strip MCP prefixes ("mcp__atlassian__getJiraIssue" -> "atlassian:getJiraIssue"). */
function chipLabel(name: string): string {
	if (name.startsWith("mcp__")) {
		const [, server, ...rest] = name.split("__");
		return `${server}:${rest.join("__")}`;
	}
	return name;
}

function prettyJson(input: Record<string, unknown>): string | undefined {
	const json = JSON.stringify(input, null, 2);
	return json === "{}" ? undefined : truncate(json, DETAIL_LIMIT);
}

/** Friendly verb-first summary + expandable raw detail per tool. */
function describeTool(
	name: string,
	input: Record<string, unknown>,
): { summary: string; detail?: string } {
	if (name === "Bash") {
		const command = asString(input["command"]) ?? "";
		const description = asString(input["description"]);
		return { summary: description ?? firstLine(command), detail: truncate(command, DETAIL_LIMIT) };
	}
	if (name === "Read" || name === "Edit" || name === "Write" || name === "NotebookEdit") {
		const file = asString(input["file_path"]) ?? "";
		const verb = name === "Read" ? "Read" : name === "Write" ? "Write" : "Edit";
		return { summary: file ? `${verb} ${shortPath(file)}` : verb, detail: file || undefined };
	}
	if (name === "Grep") {
		const pattern = asString(input["pattern"]) ?? "";
		const path = asString(input["path"]);
		return {
			summary: `Search for "${truncate(pattern, 60)}"${path ? ` in ${shortPath(path)}` : ""}`,
			detail: prettyJson(input),
		};
	}
	if (name === "Glob") {
		return {
			summary: `Find files ${asString(input["pattern"]) ?? ""}`.trim(),
			detail: prettyJson(input),
		};
	}
	if (name === "Task" || name === "Agent") {
		const agent = asString(input["subagent_type"]) ?? "subagent";
		const description = asString(input["description"]) ?? "";
		return { summary: [agent, description].filter(Boolean).join(" — "), detail: prettyJson(input) };
	}
	if (name === "Skill") {
		const skill = asString(input["skill"]) ?? "";
		return { summary: `Run skill ${skill}`.trim(), detail: prettyJson(input) };
	}
	if (name === "ToolSearch") {
		return {
			summary: `Load tools for "${asString(input["query"]) ?? ""}"`,
			detail: prettyJson(input),
		};
	}
	if (name === "TodoWrite") {
		const todos = input["todos"];
		const count = Array.isArray(todos) ? todos.length : 0;
		return {
			summary: count ? `Update the plan (${count} tasks)` : "Update the plan",
			detail: prettyJson(input),
		};
	}
	if (name === "WebFetch") {
		return {
			summary: `Fetch ${truncate(asString(input["url"]) ?? "", 80)}`,
			detail: prettyJson(input),
		};
	}
	if (name === "WebSearch") {
		return {
			summary: `Search the web for "${truncate(asString(input["query"]) ?? "", 60)}"`,
			detail: prettyJson(input),
		};
	}
	// MCP + anything else: humanized method name plus one identifying argument.
	const base = name.startsWith("mcp__") ? (name.split("__")[2] ?? name) : name;
	const keyArg =
		Object.entries(input).find(
			([k, v]) =>
				/key|query|name|title|ticket|term/i.test(k) && typeof v === "string" && v.length <= 40,
		)?.[1] ?? Object.values(input).find((v) => typeof v === "string" && v.length <= 40);
	return {
		summary: typeof keyArg === "string" ? `${humanize(base)} · ${keyArg}` : humanize(base),
		detail: prettyJson(input),
	};
}

/** Flattens a tool_result content payload (string or block array) to text. */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const raw of content) {
			const block = asRecord(raw);
			if (block && asString(block["type"]) === "text") {
				const text = asString(block["text"]);
				if (text) parts.push(text);
			}
		}
		return parts.join("\n");
	}
	return "";
}

export function buildTranscript(events: RunEvent[]): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	const tools = new Map<string, ToolCallItem>();
	const agents = new Map<string, AgentItem>();
	let live: AssistantItem | null = null;

	const finalizeLive = (): void => {
		if (live) {
			live.streaming = false;
			live = null;
		}
	};

	const resolveResult = (block: Record<string, unknown>): void => {
		const id = asString(block["tool_use_id"]) ?? "";
		const isError = block["is_error"] === true;
		const agent = agents.get(id);
		if (agent) {
			agent.result = truncate(textOf(block["content"]), RESULT_LIMIT);
			agent.isError = isError;
			agent.done = true;
			return;
		}
		const target = tools.get(id);
		if (target) {
			target.result = truncate(textOf(block["content"]), RESULT_LIMIT);
			target.isError = isError;
		}
	};

	for (const ev of events) {
		if (ev.kind !== "claude") continue;
		const msg = asRecord(ev.payload);
		if (!msg) continue;
		const type = asString(msg["type"]);
		const host = agents.get(asString(msg["parent_tool_use_id"]) ?? "") ?? null;

		if (type === "stream_event") {
			const event = asRecord(msg["event"]);
			if (event && asString(event["type"]) === "content_block_delta") {
				const delta = asRecord(event["delta"]);
				if (delta && asString(delta["type"]) === "text_delta") {
					const text = asString(delta["text"]) ?? "";
					if (!live) {
						live = { type: "assistant", id: `live-${ev.seq}`, text: "", streaming: true };
						items.push(live);
					}
					live.text += text;
				}
			}
		} else if (type === "assistant") {
			const message = asRecord(msg["message"]);
			const content = message?.["content"];
			const blocks = Array.isArray(content) ? content : [];
			const texts: string[] = [];
			for (const raw of blocks) {
				const block = asRecord(raw);
				if (!block) continue;
				const blockType = asString(block["type"]);
				if (blockType === "text") {
					const text = asString(block["text"]);
					if (text) texts.push(text);
				} else if (blockType === "tool_use") {
					const name = asString(block["name"]) ?? "tool";
					const input = asRecord(block["input"]) ?? {};
					const toolId = asString(block["id"]) ?? `tool-${ev.seq}-${items.length}`;
					if (!host && (name === "Agent" || name === "Task")) {
						const agent: AgentItem = {
							type: "agent",
							id: toolId,
							agentType: asString(input["subagent_type"]) ?? "subagent",
							description: asString(input["description"]) ?? "",
							prompt: asString(input["prompt"])
								? truncate(asString(input["prompt"]) ?? "", PROMPT_LIMIT)
								: undefined,
							children: [],
							done: false,
						};
						agents.set(toolId, agent);
						items.push(agent);
					} else {
						const { summary, detail } = describeTool(name, input);
						const item: ToolCallItem = {
							type: "tool",
							id: toolId,
							name,
							label: chipLabel(name),
							summary,
							detail,
							startedAt: ev.ts,
						};
						tools.set(toolId, item);
						if (host) host.children.push(item);
						else items.push(item);
					}
				}
			}
			if (texts.length) {
				const text = texts.join("\n\n");
				if (host) {
					host.children.push({
						type: "note",
						id: `n-${ev.seq}`,
						text: truncate(text, RESULT_LIMIT),
					});
				} else if (live) {
					live.text = text;
					finalizeLive();
				} else {
					items.push({ type: "assistant", id: `a-${ev.seq}`, text, streaming: false });
				}
			}
		} else if (type === "user") {
			const message = asRecord(msg["message"]);
			const content = message?.["content"];
			if (typeof content === "string") {
				if (!host && content.trim()) items.push({ type: "user", id: `u-${ev.seq}`, text: content });
			} else if (Array.isArray(content)) {
				const texts: string[] = [];
				for (const raw of content) {
					const block = asRecord(raw);
					if (!block) continue;
					const blockType = asString(block["type"]);
					if (blockType === "text") {
						const text = asString(block["text"]);
						if (text) texts.push(text);
					} else if (blockType === "tool_result") {
						resolveResult(block);
					}
				}
				if (texts.length) {
					const text = texts.join("\n\n");
					// A subagent's first user message is its prompt — keep it on the card.
					if (host) host.prompt ??= truncate(text, PROMPT_LIMIT);
					else items.push({ type: "user", id: `u-${ev.seq}`, text });
				}
			}
		} else if (type === "system") {
			const subtype = asString(msg["subtype"]);
			if (subtype === "init") {
				// A (re)started session: anything still unresolved belongs to the
				// previous process and will never return — stop the spinners.
				finalizeLive();
				for (const tool of tools.values()) {
					if (tool.result === undefined) {
						tool.result = "Interrupted — the session was resumed before this call returned.";
					}
				}
				for (const openAgent of agents.values()) {
					if (!openAgent.done) {
						openAgent.done = true;
						openAgent.interrupted = true;
						openAgent.progress = undefined;
						openAgent.result ??=
							"Interrupted — the session was resumed before this agent finished.";
					}
				}
				continue;
			}
			const agent = agents.get(asString(msg["tool_use_id"]) ?? "");
			if (!agent) continue;
			if (subtype === "task_started") {
				agent.agentType = asString(msg["subagent_type"]) ?? agent.agentType;
				agent.description = asString(msg["description"]) ?? agent.description;
				const prompt = asString(msg["prompt"]);
				if (prompt) agent.prompt ??= truncate(prompt, PROMPT_LIMIT);
			} else if (subtype === "task_progress") {
				agent.progress = asString(msg["description"]) ?? agent.progress;
				const usage = asRecord(msg["usage"]);
				if (usage) {
					agent.toolUses = asNumber(usage["tool_uses"]) ?? agent.toolUses;
					agent.totalTokens = asNumber(usage["total_tokens"]) ?? agent.totalTokens;
				}
			} else if (subtype === "task_notification") {
				agent.done = true;
				if (asString(msg["status"]) === "failed") agent.isError = true;
				const summary = asString(msg["summary"]);
				if (summary) agent.result ??= truncate(summary, RESULT_LIMIT);
			}
		} else if (type === "result") {
			finalizeLive();
			const duration = msg["duration_ms"];
			const cost = msg["total_cost_usd"];
			items.push({
				type: "turn",
				id: `r-${ev.seq}`,
				durationMs: typeof duration === "number" ? duration : undefined,
				totalCostUsd: typeof cost === "number" ? cost : undefined,
			});
		}
	}

	return items;
}

const cache = new WeakMap<RunEvent[], TranscriptItem[]>();

/** Memoized per events-array reference (the store appends immutably). */
export function transcriptFor(events: RunEvent[]): TranscriptItem[] {
	const hit = cache.get(events);
	if (hit) return hit;
	const built = buildTranscript(events);
	cache.set(events, built);
	return built;
}
