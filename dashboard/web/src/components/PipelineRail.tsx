import { useState } from "react";
import { PIPELINE_STEPS, PROVISION_STEP } from "../../../shared/pipeline";
import type { ArtifactRef, StepState } from "../../../shared/types";
import type { StepArtifact } from "../derive";
import { baseName } from "../derive";
import { formatDuration } from "../format";
import { ProvisionLog } from "./ProvisionLog";

function dot(step: StepState, executing: boolean, runActive: boolean) {
	if (step.status === "active" && runActive) {
		return (
			<span
				className={`loading loading-spinner loading-xs shrink-0 ${executing ? "text-tally" : "text-feed"}`}
				aria-hidden
			/>
		);
	}
	const cls =
		step.status === "done"
			? "bg-ok"
			: step.status === "active" || step.status === "blocked"
				? "bg-standby" // run ended mid-step — the operator decides what happens next
				: step.status === "skipped"
					? "bg-putty opacity-40"
					: "bg-line";
	return <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden />;
}

/** Link priority when a test's files collapse into one chip. */
const KIND_PRIORITY: Partial<Record<ArtifactRef["kind"], number>> = { screenshot: 0, video: 1, trace: 2 };

const CHIP_LIMIT = 6;

interface Chip {
	key: string;
	label: string;
	url: string;
	title: string;
}

/** One test writes <stem>.png, <stem>.webm and <stem>-trace.zip — same stem. */
function chipStem(relPath: string): string {
	return baseName(relPath)
		.replace(/\.[a-z0-9]+$/i, "")
		.replace(/-trace$/, "");
}

/**
 * Collapse a test's screenshot/video/trace trio into a single chip linking to
 * its best artifact; everything else (summary, json) stays one chip per file.
 */
function groupChips(artifacts: StepArtifact[]): Chip[] {
	const byStem = new Map<string, ArtifactRef[]>();
	const singles: Chip[] = [];
	for (const { ref } of artifacts) {
		if (KIND_PRIORITY[ref.kind] === undefined) {
			const label = baseName(ref.relPath);
			singles.push({ key: ref.relPath, label, url: ref.url, title: label });
			continue;
		}
		const stem = chipStem(ref.relPath);
		const refs = byStem.get(stem);
		if (refs) refs.push(ref);
		else byStem.set(stem, [ref]);
	}
	const groups = [...byStem.entries()].flatMap(([stem, refs]) => {
		refs.sort((a, b) => (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9));
		const best = refs[0];
		if (!best) return []; // unreachable — every stem group is created with one ref
		return [
			{
				key: stem,
				label: stem,
				url: best.url,
				title: `${stem} (${refs.map((r) => r.kind).join(", ")})`,
			},
		];
	});
	return [...groups, ...singles];
}

function StepChips({ artifacts }: { artifacts: StepArtifact[] }) {
	const [expanded, setExpanded] = useState(false);
	const chips = groupChips(artifacts);
	const visible = expanded ? chips : chips.slice(0, CHIP_LIMIT);
	const hidden = chips.length - visible.length;
	return (
		<div className="mt-1 flex flex-wrap gap-1">
			{visible.map((c) => (
				<a
					key={c.key}
					className="badge badge-ghost badge-sm max-w-40"
					href={c.url}
					title={c.title}
					target="_blank"
					rel="noopener noreferrer"
				>
					{/* text-overflow needs a block child — it has no effect on the badge's flex box */}
					<span className="truncate">{c.label}</span>
				</a>
			))}
			{hidden > 0 ? (
				<button type="button" className="badge badge-ghost badge-sm" onClick={() => setExpanded(true)}>
					+{hidden} more
				</button>
			) : null}
			{expanded && chips.length > CHIP_LIMIT ? (
				<button type="button" className="badge badge-ghost badge-sm" onClick={() => setExpanded(false)}>
					show less
				</button>
			) : null}
		</div>
	);
}

export function PipelineRail({
	steps,
	artifacts,
	executing,
	runActive,
	provisionLines = [],
	provisioning = false,
}: {
	steps: StepState[];
	artifacts: StepArtifact[];
	executing: boolean;
	runActive: boolean;
	/** Step 0's streamed workspace log (provision events). */
	provisionLines?: string[];
	/** True while the run is in the provisioning state — keeps the log open. */
	provisioning?: boolean;
}) {
	// Step 0 exists only on provisioned runs — the rail shows it only then.
	const defs = steps.some((s) => s.step === 0) ? [PROVISION_STEP, ...PIPELINE_STEPS] : PIPELINE_STEPS;
	return (
		<aside className="overflow-y-auto border-r border-line bg-ink-1" aria-label="Pipeline">
			<div className="eyebrow border-b border-line px-4 py-3 text-putty">Pipeline</div>
			<ol>
				{defs.map((def) => {
					const state = steps.find((s) => s.step === def.step) ?? { step: def.step, status: "pending" as const };
					const chips = artifacts.filter((a) => a.step === def.step);
					const duration =
						state.startedAt && state.endedAt ? Date.parse(state.endedAt) - Date.parse(state.startedAt) : null;
					const muted = state.status === "pending" || state.status === "skipped";
					return (
						<li key={def.step} className="flex gap-2.5 border-b border-line/50 px-4 py-2.5">
							{dot(state, executing, runActive)}
							{/* blocked/skipped already announce via visible text */}
							{state.status === "blocked" || state.status === "skipped" ? null : (
								<span className="sr-only">{state.status}</span>
							)}
							<div className="min-w-0 flex-1">
								<div className={`flex flex-wrap items-center gap-1.5 text-[13px] ${muted ? "text-putty" : "text-bone"}`}>
									{def.title}
									{duration !== null ? (
										<span className="font-mono text-[11px] text-putty">{formatDuration(duration)}</span>
									) : null}
									{state.status === "blocked" ? (
										<span className="badge badge-warning badge-xs uppercase">gate</span>
									) : null}
									{state.status === "skipped" ? <span className="text-[11px] text-putty">skipped</span> : null}
								</div>
								{state.detail ? <div className="truncate font-mono text-[11px] text-putty">{state.detail}</div> : null}
								{def.step === 0 ? <ProvisionLog lines={provisionLines} live={provisioning} /> : null}
								{chips.length > 0 ? <StepChips artifacts={chips} /> : null}
							</div>
						</li>
					);
				})}
			</ol>
		</aside>
	);
}
