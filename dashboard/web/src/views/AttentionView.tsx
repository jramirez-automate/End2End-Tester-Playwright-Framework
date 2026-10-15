import { useMemo } from "react";
import { Link } from "react-router-dom";
import { attentionItems, ATTENTION_SECTIONS, orderEnvs, type AttentionItem, type AttentionKind } from "../board";
import { LoadState } from "../components/LoadState";
import { type Tone, StatusChip } from "../components/Verdict";
import { formatAgo } from "../format";
import { fetchBugs, fetchExternalPipelines, fetchTickets } from "../state/api";
import { useRunsStore } from "../state/runsStore";
import { useJira } from "../state/useJira";
import { useUiConfig } from "../state/useUiConfig";
import { useLoad } from "../state/useLoad";

const SECTION_TONE: Record<AttentionKind, Tone> = {
	gate: "standby",
	blocked: "standby",
	"bug-retest": "feed",
	"ready-for-test": "feed",
	failing: "fault",
	"awaiting-final": "idle",
};

const loadDisk = () => Promise.all([fetchTickets(), fetchBugs(), fetchExternalPipelines()]);

/**
 * Home: everything waiting on you, across dashboard runs, terminal pipelines,
 * evidence and Jira. Evidence renders first; Jira statuses merge in when they
 * land (or the page says why they didn't).
 */
export function AttentionView() {
	const disk = useLoad(loadDisk, "attention");
	const jira = useJira();
	const runs = useRunsStore((s) => s.runs);
	const configured = useUiConfig().data?.envs;

	const items = useMemo(() => {
		if (!disk.data) return [];
		const [tickets, bugs, external] = disk.data;
		return attentionItems({
			envs: orderEnvs(configured ?? [], tickets.tickets),
			tickets: tickets.tickets,
			bugs,
			external,
			jira: jira.data?.issues ?? {},
			runs: Object.values(runs),
		});
	}, [disk.data, jira.data, runs, configured]);

	const reload = () => {
		disk.reload();
		jira.refresh();
	};

	return (
		<section className="h-full overflow-y-auto p-4">
			<div className="mx-auto flex max-w-5xl flex-col gap-4">
				<div className="flex flex-wrap items-center gap-3">
					<div className="eyebrow text-putty">Needs attention</div>
					{disk.data ? <span className="font-mono text-xs text-putty">{items.length}</span> : null}
					<span className="ml-auto font-mono text-xs text-putty" aria-live="polite">
						{jira.loading ? "Fetching Jira status…" : jira.data?.ok ? `Jira ${formatAgo(jira.data.fetchedAt ?? "")}` : ""}
					</span>
					<button type="button" className="btn btn-sm" onClick={reload}>
						Refresh
					</button>
				</div>

				{jira.data && !jira.data.ok ? (
					<div className="alert alert-warning py-2 text-sm">
						<span>{jira.data.error} Jira-based items are hidden until then.</span>
					</div>
				) : null}

				<LoadState loading={disk.loading && !disk.data} error={disk.error} onRetry={disk.reload} />

				{disk.data && items.length === 0 ? (
					<p className="py-24 text-center text-putty">Nothing waiting on you. Every pipeline, bug and ticket is clear.</p>
				) : null}

				{ATTENTION_SECTIONS.map((section) => {
					const list = items.filter((i) => i.kind === section.id);
					if (list.length === 0) return null;
					return <AttentionSection key={section.id} label={section.label} tone={SECTION_TONE[section.id]} items={list} />;
				})}
			</div>
		</section>
	);
}

function AttentionSection({ label, tone, items }: { label: string; tone: Tone; items: AttentionItem[] }) {
	return (
		<section className="rounded-lg border border-line bg-ink-1 p-4">
			<h2 className="eyebrow mb-3 flex items-center gap-2 text-bone">
				<StatusChip tone={tone} label={label} />
				<span className="font-mono text-[11px] normal-case text-putty">{items.length}</span>
			</h2>
			<ul className="flex flex-col divide-y divide-line">
				{items.map((item) => (
					<li key={`${item.kind}-${item.key}`}>
						<Link to={item.href} className="flex flex-col gap-0.5 rounded px-2 py-2 hover:bg-ink-2 sm:flex-row sm:items-baseline sm:gap-3">
							<span className="w-24 shrink-0 font-mono text-xs text-bone">{item.key}</span>
							<span className="min-w-0 flex-1">
								{item.title ? <span className="block truncate text-sm">{item.title}</span> : null}
								<span className="block text-xs text-putty">{item.detail}</span>
							</span>
							{item.at ? (
								<span className="shrink-0 font-mono text-xs text-putty" title={item.at}>
									{formatAgo(item.at)}
								</span>
							) : null}
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
