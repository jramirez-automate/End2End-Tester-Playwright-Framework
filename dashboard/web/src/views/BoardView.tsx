import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { JiraIssueInfo, TicketSummary } from "../../../shared/types";
import { orderEnvs, stageOf, stagesFor, type Stage } from "../board";
import { LoadState } from "../components/LoadState";
import { EnvTallyChip, JiraChip, StatusChip } from "../components/Verdict";
import { formatAgo } from "../format";
import { fetchTickets } from "../state/api";
import { useJira } from "../state/useJira";
import { useLoad } from "../state/useLoad";
import { useUiConfig } from "../state/useUiConfig";

/** Done piles up forever — show the newest few unless asked. */
const DONE_PREVIEW = 12;

/** Release board: every ticket (bugs live on the Bugs board) by the furthest env it has reached. */
export function BoardView() {
	const tickets = useLoad(fetchTickets, "board");
	const jira = useJira();
	const [showAllDone, setShowAllDone] = useState(false);
	const [query, setQuery] = useState("");
	const configured = useUiConfig().data?.envs;
	const envs = useMemo(() => orderEnvs(configured ?? [], tickets.data?.tickets), [configured, tickets.data]);
	const stages = useMemo(() => stagesFor(envs), [envs]);

	const columns = useMemo(() => {
		const byStage = new Map<Stage, TicketSummary[]>(stages.map((s) => [s.id, []]));
		const q = query.trim().toLowerCase();
		for (const t of tickets.data?.tickets ?? []) {
			if (t.kind === "bug") continue;
			if (q && !`${t.key} ${t.title ?? ""}`.toLowerCase().includes(q)) continue;
			byStage.get(stageOf(t, envs).stage)?.push(t);
		}
		return byStage;
	}, [tickets.data, query, stages, envs]);

	return (
		<section className="flex h-full flex-col p-4">
			<div className="mb-3 flex flex-wrap items-center gap-3">
				<div className="eyebrow text-putty">Release board</div>
				<input
					type="search"
					className="input input-sm ml-auto w-64 border-line bg-ink-1"
					placeholder="Filter key or title"
					aria-label="Filter tickets"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<button
					type="button"
					className="btn btn-sm"
					onClick={() => {
						tickets.reload();
						jira.refresh();
					}}
				>
					Refresh
				</button>
			</div>
			<LoadState loading={tickets.loading && !tickets.data} error={tickets.error} onRetry={tickets.reload} />
			{tickets.data ? (
				<div className="grid min-h-0 flex-1 auto-cols-[minmax(200px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
					{stages.map((stage) => {
						const all = columns.get(stage.id) ?? [];
						const capped = stage.id === "done" && !showAllDone ? all.slice(0, DONE_PREVIEW) : all;
						return (
							<div key={stage.id} className="flex min-h-0 flex-col rounded-lg border border-line bg-ink-1">
								<div className="eyebrow flex items-center gap-2 border-b border-line px-3 py-2 text-bone">
									{stage.label}
									<span className="font-mono text-[11px] normal-case text-putty">{all.length}</span>
								</div>
								<ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
									{capped.map((t) => (
										<BoardCard key={t.key} ticket={t} envs={envs} jira={jira.data?.issues[t.key]} />
									))}
									{capped.length < all.length ? (
										<li>
											<button type="button" className="btn btn-ghost btn-xs w-full" onClick={() => setShowAllDone(true)}>
												Show all {all.length}
											</button>
										</li>
									) : null}
								</ul>
							</div>
						);
					})}
				</div>
			) : null}
		</section>
	);
}

function BoardCard({ ticket, envs, jira }: { ticket: TicketSummary; envs: string[]; jira: JiraIssueInfo | undefined }) {
	const { tally } = stageOf(ticket, envs);
	const p = ticket.pipeline;
	return (
		<li>
			<Link
				to={`/tickets/${ticket.key}`}
				className="flex flex-col gap-1.5 rounded border border-line bg-ink-2 p-2.5 transition-colors hover:border-feed"
			>
				<div className="flex items-center gap-2">
					<span className="font-mono text-xs text-bone">{ticket.key}</span>
					<span className="ml-auto font-mono text-[11px] text-putty" title={ticket.updatedAt}>
						{formatAgo(ticket.updatedAt)}
					</span>
				</div>
				{ticket.title ? <span className="line-clamp-2 text-xs">{ticket.title}</span> : null}
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					{tally ? <EnvTallyChip tally={tally} /> : null}
					{p && !p.complete && p.status === "blocked" ? <StatusChip tone="standby" label={`step ${p.step}`} detail="blocked" /> : null}
					<JiraChip info={jira} />
				</div>
			</Link>
		</li>
	);
}
