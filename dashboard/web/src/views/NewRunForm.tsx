import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RUN_EFFORTS, RUN_MODELS, type RunEffort, type RunModel, type TestEnv } from "../../../shared/types";
import { ApiError } from "../state/api";
import { useRunsStore } from "../state/runsStore";
import { useUiConfig } from "../state/useUiConfig";

const DEFAULT_TICKET_PATTERN = "^[A-Z][A-Z0-9]*-\\d+$";

function envHelp(env: TestEnv, cap: number | undefined, held: number): string {
	if (cap !== undefined && held >= cap) {
		return `${env} is at capacity — the run will hold at the lock until a slot frees.`;
	}
	if (env === "demo") return "demo targets public sample apps and creates nothing.";
	return `Runs with TEST_ENV=${env} (.env.${env}). Picking it here is your approval to run against it.`;
}

export function NewRunForm() {
	const navigate = useNavigate();
	const createRun = useRunsStore((s) => s.createRun);
	const locks = useRunsStore((s) => s.locks);
	const config = useUiConfig().data;
	const envs = config?.envs ?? ["demo"];
	const ticketPattern = new RegExp(config?.ticketPattern ?? DEFAULT_TICKET_PATTERN);

	const [ticket, setTicket] = useState("");
	const [picked, setEnv] = useState<TestEnv | null>(null);
	const env = picked ?? envs[0] ?? "demo";
	const [freshWorktree, setFreshWorktree] = useState(true);
	const [baseBranch, setBaseBranch] = useState("");
	const [showBranch, setShowBranch] = useState(false);
	const [extraContext, setExtraContext] = useState("");
	const [showContext, setShowContext] = useState(false);
	const [model, setModel] = useState<RunModel | "">("");
	const [effort, setEffort] = useState<RunEffort | "">("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const normalized = ticket.trim().toUpperCase();
	const valid = ticketPattern.test(normalized);

	const submit = async (): Promise<void> => {
		if (!valid || busy) return;
		setBusy(true);
		setError(null);
		try {
			const run = await createRun({
				ticket: normalized,
				env,
				reuseCurrentWorktree: !freshWorktree,
				...(freshWorktree && baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}),
				...(extraContext.trim() ? { extraContext: extraContext.trim() } : {}),
				...(model ? { model } : {}),
				...(effort ? { effort } : {}),
			});
			navigate(`/runs/${run.id}`);
		} catch (err) {
			if (err instanceof ApiError && err.code === "onboarding_required") {
				navigate("/onboarding");
				return;
			}
			if (err instanceof ApiError && err.status === 409) {
				setError("A run for this ticket is already active.");
			} else {
				setError(err instanceof Error ? err.message : "The run could not start.");
			}
			setBusy(false);
		}
	};

	return (
		<div className="h-full overflow-y-auto p-6">
			<div className="mx-auto flex max-w-xl flex-col gap-5">
				<div className="eyebrow text-putty">New run</div>
				<form
					className="flex flex-col gap-5"
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
				>
					<fieldset className="fieldset">
						<legend id="ticket-label" className="fieldset-legend text-bone">
							Ticket
						</legend>
						<input
							id="ticket"
							aria-labelledby="ticket-label"
							className="input w-full bg-ink-1 font-mono"
							placeholder="ABC-123"
							value={ticket}
							onChange={(e) => setTicket(e.target.value)}
							autoFocus
							aria-invalid={Boolean(ticket) && !valid}
						/>
						{ticket && !valid ? (
							<p className="fieldset-label text-standby">Tickets match TICKET_PATTERN {ticketPattern.source}, e.g. ABC-123.</p>
						) : null}
					</fieldset>

					<fieldset className="fieldset">
						<legend className="fieldset-legend text-bone">Environment</legend>
						<div className="join">
							{envs.map((name) => {
								const cap = locks?.caps[name];
								const held = locks ? locks.held.filter((lease) => lease.env === name).length : 0;
								return (
									<button
										key={name}
										type="button"
										className={`btn join-item btn-sm font-mono uppercase ${env === name ? "btn-primary" : ""}`}
										aria-pressed={env === name}
										onClick={() => setEnv(name)}
									>
										{name}
										{cap !== undefined ? (
											<span className="text-[10px] normal-case">
												{held}/{cap}
											</span>
										) : null}
									</button>
								);
							})}
						</div>
						<p className="fieldset-label text-putty">
							{envHelp(env, locks?.caps[env], locks ? locks.held.filter((l) => l.env === env).length : 0)}
						</p>
					</fieldset>

					<fieldset className="fieldset">
						<legend className="fieldset-legend text-bone">Workspace</legend>
						<div className="join">
							<button
								type="button"
								className={`btn join-item btn-sm ${freshWorktree ? "btn-primary" : ""}`}
								aria-pressed={freshWorktree}
								onClick={() => setFreshWorktree(true)}
							>
								Fresh worktree
							</button>
							<button
								type="button"
								className={`btn join-item btn-sm ${freshWorktree ? "" : "btn-primary"}`}
								aria-pressed={!freshWorktree}
								onClick={() => setFreshWorktree(false)}
							>
								This checkout
							</button>
						</div>
						<p className="fieldset-label text-putty">
							{freshWorktree
								? `A dedicated worktree${valid ? ` for ${normalized}` : ""} — runs in parallel with other tickets. The first provision installs dependencies (a few minutes); reruns are instant.`
								: "Runs in the dashboard's own checkout — fastest, but only one ticket can safely work here at a time."}
						</p>
						{freshWorktree ? (
							showBranch ? (
								<label className="mt-1 flex items-center gap-2 text-xs text-putty">
									Base branch
									<input
										className="input input-sm bg-ink-1 font-mono"
										placeholder="dashboard's own branch"
										value={baseBranch}
										onChange={(e) => setBaseBranch(e.target.value)}
									/>
								</label>
							) : (
								<button
									type="button"
									className="btn btn-ghost btn-sm justify-self-start text-putty"
									onClick={() => setShowBranch(true)}
								>
									+ Change base branch
								</button>
							)
						) : null}
					</fieldset>

					<fieldset className="fieldset">
						<legend className="fieldset-legend text-bone">Session</legend>
						<div className="flex items-center gap-3">
							<label className="flex items-center gap-2 text-xs text-putty">
								Model
								<select
									className="select select-sm bg-ink-1 font-mono"
									value={model}
									onChange={(e) => setModel(e.target.value as RunModel | "")}
								>
									<option value="">server default</option>
									{RUN_MODELS.map((m) => (
										<option key={m} value={m}>
											{m}
										</option>
									))}
								</select>
							</label>
							<label className="flex items-center gap-2 text-xs text-putty">
								Effort
								<select
									className="select select-sm bg-ink-1 font-mono"
									value={effort}
									onChange={(e) => setEffort(e.target.value as RunEffort | "")}
								>
									<option value="">server default</option>
									{RUN_EFFORTS.map((level) => (
										<option key={level} value={level}>
											{level}
										</option>
									))}
								</select>
							</label>
						</div>
						<p className="fieldset-label text-putty">
							Runs default to sonnet — enough for the pipeline. Pick opus/fable only for gnarly tickets; haiku for
							cheap re-runs.
						</p>
					</fieldset>

					{showContext ? (
						<fieldset className="fieldset">
							<legend id="context-label" className="fieldset-legend text-bone">
								Extra context (optional)
							</legend>
							<textarea
								id="context"
								aria-labelledby="context-label"
								className="textarea w-full bg-ink-1"
								rows={4}
								placeholder="Scope hints, related tickets, known quirks"
								value={extraContext}
								onChange={(e) => setExtraContext(e.target.value)}
							/>
						</fieldset>
					) : (
						<button
							type="button"
							className="btn btn-ghost btn-sm self-start text-putty"
							onClick={() => setShowContext(true)}
						>
							+ Add extra context
						</button>
					)}

					<p className="text-xs text-putty">
						The run executes as a real Claude session in {freshWorktree ? "its own worktree" : "this repo checkout"}.
						It stops and asks before anything is posted to Jira, Zephyr, or Confluence.
					</p>
					{error ? <div className="alert alert-error py-2 text-sm">{error}</div> : null}
					<button type="submit" className="btn btn-primary self-start" disabled={!valid || busy}>
						{busy ? <span className="loading loading-spinner loading-sm" aria-hidden /> : null}
						{busy ? "Starting the session…" : "Start run"}
					</button>
				</form>
			</div>
		</div>
	);
}
