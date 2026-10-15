import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { BugSummary, JiraIssueInfo } from "../../../shared/types";
import { BUG_GROUPS, bugGroup, type BugGroup } from "../board";
import { EvidenceMedia } from "../components/EvidenceMedia";
import { LoadState } from "../components/LoadState";
import { TrackerLink } from "../components/TrackerLink";
import { JiraChip, StatusChip, type Tone } from "../components/Verdict";
import { formatAgo } from "../format";
import { fetchBugs, ticketFileUrl } from "../state/api";
import { useJira } from "../state/useJira";
import { useLoad } from "../state/useLoad";


const GROUP_TONE: Record<BugGroup, Tone> = {
	retest: "standby",
	"retest-failed": "fault",
	open: "feed",
	fixed: "ok",
};

/** Bugs raised from findings and failing cases, grouped by what they need next. */
export function BugsView() {
	const bugs = useLoad(fetchBugs, "bugs");
	const jira = useJira();

	const groups = useMemo(() => {
		const out = new Map<BugGroup, BugSummary[]>(BUG_GROUPS.map((g) => [g.id, []]));
		for (const bug of bugs.data ?? []) out.get(bugGroup(bug, jira.data?.issues[bug.key]))!.push(bug);
		return out;
	}, [bugs.data, jira.data]);

	return (
		<section className="h-full overflow-y-auto p-4">
			<div className="mx-auto flex max-w-6xl flex-col gap-4">
				<div className="flex items-center gap-3">
					<div className="eyebrow text-putty">Bugs</div>
					{bugs.data ? <span className="font-mono text-xs text-putty">{bugs.data.length}</span> : null}
					<span className="ml-auto font-mono text-xs text-putty" aria-live="polite">
						{jira.loading ? "Fetching Jira status…" : ""}
					</span>
					<button
						type="button"
						className="btn btn-sm"
						onClick={() => {
							bugs.reload();
							jira.refresh();
						}}
					>
						Refresh
					</button>
				</div>
				{jira.data && !jira.data.ok ? (
					<div className="alert alert-warning py-2 text-sm">
						<span>{jira.data.error} Grouping uses the evidence only until then.</span>
					</div>
				) : null}
				<LoadState loading={bugs.loading && !bugs.data} error={bugs.error} onRetry={bugs.reload} />
				{bugs.data && bugs.data.length === 0 ? (
					<p className="py-24 text-center text-putty">
						No bugs yet. A finding or case with a <span className="font-mono">ticket</span> key in comment-rows.json shows up here.
					</p>
				) : null}
				{BUG_GROUPS.map((g) => {
					const list = groups.get(g.id) ?? [];
					if (list.length === 0) return null;
					return (
						<section key={g.id} className="rounded-lg border border-line bg-ink-1 p-4">
							<h2 className="eyebrow mb-1 flex items-center gap-2 text-bone">
								<StatusChip tone={GROUP_TONE[g.id]} label={g.label} />
								<span className="font-mono text-[11px] normal-case text-putty">{list.length}</span>
							</h2>
							<p className="mb-3 text-xs text-putty">{g.hint}</p>
							<ul className="grid gap-3 md:grid-cols-2">
								{list.map((bug) => (
									<BugCard key={bug.key} bug={bug} jira={jira.data?.issues[bug.key]} />
								))}
							</ul>
						</section>
					);
				})}
			</div>
		</section>
	);
}

function BugCard({ bug, jira }: { bug: BugSummary; jira: JiraIssueInfo | undefined }) {
	// One still is enough on a card; the full set is on the parent ticket's page.
	const still = bug.media.find((m) => /\.(png|jpe?g)$/i.test(m.name));
	return (
		<li className="flex flex-col gap-2 rounded border border-line bg-ink-2 p-3">
			<div className="flex flex-wrap items-center gap-2">
				<TrackerLink ticket={bug.key} className="font-mono text-xs text-bone" />
				<JiraChip info={jira} />
				{bug.updatedAt ? (
					<span className="ml-auto font-mono text-[11px] text-putty" title={bug.updatedAt}>
						{formatAgo(bug.updatedAt)}
					</span>
				) : null}
			</div>
			<p className="text-sm font-medium">{bug.title ?? jira?.summary ?? "—"}</p>
			<p className="text-xs text-putty">
				Raised from{" "}
				{bug.raisedFrom.map((r, i) => (
					<span key={`${r.ticket}-${r.tc ?? i}`}>
						{i > 0 ? ", " : ""}
						<Link className="link font-mono text-feed" to={`/tickets/${r.ticket}`}>
							{r.ticket}
						</Link>
						{r.tc ? <span className="font-mono"> {r.tc}</span> : null}
					</span>
				))}
				{bug.hasFolder ? (
					<>
						{" · "}
						<Link className="link text-feed" to={`/tickets/${bug.key}`}>
							bug evidence
						</Link>
					</>
				) : null}
			</p>
			{bug.description ? <p className="line-clamp-3 text-xs">{bug.description}</p> : null}
			{bug.replicate.length > 0 ? (
				<details className="text-xs text-putty">
					<summary className="cursor-pointer">Steps to reproduce</summary>
					<ol className="mt-1 list-decimal pl-4">
						{bug.replicate.map((s, n) => (
							<li key={n}>{s}</li>
						))}
					</ol>
				</details>
			) : null}
			{still ? <EvidenceMedia names={[still.name]} url={(name) => ticketFileUrl(still.ticket, name)} /> : null}
		</li>
	);
}
