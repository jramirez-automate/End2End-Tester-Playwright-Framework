import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { createInterface } from "node:readline";
import type {
	ArtifactRef,
	PartialAction,
	RunActionRequest,
	RunEvent,
	RunRecord,
} from "../../shared/types.js";
import type { ServerConfig } from "../config.js";
import { killTree } from "../procs.js";
import { cleanSpawnEnv } from "../spawnEnv.js";
import type { Registry } from "./registry.js";
import { appendWalEvents, lastWalSeq } from "./wal.js";

export const PARTIAL_ACTIONS: readonly PartialAction[] = [
	"rerun-failing",
	"recapture-evidence",
	"attach",
	"post-comment",
	"mark-pass",
	"plan",
];

/** Actions that talk to external services — they default to a dry run first. */
export const PUBLISH_ACTIONS: ReadonlySet<PartialAction> = new Set([
	"attach",
	"post-comment",
	"mark-pass",
	"plan",
]);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

interface ActionCommand {
	cmd: string;
	args: string[];
	/** Working directory — the suite root (repo/worktree root) for scripts and claude. */
	cwd: string;
}

/**
 * Runs one partial action against an ENDED run's workspace, streaming output
 * lines as `action` WAL events (same file, monotonic seq — the supervisor
 * restores it on any later resume). Every action is a deterministic child:
 * a Playwright run, or a `scripts/publish.mjs` command for the ticket.
 * Emits: "event" (RunEvent), "done".
 */
export class ActionRunner extends EventEmitter {
	private child: ChildProcess | null = null;
	private seq = 0;
	private aborted = false;

	constructor(
		private readonly config: ServerConfig,
		private readonly registry: Registry,
		readonly run: RunRecord,
		readonly action: PartialAction,
		private readonly req: RunActionRequest,
	) {
		super();
	}

	private get runDir(): string {
		return this.registry.runDir(this.run.id);
	}

	async start(): Promise<void> {
		this.seq = await lastWalSeq(this.runDir);
		const command = this.buildCommand();
		await this.record(`$ ${[command.cmd, ...command.args.map(shortArg)].join(" ")}`);

		const env = cleanSpawnEnv();
		delete env["ANTHROPIC_API_KEY"]; // subscription login, same as runs
		env["TICKET"] = this.run.ticket;
		env["THUMBS_DIR"] = path.join(this.runDir, "thumbs");
		env["PW_JSON_OUTPUT"] = path.join(this.runDir, "pw-results.json");
		env["PW_PROGRESS_FILE"] = path.join(this.runDir, "pw-progress.ndjson");
		env["E2E_HISTORY_DIR"] = this.config.historyDir; // one history across worktrees
		// Reruns take env locks automatically via the shipped globalSetup client.
		env["E2E_ENV_LOCK_URL"] = `http://127.0.0.1:${this.config.port}/api/locks`;
		env["DASHBOARD_RUN_ID"] = this.run.id;
		env["TEST_ENV"] = this.run.env;
		if (this.action === "recapture-evidence") env["EVIDENCE"] = "true";

		const child = spawn(command.cmd, command.args, {
			cwd: command.cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
			windowsHide: true,
		});
		this.child = child;
		if (child.stdout) createInterface({ input: child.stdout }).on("line", (l) => this.line(l));
		if (child.stderr) createInterface({ input: child.stderr }).on("line", (l) => this.line(l));
		child.on("error", (err) => {
			this.child = null;
			void this.finish(false, `spawn failed: ${err.message}`);
		});
		child.on("exit", (code, signal) => {
			this.child = null;
			const ok = code === 0 && !this.aborted;
			void this.finish(
				ok,
				this.aborted
					? "aborted by the operator"
					: `exit ${signal ? `signal ${signal}` : (code ?? "unknown")}`,
			);
		});
	}

	abort(): void {
		this.aborted = true;
		const pid = this.child?.pid;
		if (pid) killTree(pid);
	}

	/** Fresh evidence produced by the action lands as artifact events too. */
	recordArtifact(ref: ArtifactRef): void {
		void this.append("artifact", ref);
	}

	private line(raw: string): void {
		if (raw.trim()) void this.record(raw);
	}

	private async finish(ok: boolean, detail: string): Promise<void> {
		await this.append("action", {
			action: this.action,
			line: `${this.action} ${ok ? "finished" : "failed"} — ${detail}`,
			done: true,
			ok,
			dryRun: this.req.dryRun ?? false,
		});
		this.emit("done");
	}

	private record(line: string): Promise<void> {
		return this.append("action", { action: this.action, line });
	}

	private async append(kind: RunEvent["kind"], payload: unknown): Promise<void> {
		const ev: RunEvent = { seq: ++this.seq, ts: new Date().toISOString(), kind, payload };
		await appendWalEvents(this.runDir, [ev]);
		this.emit("event", ev);
	}

	private buildCommand(): ActionCommand {
		const { e2eRoot, ticket } = this.run;
		const dryRun = this.req.dryRun ?? false;
		const publish = (command: string): ActionCommand => ({
			cmd: process.execPath,
			args: ["scripts/publish.mjs", command, "--ticket", ticket, ...(dryRun ? ["--dry-run"] : [])],
			cwd: e2eRoot,
		});
		switch (this.action) {
			case "rerun-failing":
				return {
					cmd: npmCmd,
					args: ["exec", "--", "playwright", "test", "--last-failed"],
					cwd: e2eRoot,
				};
			case "recapture-evidence":
				return { cmd: npmCmd, args: ["exec", "--", "playwright", "test"], cwd: e2eRoot };
			case "attach":
				return publish("attach");
			case "post-comment":
				return publish("comment");
			case "mark-pass":
				return publish("mark-pass");
			case "plan":
				return publish("plan");
		}
	}
}

/** Keep secrets/prompts readable in the echoed command line. */
function shortArg(arg: string): string {
	return arg.length > 80 ? `${arg.slice(0, 77)}…` : arg;
}
