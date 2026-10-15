import { useCallback, useEffect, useState } from "react";
import type { EnvFileSummary } from "../../../shared/types";
import {
	fetchCredentials,
	importCredentials,
	revealCredentialField,
	scaffoldCredentialFile,
	setCredentialField,
	syncCredentials,
	testCredentials,
	type CredentialsView,
	type ProbeResult,
} from "../state/api";

type FileView = EnvFileSummary & { exists: boolean };

/**
 * Manages the per-user canonical credential store (masked by default; raw
 * values only via the explicit per-field reveal). Fresh worktrees are
 * provisioned from this store; "Sync to checkout" pushes it into the
 * dashboard's own checkout root for runs that reuse this checkout.
 */
export function CredentialsEditor() {
	const [view, setView] = useState<CredentialsView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const refetch = useCallback(() => {
		fetchCredentials()
			.then((v) => {
				setView(v);
				setError(null);
			})
			.catch((err: unknown) => setError(err instanceof Error ? err.message : "Credentials unavailable."));
	}, []);
	useEffect(refetch, [refetch]);

	const act = (name: string, fn: () => Promise<string>): void => {
		setBusy(name);
		setNotice(null);
		fn()
			.then((message) => {
				setNotice(message);
				refetch();
			})
			.catch((err: unknown) => setError(err instanceof Error ? err.message : "Action failed."))
			.finally(() => setBusy(null));
	};

	if (error && !view) return <p className="text-sm text-fault">{error}</p>;
	if (!view) {
		return (
			<div className="flex flex-col gap-2">
				<div className="skeleton h-6 w-full bg-ink-2" />
				<div className="skeleton h-6 w-2/3 bg-ink-2" />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<JiraExpiryChip expiresAt={view.meta.jiraTokenExpiresAt} />
				<div className="ml-auto flex gap-2">
					<ToolbarButton
						name="import"
						busy={busy}
						onClick={() =>
							act("import", async () => {
								const { files } = await importCredentials();
								return files.length > 0 ? `Imported from this checkout: ${files.join(", ")}` : "Nothing to import.";
							})
						}
					>
						Import from checkout
					</ToolbarButton>
					<ToolbarButton
						name="sync"
						busy={busy}
						onClick={() =>
							act("sync", async () => {
								const { files } = await syncCredentials();
								return files.length > 0 ? `Synced to this checkout: ${files.join(", ")}` : "Store is empty.";
							})
						}
					>
						Sync to checkout
					</ToolbarButton>
				</div>
			</div>
			{view.files.map((file) => (
				<CredentialFile key={file.file} file={file} onChanged={refetch} />
			))}
			<ScaffoldRow onChanged={refetch} />
			{notice ? <p className="text-xs text-putty">{notice}</p> : null}
			{error ? <p className="text-xs text-fault">{error}</p> : null}
			<p className="text-[11px] text-putty">
				Values live in the per-user store and are copied into every fresh worktree at provision time. Reveal shows a
				value transiently — it is never logged.
			</p>
		</div>
	);
}

function ToolbarButton({
	name,
	busy,
	onClick,
	children,
}: {
	name: string;
	busy: string | null;
	onClick: () => void;
	children: string;
}) {
	return (
		<button type="button" className="btn btn-sm" disabled={busy !== null} onClick={onClick}>
			{busy === name ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
			{children}
		</button>
	);
}

function JiraExpiryChip({ expiresAt }: { expiresAt: string | null }) {
	if (!expiresAt) return null;
	const days = Math.floor((Date.parse(expiresAt) - Date.now()) / 86_400_000);
	const tone = days < 0 ? "text-fault" : days < 30 ? "text-standby" : "text-putty";
	return (
		<span className={`font-mono text-xs ${tone}`}>
			Jira token {days < 0 ? `expired ${expiresAt}` : `expires ${expiresAt} (${days}d)`}
		</span>
	);
}

function CredentialFile({ file, onChanged }: { file: FileView; onChanged: () => void }) {
	const [probe, setProbe] = useState<ProbeResult | null>(null);
	const [probing, setProbing] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const isJira = file.file === ".env.publish";

	const runProbe = (target: string): void => {
		setProbing(target);
		setProbe(null);
		testCredentials(target)
			.then(setProbe)
			.catch((err: unknown) => setProbe({ ok: false, detail: err instanceof Error ? err.message : "probe failed" }))
			.finally(() => setProbing(null));
	};

	return (
		<details className="rounded border border-line bg-ink-0">
			<summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
				<span className={`h-1.5 w-1.5 rounded-full ${file.exists ? "bg-ok" : "bg-fault"}`} aria-hidden />
				<span className="font-mono">{file.file}</span>
				<span className="text-putty">{file.exists ? `${file.fields.length} keys` : "missing"}</span>
			</summary>
			<div className="flex flex-col gap-2 p-2 pt-0">
				{file.exists ? (
					<table className="table table-xs">
						<tbody>
							{file.fields.map((field) => (
								<FieldRow key={field.key} file={file.file} field={field} onChanged={onChanged} />
							))}
						</tbody>
					</table>
				) : (
					<p className="px-1 text-xs text-putty">Not in the store yet — scaffold it, then fill the fields in.</p>
				)}
				<div className="flex flex-wrap items-center gap-2">
					{adding ? (
						<AddKeyForm file={file.file} onDone={() => setAdding(false)} onChanged={onChanged} />
					) : file.exists ? (
						<button type="button" className="btn btn-ghost btn-xs text-putty" onClick={() => setAdding(true)}>
							+ Add key
						</button>
					) : null}
					<div className="ml-auto flex gap-2">
						{isJira ? (
							<>
								<ProbeButton label="Test Jira" busy={probing === "jira"} onClick={() => runProbe("jira")} />
								<ProbeButton label="Test Zephyr" busy={probing === "zephyr"} onClick={() => runProbe("zephyr")} />
							</>
						) : file.exists ? (
							<ProbeButton label="Test connection" busy={probing === file.file} onClick={() => runProbe(file.file)} />
						) : null}
					</div>
				</div>
				{probe ? (
					<p className={`text-xs ${probe.ok ? "text-ok" : "text-fault"}`}>
						{probe.ok ? "ok" : "failed"} — {probe.detail}
					</p>
				) : null}
			</div>
		</details>
	);
}

function ProbeButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
	return (
		<button type="button" className="btn btn-xs" disabled={busy} onClick={onClick}>
			{busy ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
			{label}
		</button>
	);
}

function FieldRow({
	file,
	field,
	onChanged,
}: {
	file: string;
	field: EnvFileSummary["fields"][number];
	onChanged: () => void;
}) {
	const [revealed, setRevealed] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [rowError, setRowError] = useState<string | null>(null);

	const reveal = (): void => {
		if (revealed !== null) {
			setRevealed(null); // hide again — the value never lingers
			return;
		}
		setBusy(true);
		revealCredentialField(file, field.key)
			.then(({ value }) => setRevealed(value))
			.catch((err: unknown) => setRowError(err instanceof Error ? err.message : "reveal failed"))
			.finally(() => setBusy(false));
	};

	const save = (): void => {
		setBusy(true);
		setRowError(null);
		setCredentialField(file, field.key, draft)
			.then(() => {
				setEditing(false);
				setDraft("");
				setRevealed(null);
				onChanged();
			})
			.catch((err: unknown) => setRowError(err instanceof Error ? err.message : "save failed"))
			.finally(() => setBusy(false));
	};

	return (
		<tr>
			<td className="font-mono text-putty">{field.key}</td>
			<td className="font-mono">
				{editing ? (
					<input
						className="input input-xs w-full bg-ink-1 font-mono"
						aria-label={`New value for ${field.key}`}
						value={draft}
						autoFocus
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") save();
							if (e.key === "Escape") setEditing(false);
						}}
					/>
				) : (
					(revealed ?? (field.isSet ? field.masked : <span className="text-putty">(empty)</span>))
				)}
				{rowError ? <span className="ml-2 text-fault">{rowError}</span> : null}
			</td>
			<td className="w-28 text-right whitespace-nowrap">
				{editing ? (
					<>
						<button type="button" className="btn btn-xs" disabled={busy} onClick={save}>
							{busy ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
							Save
						</button>
						<button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => setEditing(false)}>
							Cancel
						</button>
					</>
				) : (
					<>
						{field.isSet ? (
							<button type="button" className="btn btn-ghost btn-xs text-putty" disabled={busy} onClick={reveal}>
								{revealed !== null ? "Hide" : "Reveal"}
							</button>
						) : null}
						<button
							type="button"
							className="btn btn-ghost btn-xs text-putty"
							onClick={() => {
								setEditing(true);
								setDraft("");
							}}
						>
							Edit
						</button>
					</>
				)}
			</td>
		</tr>
	);
}

function AddKeyForm({ file, onDone, onChanged }: { file: string; onDone: () => void; onChanged: () => void }) {
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const save = (): void => {
		if (!key.trim()) return;
		setBusy(true);
		setFormError(null);
		setCredentialField(file, key.trim(), value)
			.then(() => {
				onDone();
				onChanged();
			})
			.catch((err: unknown) => setFormError(err instanceof Error ? err.message : "save failed"))
			.finally(() => setBusy(false));
	};

	return (
		<span className="flex flex-wrap items-center gap-1.5">
			<input
				className="input input-xs bg-ink-1 font-mono"
				placeholder="KEY"
				aria-label="New key name"
				value={key}
				autoFocus
				onChange={(e) => setKey(e.target.value)}
			/>
			<input
				className="input input-xs bg-ink-1 font-mono"
				placeholder="value"
				aria-label="New key value"
				value={value}
				onChange={(e) => setValue(e.target.value)}
			/>
			<button type="button" className="btn btn-xs" disabled={busy || !key.trim()} onClick={save}>
				{busy ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
				Add
			</button>
			<button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={onDone}>
				Cancel
			</button>
			{formError ? <span className="text-xs text-fault">{formError}</span> : null}
		</span>
	);
}

function ScaffoldRow({ onChanged }: { onChanged: () => void }) {
	const [open, setOpen] = useState(false);
	const [env, setEnv] = useState("");
	const [busy, setBusy] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	if (!open) {
		return (
			<button type="button" className="btn btn-ghost btn-sm self-start text-putty" onClick={() => setOpen(true)}>
				+ Scaffold a new env file
			</button>
		);
	}
	const file = env.trim().startsWith(".env.") ? env.trim() : `.env.${env.trim()}`;
	const scaffold = (): void => {
		setBusy(true);
		setFormError(null);
		scaffoldCredentialFile(file)
			.then(() => {
				setOpen(false);
				setEnv("");
				onChanged();
			})
			.catch((err: unknown) => setFormError(err instanceof Error ? err.message : "scaffold failed"))
			.finally(() => setBusy(false));
	};
	return (
		<div className="flex flex-wrap items-center gap-2">
			<label className="flex items-center gap-2 text-xs text-putty">
				New env name
				<input
					className="input input-xs bg-ink-1 font-mono"
					placeholder="staging"
					value={env}
					autoFocus
					onChange={(e) => setEnv(e.target.value)}
				/>
			</label>
			{env.trim() ? <span className="font-mono text-xs text-putty">→ {file}</span> : null}
			<button type="button" className="btn btn-xs" disabled={busy || !env.trim()} onClick={scaffold}>
				{busy ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
				Scaffold from .env.example
			</button>
			<button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => setOpen(false)}>
				Cancel
			</button>
			{formError ? <span className="text-xs text-fault">{formError}</span> : null}
		</div>
	);
}
