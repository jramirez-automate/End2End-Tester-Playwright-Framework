import { useState } from "react";
import type { RunEvent, RunRecord } from "../../../shared/types";
import { deriveActionLog, latestActionOutcomes } from "../derive";
import { useRunsStore } from "../state/runsStore";
import { LogBox } from "./ProvisionLog";

/**
 * Operator actions on an ended run: rerun what failed, recapture evidence,
 * and the publish steps. Publish actions are two-step — the first click is
 * always a dry run streaming its preview here; the amber confirm appears only
 * after that dry run finishes (amber = needs-the-operator, same as gates).
 */
const RERUN_ACTIONS = [
	{ id: "rerun-failing", label: "Rerun failing" },
	{ id: "recapture-evidence", label: "Recapture evidence" },
] as const;

const PUBLISH_ACTIONS = [
	{ id: "attach", label: "Attach media" },
	{ id: "post-comment", label: "Post comment" },
	{ id: "mark-pass", label: "Record in test management" },
	{ id: "plan", label: "Wiki plan" },
] as const;

export function PartialActions({ run, events }: { run: RunRecord; events: RunEvent[] }) {
	const runAction = useRunsStore((s) => s.runAction);
	const abortAction = useRunsStore((s) => s.abortAction);
	const busy = useRunsStore((s) => s.actionBusy[run.id] ?? null);
	const [error, setError] = useState<string | null>(null);

	const log = deriveActionLog(events);
	const outcomes = latestActionOutcomes(log);

	const trigger = (action: string, dryRun?: boolean): void => {
		setError(null);
		runAction(run.id, action, dryRun === undefined ? undefined : { dryRun }).catch((err: unknown) => {
			setError(err instanceof Error ? err.message : "The action could not start.");
		});
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="eyebrow text-putty">Actions</span>
				{RERUN_ACTIONS.map(({ id, label }) => (
					<ActionChip key={id} label={label} running={busy === id} disabled={busy !== null} onClick={() => trigger(id)} />
				))}
				<span className="h-4 w-px bg-line" aria-hidden />
				{PUBLISH_ACTIONS.map(({ id, label }) => {
					const last = outcomes.get(id);
					const dryRunClean = last?.dryRun === true && last.ok === true;
					return (
						<span key={id} className="flex items-center gap-1">
							<ActionChip
								label={dryRunClean ? `${label} (dry run again)` : `${label} (dry run)`}
								running={busy === id}
								disabled={busy !== null}
								onClick={() => trigger(id, true)}
							/>
							{dryRunClean ? (
								<button
									type="button"
									className="btn btn-primary btn-sm"
									disabled={busy !== null}
									onClick={() => trigger(id, false)}
								>
									Post for real
								</button>
							) : null}
						</span>
					);
				})}
				{busy ? (
					<button type="button" className="btn btn-ghost btn-sm ml-auto text-putty" onClick={() => void abortAction(run.id)}>
						Stop {busy}
					</button>
				) : null}
			</div>
			{error ? <p className="text-xs text-fault">{error}</p> : null}
			{log.length > 0 ? <LogBox lines={log.map((e) => e.line)} follow={busy !== null} /> : null}
		</div>
	);
}

function ActionChip({
	label,
	running,
	disabled,
	title,
	onClick,
}: {
	label: string;
	running: boolean;
	disabled: boolean;
	title?: string;
	onClick: () => void;
}) {
	return (
		<button type="button" className="btn btn-sm" disabled={disabled} title={title} onClick={onClick}>
			{running ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
			{label}
		</button>
	);
}
