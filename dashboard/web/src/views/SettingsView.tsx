import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { StatusReport } from "../../../shared/types";
import { CredentialsEditor } from "../components/CredentialsEditor";
import { NotificationsSection } from "../components/NotificationsSection";
import { setTheme, THEMES, useTheme } from "../theme";

export function SettingsView() {
	const [status, setStatus] = useState<StatusReport | null>(null);
	const [statusError, setStatusError] = useState<string | null>(null);
	const theme = useTheme();

	useEffect(() => {
		let alive = true;
		fetch("/api/status")
			.then((res) => (res.ok ? (res.json() as Promise<StatusReport>) : Promise.reject(new Error(res.statusText))))
			.then((report) => {
				if (alive) setStatus(report);
			})
			.catch((err: unknown) => {
				if (alive) setStatusError(err instanceof Error ? err.message : "Status unavailable.");
			});
		return () => {
			alive = false;
		};
	}, []);

	return (
		<div className="h-full overflow-y-auto p-6">
			<div className="mx-auto flex max-w-2xl flex-col gap-6">
				<div className="eyebrow text-putty">Settings</div>

				<section className="rounded-lg border border-line bg-ink-1 p-4">
					<h2 className="eyebrow mb-3 text-bone">Appearance</h2>
					<div className="flex flex-col gap-2" role="radiogroup" aria-label="Theme">
						{THEMES.map((t) => (
							<label key={t.id} className="flex cursor-pointer items-center gap-3 text-sm">
								<input
									type="radio"
									name="theme"
									className="radio radio-sm"
									checked={theme === t.id}
									onChange={() => setTheme(t.id)}
								/>
								<span className="font-medium">{t.label}</span>
								<span className="text-xs text-putty">{t.hint}</span>
							</label>
						))}
					</div>
				</section>

				<section className="rounded-lg border border-line bg-ink-1 p-4">
					<h2 className="eyebrow mb-3 text-bone">Notifications</h2>
					<NotificationsSection />
				</section>

				<section className="rounded-lg border border-line bg-ink-1 p-4">
					<h2 className="eyebrow mb-3 text-bone">Integrations</h2>
					{statusError ? <p className="text-sm text-fault">{statusError}</p> : null}
					{!status && !statusError ? (
						<div className="flex flex-col gap-2">
							<div className="skeleton h-6 w-full bg-ink-2" />
							<div className="skeleton h-6 w-2/3 bg-ink-2" />
						</div>
					) : null}
					{status ? (
						<div className="flex flex-col gap-4">
							<div className="flex items-center gap-2 text-sm">
								<span className={`h-2 w-2 rounded-full ${status.claude.ok ? "bg-ok" : "bg-fault"}`} aria-hidden />
								{status.claude.ok ? <span className="sr-only">ok</span> : null}
								<span className="font-medium">Claude CLI</span>
								<span className="font-mono text-xs text-putty">
									{status.claude.ok ? (status.claude.version ?? status.claude.bin) : "not found"}
								</span>
							</div>

							<div>
								<h3 className="mb-1 text-sm font-medium">MCP servers</h3>
								{status.mcp.length === 0 ? (
									<p className="text-xs text-putty">None detected.</p>
								) : (
									<ul className="flex flex-col gap-1">
										{status.mcp.map((server) => (
											<li key={server.name} className="flex items-center gap-2 text-xs">
												<span
													className={`h-1.5 w-1.5 rounded-full ${
														server.status.toLowerCase().includes("connect") ? "bg-ok" : "bg-standby"
													}`}
													aria-hidden
												/>
												<span className="font-mono">{server.name}</span>
												<span className="text-putty">{server.transport}</span>
												<span className="text-putty">{server.status}</span>
											</li>
										))}
									</ul>
								)}
							</div>

							{status.notes.length > 0 ? (
								<div className="alert alert-warning py-2 text-xs">
									<ul>
										{status.notes.map((note) => (
											<li key={note}>{note}</li>
										))}
									</ul>
								</div>
							) : null}
						</div>
					) : null}
				</section>

				<section className="rounded-lg border border-line bg-ink-1 p-4">
					<h2 className="eyebrow mb-3 text-bone">Credentials</h2>
					<CredentialsEditor />
				</section>

				<p className="text-sm text-putty">
					Something failing?{" "}
					<Link className="link text-feed" to="/onboarding">
						Run the onboarding checks
					</Link>
					.
				</p>
			</div>
		</div>
	);
}
