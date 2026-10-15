import { looksLikePlaywright, type PlaywrightProgress } from "../derive";
import { formatTokens } from "../format";
import { renderMarkdown } from "../markdown";
import type { AgentChild, AgentItem } from "../transcript";
import { ToolCallCard, type RunningNote } from "./ToolCallCard";

/** The agent's running playwright Bash (if any) gets the live progress note. */
function childNote(child: AgentChild, pwProgress: PlaywrightProgress | null): RunningNote | undefined {
	if (child.type !== "tool" || child.result !== undefined) return undefined;
	if (child.name !== "Bash" || !looksLikePlaywright(`${child.detail ?? ""} ${child.summary}`)) return undefined;
	return { line: pwProgress?.line ?? null, ts: pwProgress?.ts ?? null };
}

/**
 * A subagent task as a single supervised unit: who is working (agent type),
 * on what (description), what it is doing right now (task_progress readout),
 * with the full prompt, its own tool activity and the final report behind
 * expanders instead of flooding the chat.
 */
export function AgentCard({
	item,
	active = true,
	pwProgress = null,
}: {
	item: AgentItem;
	active?: boolean;
	pwProgress?: PlaywrightProgress | null;
}) {
	const stateDot = item.isError ? "bg-fault" : item.interrupted || !item.done ? "bg-line" : "bg-ok";
	return (
		<div className="my-2 rounded-md border border-line border-l-2 border-l-feed/50 bg-ink-1">
			<div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
				{!item.done && active ? (
					<span className="loading loading-bars loading-xs text-feed" aria-hidden />
				) : (
					<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${stateDot}`} aria-hidden />
				)}
				<span className="eyebrow shrink-0 text-feed">Agent</span>
				<span className="shrink-0 font-mono font-medium text-bone">{item.agentType}</span>
				<span className="min-w-0 flex-1 truncate text-bone/90">{item.description}</span>
				{item.toolUses !== undefined || item.totalTokens !== undefined ? (
					<span className="shrink-0 font-mono text-[10px] text-putty">
						{[
							item.toolUses !== undefined ? `${item.toolUses} tools` : null,
							item.totalTokens !== undefined ? `${formatTokens(item.totalTokens)} tok` : null,
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				) : null}
			</div>
			{!item.done && active && item.progress ? (
				<div className="flex min-w-0 items-center gap-2 px-3 pb-2 font-mono text-[11px] text-putty">
					<span className="shrink-0" aria-hidden>
						⤷
					</span>
					<span className="min-w-0 flex-1 truncate">{item.progress}</span>
				</div>
			) : null}
			<div className="border-t border-line px-2 py-1">
				{item.prompt ? (
					<details className="group/i">
						<summary className="cursor-pointer px-1 py-1 text-[11px] text-putty hover:text-bone">
							<span className="inline-block transition-transform group-open/i:rotate-90" aria-hidden>
								›
							</span>{" "}
							Instructions
						</summary>
						<pre className="m-1 max-h-64 overflow-auto rounded bg-ink-0 p-2 text-xs whitespace-pre-wrap text-bone/80">
							{item.prompt}
						</pre>
					</details>
				) : null}
				{item.children.length > 0 ? (
					<details className="group/a">
						<summary className="cursor-pointer px-1 py-1 text-[11px] text-putty hover:text-bone">
							<span className="inline-block transition-transform group-open/a:rotate-90" aria-hidden>
								›
							</span>{" "}
							Activity ({item.children.length})
						</summary>
						<div className="m-1">
							{item.children.map((child) =>
								child.type === "tool" ? (
									<ToolCallCard key={child.id} item={child} active={active} liveNote={childNote(child, pwProgress)} />
								) : (
									<div key={child.id} className="my-1 border-l border-line pl-2 text-xs whitespace-pre-wrap text-putty">
										{child.text}
									</div>
								),
							)}
						</div>
					</details>
				) : null}
				{item.result ? (
					<details className="group/r">
						<summary className="cursor-pointer px-1 py-1 text-[11px] text-putty hover:text-bone">
							<span className="inline-block transition-transform group-open/r:rotate-90" aria-hidden>
								›
							</span>{" "}
							Report
						</summary>
						<div
							className={`md m-1 max-h-96 overflow-auto rounded bg-ink-0 p-2 text-xs ${item.isError ? "border-l-2 border-fault" : ""}`}
							dangerouslySetInnerHTML={{ __html: renderMarkdown(item.result) }}
						/>
					</details>
				) : null}
				{!item.prompt && item.children.length === 0 && !item.result ? (
					<div className="px-1 py-1 text-[11px] text-putty">Starting…</div>
				) : null}
			</div>
		</div>
	);
}
