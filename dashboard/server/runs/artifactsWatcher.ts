import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { ArtifactRef } from "../../shared/types.js";
import { evidenceRoot } from "../config.js";

function classify(relPath: string): ArtifactRef["kind"] | null {
	const base = path.basename(relPath).toLowerCase();
	if (base.endsWith("-trace.zip")) return "trace";
	if (base.endsWith(".png")) return "screenshot";
	if (base.endsWith(".webm")) return "video";
	if (base === "summary.md") return "summary";
	if (base === "comment-rows.json" || base === ".last-run.json") return "json";
	if (base.startsWith("zephyr-") && base.endsWith(".json")) return "json";
	return null;
}

/**
 * Watches src/evidence/<TICKET>/ for artifacts as the pipeline produces them.
 * The dir does not exist until the pipeline creates it — poll every 5s, then
 * attach chokidar. Emits: "artifact" (ArtifactRef).
 */
export class ArtifactsWatcher extends EventEmitter {
	private readonly dir: string;
	private watcher: FSWatcher | null = null;
	private pollTimer: NodeJS.Timeout | null = null;
	private stopTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly runId: string,
		e2eRoot: string,
		ticket: string,
	) {
		super();
		this.dir = path.join(evidenceRoot(e2eRoot), ticket);
	}

	start(): void {
		if (this.stopTimer) {
			clearTimeout(this.stopTimer);
			this.stopTimer = null;
		}
		if (this.watcher || this.pollTimer) return;
		if (this.tryAttach()) return;
		this.pollTimer = setInterval(() => {
			if (this.tryAttach() && this.pollTimer) {
				clearInterval(this.pollTimer);
				this.pollTimer = null;
			}
		}, 5000);
	}

	/** Run ended — keep watching briefly so trailing artifact writes still land. */
	stopSoon(graceMs = 30_000): void {
		if (this.stopTimer) return;
		this.stopTimer = setTimeout(() => this.stop(), graceMs);
	}

	stop(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.stopTimer) {
			clearTimeout(this.stopTimer);
			this.stopTimer = null;
		}
		if (this.watcher) {
			void this.watcher.close();
			this.watcher = null;
		}
	}

	private tryAttach(): boolean {
		if (this.watcher) return true;
		if (!existsSync(this.dir)) return false;
		this.watcher = watch(this.dir, {
			depth: 2,
			ignoreInitial: false,
			ignored: (p: string) => this.isIgnored(p),
			// Videos and traces are written incrementally; without this the watcher
			// fires "add"/"change" mid-write and emits a partial/zero size (and again
			// on every subsequent append). Wait for the file to settle first.
			awaitWriteFinish: { stabilityThreshold: 750, pollInterval: 100 },
		});
		const onFile = (p: string): void => void this.onFile(p);
		this.watcher.on("add", onFile);
		this.watcher.on("change", onFile);
		return true;
	}

	private isIgnored(p: string): boolean {
		const rel = path.relative(this.dir, path.resolve(p));
		if (!rel) return false; // the ticket dir itself
		if (rel.startsWith("..")) return true;
		const parts = rel.split(path.sep);
		const top = parts[0];
		if (top === "report") return true;
		if (top === "artifacts") {
			// keep artifacts/ itself watchable but only for .last-run.json
			if (parts.length === 1) return false;
			return parts.length > 2 || parts[1] !== ".last-run.json";
		}
		return false;
	}

	private async onFile(p: string): Promise<void> {
		const rel = path.relative(this.dir, path.resolve(p));
		const kind = classify(rel);
		if (!kind) return;
		try {
			const st = await stat(p);
			if (!st.isFile()) return;
			const relUrl = rel.split(path.sep).join("/");
			const ref: ArtifactRef = {
				relPath: relUrl,
				kind,
				url: `/api/runs/${this.runId}/evidence/${relUrl.split("/").map(encodeURIComponent).join("/")}`,
				size: st.size,
				mtime: st.mtime.toISOString(),
			};
			this.emit("artifact", ref);
		} catch {
			// file vanished between event and stat — ignore
		}
	}
}
