import { Link, useParams } from "react-router-dom";
import type { EvidenceEnv, TicketDetail } from "../../../shared/types";
import { orderEnvs } from "../board";
import { EvidenceMedia } from "../components/EvidenceMedia";
import { LoadState } from "../components/LoadState";
import { TrackerLink } from "../components/TrackerLink";
import { CaseVerdictChip, EnvTallyChip, StepChip } from "../components/Verdict";
import { formatAgo } from "../format";
import { renderMarkdown } from "../markdown";
import { fetchTicket, ticketFileUrl } from "../state/api";
import { useLoad } from "../state/useLoad";
import { useUiConfig } from "../state/useUiConfig";
import { Panel } from "../components/Panel";

function Markdown({ text }: { text: string }) {
	return <div className="md text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

export function TicketView() {
	const { key = "" } = useParams();
	const { data, error, loading, reload } = useLoad(() => fetchTicket(key), key);

	return (
		<div className="h-full overflow-y-auto p-4">
			<div className="mx-auto flex max-w-7xl flex-col gap-4">
				<Link className="link w-fit text-sm text-putty" to="/tickets">
					← All tickets
				</Link>
				{error === "ticket not found" ? (
					<p className="py-16 text-center text-putty">
						No evidence for <span className="font-mono">{key}</span> yet — it has specs, but no{" "}
						<span className="font-mono">src/evidence/{key}/</span> bundle.{" "}
						<TrackerLink ticket={key} className="text-feed">
							Open in the tracker
						</TrackerLink>
					</p>
				) : (
					<LoadState loading={loading && !data} error={error} onRetry={reload} />
				)}
				{data ? <TicketBody ticket={data} /> : null}
			</div>
		</div>
	);
}

function TicketBody({ ticket }: { ticket: TicketDetail }) {
	const fileUrl = (name: string) => ticketFileUrl(ticket.key, name);
	const configured = useUiConfig().data?.envs ?? [];
	const ordered = orderEnvs(configured, [ticket]);
	// Only the env columns this ticket actually has cells for.
	const caseEnvs = ordered.filter((env) => ticket.cases.some((c) => c.cells[env]));
	const envChips = ordered.filter((env) => ticket.envs[env]);

	return (
		<>
			<header className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="font-mono text-lg text-bone">{ticket.key}</h1>
					<TrackerLink ticket={ticket.key} className="text-sm text-feed">
						Open in the tracker
					</TrackerLink>
					<span className="font-mono text-xs text-putty" title={ticket.updatedAt}>
						updated {formatAgo(ticket.updatedAt)}
					</span>
				</div>
				{ticket.title ? <p className="font-display text-base font-semibold">{ticket.title}</p> : null}
				<div className="flex flex-wrap items-center gap-4">
					{envChips.map((env) => (
						<span key={env} className="flex items-center gap-2 text-xs">
							<span className="eyebrow text-putty">{env}</span>
							<EnvTallyChip tally={ticket.envs[env]} />
						</span>
					))}
					{ticket.pipeline ? (
						<span className="flex items-center gap-2 text-xs">
							<span className="eyebrow text-putty">Pipeline</span>
							<StepChip step={ticket.pipeline.step} status={ticket.pipeline.status} complete={ticket.pipeline.complete} />
						</span>
					) : null}
				</div>
				{ticket.intro ? <Markdown text={ticket.intro} /> : null}
			</header>

			{ticket.cases.length > 0 ? (
				<Panel title={`Test cases · ${ticket.cases.length}`}>
					<div className="overflow-x-auto">
						<table className="table table-sm [&_td]:align-top">
							<thead>
								<tr className="eyebrow border-line text-putty">
									<th>TC</th>
									<th>Case</th>
									{caseEnvs.map((env) => (
										<th key={env}>{env}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{ticket.cases.map((c, i) => (
									<tr key={`${c.tc}-${i}`} className="border-line">
										<td className="font-mono text-xs whitespace-nowrap">{c.tc || "—"}</td>
										<td className="min-w-72 text-sm">
											<div className="font-medium">{c.case}</div>
											{c.by ? <div className="font-mono text-xs text-putty">{c.by}</div> : null}
											{c.steps.length > 0 || c.expectedResult ? (
												<details className="mt-1 text-xs text-putty">
													<summary className="cursor-pointer">Steps and expected result</summary>
													<ol className="mt-1 list-decimal pl-4">
														{c.steps.map((s, n) => (
															<li key={n}>{s}</li>
														))}
													</ol>
													{c.expectedResult ? <p className="mt-1">Expected: {c.expectedResult}</p> : null}
												</details>
											) : null}
											{c.ticket ? (
												<TrackerLink ticket={c.ticket} className="mt-1 block font-mono text-xs text-feed" />
											) : null}
										</td>
										{caseEnvs.map((env) => (
											<CaseCellView key={env} cell={c.cells[env]} fileUrl={fileUrl} />
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Panel>
			) : null}

			{ticket.findings.length > 0 ? (
				<Panel title={`Findings · ${ticket.findings.length}`}>
					<ul className="flex flex-col gap-4">
						{ticket.findings.map((f, i) => (
							<li key={i} className="flex flex-col gap-1 text-sm">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium">{f.title}</span>
									{f.ticket ? <TrackerLink ticket={f.ticket} className="font-mono text-xs text-feed" /> : null}
								</div>
								{f.description ? <p className="text-putty">{f.description}</p> : null}
								{f.replicate.length > 0 ? (
									<ol className="list-decimal pl-5 text-xs text-putty">
										{f.replicate.map((s, n) => (
											<li key={n}>{s}</li>
										))}
									</ol>
								) : null}
								<EvidenceMedia names={f.media} url={fileUrl} />
							</li>
						))}
					</ul>
				</Panel>
			) : null}

			<div className="grid gap-4 lg:grid-cols-2">
				{ticket.coverage ? (
					<Panel title="Coverage ledger">
						<dl className="flex flex-col gap-3 text-sm">
							{(
								[
									["Area", ticket.coverage.area],
									["Specs", ticket.coverage.specs],
									["Environments", ticket.coverage.envs],
									["Notes", ticket.coverage.notes],
								] as const
							).map(([label, value]) => (
								<div key={label}>
									<dt className="eyebrow text-putty">{label}</dt>
									<dd>
										<Markdown text={value} />
									</dd>
								</div>
							))}
						</dl>
					</Panel>
				) : null}

				{ticket.steps.length > 0 ? (
					<Panel title="Pipeline telemetry">
						<ol className="flex flex-col gap-2">
							{ticket.steps.map((s) => (
								<li key={s.step} className="flex flex-col gap-0.5 text-sm">
									<div className="flex items-center gap-3">
										<StepChip step={s.step} status={s.status} />
										{s.ts ? <span className="font-mono text-xs text-putty">{s.ts.replace("T", " ").slice(0, 16)}</span> : null}
									</div>
									{s.note ? <p className="pl-4 text-xs text-putty">{s.note}</p> : null}
								</li>
							))}
						</ol>
					</Panel>
				) : null}
			</div>

			{ticket.links.length > 0 ? (
				<Panel title="Links">
					<ul className="flex flex-col gap-1 text-sm">
						{ticket.links.map((l) => (
							<li key={l.url}>
								<a className="link text-feed" href={l.url} target="_blank" rel="noopener noreferrer">
									{l.label}
								</a>
							</li>
						))}
					</ul>
				</Panel>
			) : null}

			{ticket.summaryMd ? (
				<Panel title="SUMMARY.md">
					<Markdown text={ticket.summaryMd} />
				</Panel>
			) : null}

			{ticket.files.length > 0 ? (
				<Panel title={`Files · ${ticket.files.length}`}>
					<details>
						<summary className="cursor-pointer text-sm text-putty">Show every file in src/evidence/{ticket.key}/</summary>
						<ul className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-2">
							{ticket.files.map((f) => (
								<li key={f.name} className="flex gap-2">
									<a className="link break-all text-feed" href={fileUrl(f.name)} target="_blank" rel="noopener noreferrer">
										{f.name}
									</a>
									<span className="shrink-0 text-putty">{Math.max(1, Math.round(f.size / 1024))} KB</span>
								</li>
							))}
						</ul>
					</details>
				</Panel>
			) : null}
		</>
	);
}

function CaseCellView({ cell, fileUrl }: { cell: TicketDetail["cases"][number]["cells"][EvidenceEnv]; fileUrl: (name: string) => string }) {
	if (!cell) return <td className="font-mono text-xs text-putty">—</td>;
	// "Pass" says nothing the chip doesn't; anything else the reporter wrote does.
	const resultText = cell.result;
	const showResult = resultText && !/^(pass|fail|skipped)$/i.test(resultText.trim());
	return (
		<td className="min-w-44">
			<div className="flex flex-col gap-1.5">
				<CaseVerdictChip verdict={cell.verdict} />
				{showResult ? <p className="text-xs text-putty">{resultText}</p> : null}
				{cell.note ? <p className="text-xs text-putty">{cell.note}</p> : null}
				<EvidenceMedia names={cell.media} url={fileUrl} />
			</div>
		</td>
	);
}
