import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { copyToWorktree, listStoredEnvFiles, seedFromCheckout } from "../credentials/store.js";
import { killTree } from "../procs.js";
import { cleanSpawnEnv } from "../spawnEnv.js";

export interface ProvisionSpec {
	/** The dashboard's own checkout — `git worktree add` runs here; credential seed source. */
	repoRoot: string;
	worktreesRoot: string;
	ticket: string;
	baseBranch: string;
	/** The dashboard checkout's suite root — the repo root here (first-run credential seed source). */
	e2eRootSource: string;
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

/** Global max-1 queue — parallel `npm install`s would thrash the machine. */
let queueTail: Promise<void> = Promise.resolve();

/**
 * Provisions a per-ticket worktree as the run's visible "step 0":
 * `git worktree add` → copy env files from the canonical store → npm install →
 * playwright install. Every output line streams to `onLine` (the supervisor
 * turns them into `provision` WAL events). This is a standalone e2e repo, so the
 * suite lives at the worktree root. Idempotent: an existing valid worktree with
 * node_modules fast-paths through, so a killed-mid-provision retry is cheap.
 */
export class Provisioner {
	private child: ChildProcess | null = null;
	private cancelled = false;

	constructor(
		private readonly spec: ProvisionSpec,
		private readonly onLine: (line: string) => void,
	) {}

	get worktreePath(): string {
		return path.join(this.spec.worktreesRoot, this.spec.ticket);
	}

	run(): Promise<void> {
		const turn = queueTail.then(() => this.provision());
		queueTail = turn.catch(() => {}); // a failed job must not wedge the queue
		return turn;
	}

	cancel(): void {
		this.cancelled = true;
		const pid = this.child?.pid;
		if (pid) killTree(pid);
	}

	private async provision(): Promise<void> {
		if (this.cancelled) throw new Error("provisioning cancelled");
		const wt = this.worktreePath;
		const branch = `feature/${this.spec.ticket}`;

		if (existsSync(wt)) {
			await this.assertReusableWorktree(wt, branch);
			this.onLine(`workspace already provisioned at ${wt} — reusing`);
		} else {
			// -b only when the branch doesn't exist yet (a prior provision or the
			// create-worktree skill may have created it).
			const hasBranch = await this.gitSucceeds([
				"rev-parse",
				"--verify",
				"--quiet",
				`refs/heads/${branch}`,
			]);
			const args = hasBranch
				? ["worktree", "add", wt, branch]
				: ["worktree", "add", wt, "-b", branch, this.spec.baseBranch];
			await this.exec("git", args, this.spec.repoRoot);
		}

		// Standalone repo: the suite (playwright.config.ts, src/tests/, .env.*) is at the root.
		if (!existsSync(path.join(wt, "playwright.config.ts"))) {
			throw new Error(
				`${wt} has no e2e suite (no playwright.config.ts) — base branch "${this.spec.baseBranch}" doesn't contain it. ` +
					`Pick a base branch that has it (e.g. the dashboard checkout's own branch), or remove the stale worktree and retry.`,
			);
		}

		await this.syncCredentials(wt);

		if (existsSync(path.join(wt, "node_modules"))) {
			this.onLine("dependencies already installed — skipping npm install");
			return;
		}
		await this.exec(npmCmd, ["install"], wt);
		await this.exec(npxCmd, ["playwright", "install", "chromium"], wt);
	}

	/** The path exists — reuse only a real worktree already on this ticket's branch. */
	private async assertReusableWorktree(wt: string, branch: string): Promise<void> {
		const head = await this.gitCapture(["-C", wt, "rev-parse", "--abbrev-ref", "HEAD"]);
		if (head === null) {
			throw new Error(
				`${wt} exists but is not a git worktree — move it aside or pick another ticket`,
			);
		}
		if (head !== branch) {
			throw new Error(
				`${wt} is on branch ${head}, expected ${branch} — resolve the conflict manually`,
			);
		}
	}

	private async syncCredentials(e2eRoot: string): Promise<void> {
		if ((await listStoredEnvFiles()).length === 0) {
			const seeded = await seedFromCheckout(this.spec.e2eRootSource);
			this.onLine(
				seeded.length > 0
					? `credential store seeded from this checkout: ${seeded.join(", ")}`
					: "credential store is empty and this checkout has no .env.* files to seed from",
			);
		}
		const copied = await copyToWorktree(e2eRoot);
		this.onLine(
			copied.length > 0
				? `credentials copied: ${copied.join(", ")}`
				: "no credentials to copy — runs will lack env files",
		);
	}

	/** Run a command, streaming stdout+stderr lines to the provision log. */
	private exec(cmd: string, args: string[], cwd: string): Promise<void> {
		if (this.cancelled) return Promise.reject(new Error("provisioning cancelled"));
		this.onLine(`$ ${[cmd, ...args].join(" ")}`);
		return new Promise((resolve, reject) => {
			const child = spawn(cmd, args, {
				cwd,
				// npm/npx are node too — strip any inherited VSCode debugger injection.
				env: cleanSpawnEnv(),
				stdio: ["ignore", "pipe", "pipe"],
				detached: process.platform !== "win32", // own group so cancel() kills the npm tree
				windowsHide: true,
			});
			this.child = child;
			if (child.stdout)
				createInterface({ input: child.stdout }).on("line", (l) => this.emitLine(l));
			if (child.stderr)
				createInterface({ input: child.stderr }).on("line", (l) => this.emitLine(l));
			child.on("error", (err) => {
				this.child = null;
				reject(err);
			});
			child.on("exit", (code, signal) => {
				this.child = null;
				if (this.cancelled) reject(new Error("provisioning cancelled"));
				else if (code === 0) resolve();
				else
					reject(
						new Error(
							`${cmd} exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`,
						),
					);
			});
		});
	}

	private emitLine(line: string): void {
		if (line.trim()) this.onLine(line);
	}

	/** Silent git probe in the repo root — true when the command exits 0. */
	private gitSucceeds(args: string[]): Promise<boolean> {
		return this.gitCapture(["-C", this.spec.repoRoot, ...args]).then((out) => out !== null);
	}

	/** Silent git call: trimmed stdout on exit 0, null otherwise. */
	private gitCapture(args: string[]): Promise<string | null> {
		return new Promise((resolve) => {
			const child = spawn("git", args, {
				env: process.env,
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
			});
			let out = "";
			child.stdout.on("data", (chunk: Buffer) => {
				out += chunk.toString("utf8");
			});
			child.on("error", () => resolve(null));
			child.on("exit", (code) => resolve(code === 0 ? out.trim() : null));
		});
	}
}
