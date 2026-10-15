import { useEffect, useRef, useState } from "react";
import type { RunEvent, RunRecord, TestResultsSummary } from "../../../shared/types";
import { ACTIVE_STATES } from "../../../shared/types";
import { baseName, deriveArtifacts } from "../derive";
import { formatDuration } from "../format";
import { renderMarkdown } from "../markdown";
import { fetchResults, fetchThumbs, type ThumbMeta } from "../state/api";
import { WorkerThumb } from "./WorkerThumb";

type FeedTab = "live" | "dailies" | "results";

const TABS: Array<{ id: FeedTab; label: string }> = [
	{ id: "live", label: "Live" },
	{ id: "dailies", label: "Dailies" },
	{ id: "results", label: "Results" },
];

export function LiveFeedPanel({ run, events }: { run: RunRecord; events: RunEvent[] }) {
	const [tab, setTab] = useState<FeedTab>("live");
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

	// WAI-ARIA tablist: arrow keys move focus + selection, Tab leaves the list.
	const onTablistKeyDown = (e: React.KeyboardEvent): void => {
		const current = TABS.findIndex((t) => t.id === tab);
		let next: number;
		if (e.key === "ArrowRight") next = (current + 1) % TABS.length;
		else if (e.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = TABS.length - 1;
		else return;
		e.preventDefault();
		const def = TABS[next];
		if (!def) return;
		setTab(def.id);
		tabRefs.current[next]?.focus();
	};

	return (
		<aside className="flex min-h-0 flex-col border-l border-line bg-ink-1" aria-label="Feed">
			<div role="tablist" className="tabs tabs-border shrink-0 border-b border-line px-2" onKeyDown={onTablistKeyDown}>
				{TABS.map(({ id, label }, i) => (
					<button
						key={id}
						ref={(el) => {
							tabRefs.current[i] = el;
						}}
						type="button"
						role="tab"
						id={`feed-tab-${id}`}
						aria-selected={tab === id}
						aria-controls={`feed-panel-${id}`}
						tabIndex={tab === id ? 0 : -1}
						className={`tab eyebrow ${tab === id ? "tab-active text-bone" : "text-putty"}`}
						onClick={() => setTab(id)}
					>
						{label}
					</button>
				))}
			</div>
			<div
				id={`feed-panel-${tab}`}
				role="tabpanel"
				aria-labelledby={`feed-tab-${tab}`}
				className="min-h-0 flex-1 overflow-y-auto p-3"
			>
				{tab === "live" ? <LivePane run={run} /> : null}
				{tab === "dailies" ? <DailiesPane events={events} /> : null}
				{tab === "results" ? <ResultsPane run={run} /> : null}
			</div>
		</aside>
	);
}

function Empty({ text }: { text: string }) {
	return <p className="p-2 text-sm text-putty">{text}</p>;
}

function LivePane({ run }: { run: RunRecord }) {
	const [workers, setWorkers] = useState<ThumbMeta[] | null>(null);
	const active = ACTIVE_STATES.includes(run.state);

	useEffect(() => {
		let alive = true;
		const poll = (): void => {
			fetchThumbs(run.id)
				.then((res) => {
					if (alive) setWorkers(res.workers);
				})
				.catch(() => {
					if (alive) setWorkers((prev) => prev ?? []);
				});
		};
		poll();
		// Always register the cleanup (even when inactive, i.e. no interval) so a
		// pending fetch can't setState after unmount.
		const timer = active ? window.setInterval(poll, 1400) : undefined;
		return () => {
			alive = false;
			if (timer !== undefined) window.clearInterval(timer);
		};
	}, [run.id, active]);

	if (workers === null) {
		return <div className="skeleton h-40 w-full bg-ink-2" aria-label="Loading feed" />;
	}
	if (workers.length === 0) {
		return <Empty text="No browser feed yet. Frames appear here while Playwright drives a test." />;
	}
	return (
		<div className="flex flex-col gap-3">
			{workers.map((w) => (
				<WorkerThumb
					key={w.worker}
					url={`/api/runs/${run.id}/thumbs/${w.worker}`}
					streamUrl={`/api/runs/${run.id}/thumbs/${w.worker}/stream`}
					caption={w.title ?? `worker ${w.worker}`}
					live={active}
					dim={!active}
				/>
			))}
			{!active ? <p className="text-xs text-putty">Run ended — showing the last captured frame.</p> : null}
		</div>
	);
}

function DailiesPane({ events }: { events: RunEvent[] }) {
	const artifacts = deriveArtifacts(events);
	const videos = artifacts.filter((a) => a.ref.kind === "video");
	const shots = artifacts.filter((a) => a.ref.kind === "screenshot");
	const summary = artifacts.find((a) => a.ref.kind === "summary");
	const [summaryHtml, setSummaryHtml] = useState<string | null>(null);

	useEffect(() => {
		if (!summary) return;
		let alive = true;
		fetch(summary.ref.url)
			.then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
			.then((text) => {
				if (alive) setSummaryHtml(renderMarkdown(text));
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [summary?.ref.url]);

	if (videos.length === 0 && shots.length === 0 && !summary) {
		return <Empty text="No dailies yet. Evidence lands here as each test wraps." />;
	}
	return (
		<div className="flex flex-col gap-3">
			{videos.map((v) => (
				<figure key={v.ref.relPath}>
					<video className="w-full rounded border border-line" controls preload="metadata" src={v.ref.url} />
					<figcaption className="mt-1 truncate font-mono text-[11px] text-putty">{baseName(v.ref.relPath)}</figcaption>
				</figure>
			))}
			{shots.length > 0 ? (
				<div className="grid grid-cols-2 gap-2">
					{shots.map((s) => (
						<a
							key={s.ref.relPath}
							href={s.ref.url}
							target="_blank"
							rel="noopener noreferrer"
							title={baseName(s.ref.relPath)}
							className="block overflow-hidden rounded border border-line"
						>
							<img className="aspect-video w-full object-cover" src={s.ref.url} alt={baseName(s.ref.relPath)} loading="lazy" />
						</a>
					))}
				</div>
			) : null}
			{summaryHtml ? (
				<div className="rounded border border-line bg-ink-0 p-3">
					<span className="eyebrow text-putty">Summary</span>
					<div className="md mt-2 text-sm" dangerouslySetInnerHTML={{ __html: summaryHtml }} />
				</div>
			) : null}
		</div>
	);
}

const OUTCOME_CLASS: Record<string, string> = {
	passed: "text-ok",
	expected: "text-ok",
	failed: "text-fault",
	unexpected: "text-fault",
	timedOut: "text-fault",
	interrupted: "text-standby",
	flaky: "text-standby",
	skipped: "text-putty",
};

function ResultsPane({ run }: { run: RunRecord }) {
	const [results, setResults] = useState<TestResultsSummary | null>(null);
	const active = ACTIVE_STATES.includes(run.state);

	useEffect(() => {
		let alive = true;
		const poll = (): void => {
			fetchResults(run.id)
				.then((res) => {
					if (alive) setResults(res);
				})
				.catch(() => {});
		};
		poll();
		// Always register the cleanup (even when inactive, i.e. no interval) so a
		// pending fetch can't setState after unmount.
		const timer = active ? window.setInterval(poll, 5000) : undefined;
		return () => {
			alive = false;
			if (timer !== undefined) window.clearInterval(timer);
		};
	}, [run.id, active]);

	if (!results || results.status === "unknown") {
		return <Empty text="No test results yet. This fills in once a Playwright run finishes." />;
	}
	const statusClass = results.status === "passed" ? "text-ok" : results.status === "failed" ? "text-fault" : "text-standby";
	return (
		<div className="flex flex-col gap-2">
			<div className={`eyebrow ${statusClass}`}>{results.status}</div>
			{results.tests && results.tests.length > 0 ? (
				<table className="table table-xs">
					<thead>
						<tr className="text-putty">
							<th>Test</th>
							<th>Outcome</th>
							<th>Time</th>
						</tr>
					</thead>
					<tbody>
						{results.tests.map((t, i) => (
							<tr key={`${i}-${t.title}`}>
								<td className="max-w-48 truncate" title={t.title}>
									{t.title}
								</td>
								<td className={`font-mono ${OUTCOME_CLASS[t.outcome] ?? "text-feed"}`}>{t.outcome}</td>
								<td className="font-mono">{formatDuration(t.durationMs)}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : null}
			{results.failedTests.length > 0 ? (
				<ul className="list-inside list-disc text-xs text-fault">
					{results.failedTests.map((t) => (
						<li key={t}>{t}</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
