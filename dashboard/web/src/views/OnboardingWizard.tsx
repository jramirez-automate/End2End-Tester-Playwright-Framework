import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DoctorCheck, DoctorReport } from "../../../shared/types";
import { CredentialsEditor } from "../components/CredentialsEditor";
import { NotificationsSection } from "../components/NotificationsSection";
import { fetchDoctor, probeLogin } from "../state/api";

/**
 * First-run onboarding: doctor checks with fix-it hints, credentials, and
 * notifications. Required checks gate new runs (the server answers 409
 * onboarding_required until they pass). Re-runnable from Settings anytime.
 */
export function OnboardingWizard() {
	const [report, setReport] = useState<DoctorReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);

	const refresh = useCallback((fresh: boolean) => {
		setChecking(true);
		fetchDoctor(fresh)
			.then((r) => {
				setReport(r);
				setError(null);
			})
			.catch((err: unknown) => setError(err instanceof Error ? err.message : "Doctor unavailable."))
			.finally(() => setChecking(false));
	}, []);
	useEffect(() => refresh(false), [refresh]);

	return (
		<div className="h-full overflow-y-auto p-6">
			<div className="mx-auto flex max-w-2xl flex-col gap-6">
				<div>
					<div className="eyebrow text-putty">Onboarding</div>
					<p className="mt-1 text-sm text-putty">
						The console needs a working CLI, a reachable repo and credentials before it can put a run on air. Fix
						anything marked FAULT; advisories can wait.
					</p>
				</div>

				<section className="rounded-lg border border-line bg-ink-1 p-4">
					<div className="mb-3 flex items-center gap-3">
						<h2 className="eyebrow text-bone">1 · Doctor</h2>
						{report ? (
							<span className={`eyebrow ${report.requiredOk ? "text-ok" : "text-fault"}`}>
								{report.requiredOk ? "ready" : "blocked"}
							</span>
						) : null}
						<button type="button" className="btn btn-primary btn-sm ml-auto" disabled={checking} onClick={() => refresh(true)}>
							{checking ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
							Run checks again
						</button>
					</div>
					{error ? <p className="text-sm text-fault">{error}</p> : null}
					{!report && !error ? <div className="skeleton h-24 w-full bg-ink-2" /> : null}
					{report ? (
						<ul className="flex flex-col gap-2">
							{report.checks.map((check) => (
								<DoctorRow key={check.id} check={check} onProbed={() => refresh(true)} />
							))}
						</ul>
					) : null}
				</section>

				<section className="rounded-lg border border-line bg-ink-1 p-4">
					<h2 className="eyebrow mb-3 text-bone">2 · Credentials</h2>
					<CredentialsEditor />
				</section>

				<section className="rounded-lg border border-line bg-ink-1 p-4">
					<h2 className="eyebrow mb-3 text-bone">3 · Notifications</h2>
					<NotificationsSection />
				</section>

				<p className="text-sm text-putty">
					All set?{" "}
					<Link className="link text-feed" to="/new">
						Start your first run
					</Link>{" "}
					or head back to the{" "}
					<Link className="link text-feed" to="/wall">
						wall
					</Link>
					.
				</p>
			</div>
		</div>
	);
}

function DoctorRow({ check, onProbed }: { check: DoctorCheck; onProbed: () => void }) {
	const [probing, setProbing] = useState(false);
	const [probeDetail, setProbeDetail] = useState<string | null>(null);

	const tone = check.unknown ? "bg-putty" : check.ok ? "bg-ok" : check.required ? "bg-fault" : "bg-standby";
	const status = check.unknown ? "not tested" : check.ok ? "ok" : check.required ? "failing" : "warning";

	const runLoginProbe = (): void => {
		setProbing(true);
		setProbeDetail(null);
		probeLogin()
			.then((result) => {
				setProbeDetail(result.detail);
				onProbed();
			})
			.catch((err: unknown) => setProbeDetail(err instanceof Error ? err.message : "probe failed"))
			.finally(() => setProbing(false));
	};

	return (
		<li className="flex flex-col gap-0.5 rounded border border-line bg-ink-0 px-3 py-2">
			<div className="flex items-center gap-2 text-sm">
				<span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden />
				<span className="sr-only">{status}</span>
				<span className="font-medium">{check.label}</span>
				{check.required ? <span className="eyebrow text-putty">required</span> : null}
				{check.detail ? <span className="min-w-0 truncate font-mono text-xs text-putty">{check.detail}</span> : null}
				{check.id === "login" ? (
					<button type="button" className="btn btn-xs ml-auto" disabled={probing} onClick={runLoginProbe}>
						{probing ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
						{probing ? "Probing…" : "Run login probe"}
					</button>
				) : null}
			</div>
			{!check.ok || check.unknown ? <p className="pl-4 text-xs text-putty">{check.hint}</p> : null}
			{probeDetail ? <p className="pl-4 text-xs text-putty">{probeDetail}</p> : null}
			{check.id === "login" ? (
				<p className="pl-4 text-[11px] text-putty">The probe sends one tiny real prompt to prove the login.</p>
			) : null}
		</li>
	);
}
