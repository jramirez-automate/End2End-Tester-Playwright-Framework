import { formatElapsed, useNow } from "../format";
import type { ToolCallItem } from "../transcript";

/** No playwright progress for this long while running = probably wedged. */
const STALL_MS = 5 * 60_000;

/** Live context for a running playwright command (line may not exist yet). */
export interface RunningNote {
	line: string | null;
	/** When the line landed; null = nothing yet (started with the tool). */
	ts: string | null;
}

/**
 * Collapsed one-liner per tool call: friendly verb-first summary up front,
 * tool name demoted to a chip; the raw input and result live in the expander.
 * While running (and the run is alive) the row shows a ticking clock, and
 * `liveNote` (e.g. playwright per-test progress) replaces the bare "Running…",
 * escalating to a stall warning when progress stops arriving.
 */
export function ToolCallCard({
	item,
	active = true,
	liveNote,
}: {
	item: ToolCallItem;
	active?: boolean;
	liveNote?: RunningNote;
}) {
	const now = useNow();
	const running = item.result === undefined && active;
	const elapsed = running ? formatElapsed(now - Date.parse(item.startedAt)) : null;
	const sinceProgress = liveNote ? now - Date.parse(liveNote.ts ?? item.startedAt) : 0;
	const stalled = running && liveNote !== undefined && sinceProgress > STALL_MS;
	return (
		<details className="group my-1 rounded-md border border-line bg-ink-1">
			<summary className="flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-xs">
				{running ? (
					<span className="loading loading-spinner loading-xs text-feed" aria-hidden />
				) : (
					<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.isError ? "bg-fault" : "bg-line"}`} aria-hidden />
				)}
				<span className="min-w-0 flex-1 truncate text-bone/90">{item.summary || item.label}</span>
				{item.isError ? <span className="eyebrow shrink-0 text-fault">error</span> : null}
				{elapsed ? <span className="shrink-0 font-mono text-[10px] text-putty">{elapsed}</span> : null}
				<span className="shrink-0 font-mono text-[10px] text-putty">{item.label}</span>
				<span className="shrink-0 text-putty transition-transform group-open:rotate-90" aria-hidden>
					›
				</span>
			</summary>
			{item.detail ? (
				<pre className="m-2 mb-0 max-h-40 overflow-auto rounded bg-ink-0 p-2 font-mono text-xs whitespace-pre-wrap text-putty">
					{item.detail}
				</pre>
			) : null}
			{item.result === undefined ? (
				<div className="px-3 py-2 text-xs text-putty">
					{active ? `${liveNote?.line ?? "Running…"} · ${elapsed ?? ""}` : "No result recorded."}
					{stalled ? (
						<div className="mt-1 text-standby">
							No test progress for {Math.floor(sinceProgress / 60_000)}m — the run may be wedged. Interrupt is safe;
							the session can rerun the tests.
						</div>
					) : null}
				</div>
			) : (
				<pre
					className={`m-2 max-h-64 overflow-auto rounded bg-ink-0 p-2 text-xs whitespace-pre-wrap ${
						item.isError ? "border-l-2 border-fault text-fault" : "text-bone/80"
					}`}
				>
					{item.result}
				</pre>
			)}
		</details>
	);
}
