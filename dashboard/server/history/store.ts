import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { HistoryOverview, HistoryRun } from "../../shared/types.js";
import { buildOverview, parseHistoryRun } from "./aggregate.js";

/** <historyDir>/<id>.json — ids are the reporter's ISO-timestamp-env slugs. */
export const RUN_ID = /^[0-9TZ-]+-[a-z0-9-]+$/;

/** Oldest runs past this are ignored (the folder is never pruned automatically). */
const MAX_RUNS = 500;

/** Reads run-history/ — parsed runs are cached by mtime, so a reload only reads new files. */
export class HistoryStore {
	private cache = new Map<string, { mtimeMs: number; run: HistoryRun | null }>();

	constructor(private readonly historyDir: string) {}

	get dir(): string {
		return this.historyDir;
	}

	mediaDir(id: string): string {
		return path.join(this.historyDir, id);
	}

	/** All readable runs, newest first. */
	async runs(): Promise<HistoryRun[]> {
		let names: string[] = [];
		try {
			names = (await readdir(this.historyDir)).filter(
				(n) => n.endsWith(".json") && RUN_ID.test(n.slice(0, -5)),
			);
		} catch {
			return []; // no history yet
		}
		// Ids start with the ISO timestamp, so name order is time order.
		names.sort().reverse();
		const runs: HistoryRun[] = [];
		for (const name of names.slice(0, MAX_RUNS)) {
			const run = await this.load(name);
			if (run) runs.push(run);
		}
		return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
	}

	async run(id: string): Promise<HistoryRun | null> {
		if (!RUN_ID.test(id)) return null;
		return this.load(`${id}.json`);
	}

	async overview(): Promise<HistoryOverview> {
		return buildOverview(this.historyDir, await this.runs());
	}

	private async load(name: string): Promise<HistoryRun | null> {
		const file = path.join(this.historyDir, name);
		try {
			const { mtimeMs } = await stat(file);
			const hit = this.cache.get(name);
			if (hit && hit.mtimeMs === mtimeMs) return hit.run;
			const run = parseHistoryRun(JSON.parse(await readFile(file, "utf8")));
			this.cache.set(name, { mtimeMs, run });
			return run;
		} catch {
			return null;
		}
	}
}
