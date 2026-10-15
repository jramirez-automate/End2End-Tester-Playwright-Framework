import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { orderEnvs } from "../board";
import { EnvTallyChip, StepChip } from "../components/Verdict";
import { LoadState } from "../components/LoadState";
import { formatAgo } from "../format";
import { fetchTickets } from "../state/api";
import { useLoad } from "../state/useLoad";
import { useUiConfig } from "../state/useUiConfig";
import { filterTickets, ticketFilters, type TicketFilter } from "../tracker";

export function TicketsView() {
	const { data, error, loading, reload } = useLoad(fetchTickets, "tickets");
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<TicketFilter>("all");

	const configured = useUiConfig().data?.envs;
	const envs = useMemo(() => orderEnvs(configured ?? [], data?.tickets), [configured, data]);
	const final = configured?.[configured.length - 1];
	const tickets = useMemo(() => filterTickets(data?.tickets ?? [], query, filter, final), [data, query, filter, final]);

	return (
		<section className="h-full overflow-y-auto p-4">
			<div className="mb-3 flex flex-wrap items-center gap-3">
				<div className="eyebrow text-putty">Tickets</div>
				{data ? <span className="font-mono text-xs text-putty">{tickets.length}/{data.tickets.length}</span> : null}
				<input
					type="search"
					className="input input-sm ml-auto w-64 border-line bg-ink-1"
					placeholder="Search key or title"
					aria-label="Search tickets"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<div className="join" role="group" aria-label="Filter tickets">
					{ticketFilters(final).map((f) => (
						<button
							key={f.id}
							type="button"
							className={`btn join-item btn-sm ${filter === f.id ? "btn-active" : ""}`}
							aria-pressed={filter === f.id}
							onClick={() => setFilter(f.id)}
						>
							{f.label}
						</button>
					))}
				</div>
				<button type="button" className="btn btn-sm" onClick={reload}>
					Refresh
				</button>
			</div>

			<LoadState loading={loading && !data} error={error} onRetry={reload} />

			{data && data.tickets.length === 0 ? (
				<p className="py-24 text-center text-putty">
					No ticket evidence in <span className="font-mono">{data.dir}</span>. Set DASHBOARD_SUITE_DIR to read
					another checkout's evidence.
				</p>
			) : null}

			{data && data.tickets.length > 0 ? (
				<div className="overflow-x-auto rounded-lg border border-line bg-ink-1">
					<table className="table table-sm">
						<thead>
							<tr className="eyebrow border-line text-putty">
								<th>Ticket</th>
								<th>Title</th>
								{envs.map((env) => (
									<th key={env}>{env}</th>
								))}
								<th>Pipeline</th>
								<th>Updated</th>
							</tr>
						</thead>
						<tbody>
							{tickets.map((t) => (
								<tr key={t.key} className="border-line hover:bg-ink-2">
									<td>
										<Link className="link font-mono text-xs text-bone" to={`/tickets/${t.key}`}>
											{t.key}
										</Link>
									</td>
									<td className="max-w-md">
										<span className="line-clamp-2" title={t.title}>
											{t.title ?? <span className="text-putty">—</span>}
										</span>
									</td>
									{envs.map((env) => (
										<td key={env}>
											<EnvTallyChip tally={t.envs[env]} />
										</td>
									))}
									<td>
										{t.pipeline ? (
											<StepChip step={t.pipeline.step} status={t.pipeline.status} complete={t.pipeline.complete} />
										) : (
											<span className="font-mono text-xs text-putty">—</span>
										)}
									</td>
									<td className="font-mono text-xs whitespace-nowrap text-putty" title={t.updatedAt}>
										{formatAgo(t.updatedAt)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{tickets.length === 0 ? <p className="p-4 text-sm text-putty">No tickets match.</p> : null}
				</div>
			) : null}
		</section>
	);
}
