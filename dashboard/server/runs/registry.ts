import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunRecord } from "../../shared/types.js";

export function newRunId(): string {
	return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

let tmpSeq = 0;

async function atomicWrite(file: string, data: string): Promise<void> {
	// Counter keeps tmp names unique even for same-millisecond concurrent saves.
	const tmp = `${file}.${process.pid}.${(++tmpSeq).toString(36)}.tmp`;
	await writeFile(tmp, data, "utf8");
	await rename(tmp, file);
}

interface RegistryIndex {
	ids: string[];
}

/** Flat-file persistence: data/registry.json + data/runs/<id>/run.json. */
export class Registry {
	private readonly runs = new Map<string, RunRecord>();
	private ids: string[] = [];
	/** Saves are serialized so concurrent callers can't interleave write+rename. */
	private saveChain: Promise<void> = Promise.resolve();

	constructor(private readonly dataDir: string) {}

	runDir(id: string): string {
		return path.join(this.dataDir, "runs", id);
	}

	async load(): Promise<void> {
		let index: RegistryIndex = { ids: [] };
		try {
			const raw: unknown = JSON.parse(
				await readFile(path.join(this.dataDir, "registry.json"), "utf8"),
			);
			if (typeof raw === "object" && raw !== null && Array.isArray((raw as RegistryIndex).ids)) {
				index = {
					ids: (raw as RegistryIndex).ids.filter((id): id is string => typeof id === "string"),
				};
			}
		} catch {
			// first boot — no registry yet
		}
		for (const id of index.ids) {
			try {
				const run = JSON.parse(
					await readFile(path.join(this.runDir(id), "run.json"), "utf8"),
				) as RunRecord;
				if (run && typeof run.id === "string") {
					this.runs.set(run.id, run);
					this.ids.push(run.id);
				}
			} catch {
				// skip corrupt/missing run records
			}
		}
	}

	list(): RunRecord[] {
		return [...this.runs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	}

	get(id: string): RunRecord | undefined {
		return this.runs.get(id);
	}

	save(run: RunRecord): Promise<void> {
		const job = this.saveChain.then(() => this.doSave(run));
		this.saveChain = job.catch(() => {}); // a failed save must not wedge the chain
		return job;
	}

	/**
	 * Drop a run from memory and disk (record dir + index entry). Serialized on
	 * the same chain as save() so it can't interleave with a concurrent write.
	 * Returns false when the id was unknown.
	 */
	remove(id: string): Promise<boolean> {
		const job = this.saveChain.then(() => this.doRemove(id));
		this.saveChain = job.then(
			() => {},
			() => {},
		);
		return job;
	}

	private async doRemove(id: string): Promise<boolean> {
		if (!this.runs.has(id)) return false;
		this.runs.delete(id);
		this.ids = this.ids.filter((existing) => existing !== id);
		await atomicWrite(
			path.join(this.dataDir, "registry.json"),
			JSON.stringify({ ids: this.ids } satisfies RegistryIndex, null, "\t"),
		);
		await rm(this.runDir(id), { recursive: true, force: true });
		return true;
	}

	private async doSave(run: RunRecord): Promise<void> {
		run.updatedAt = new Date().toISOString();
		const isNew = !this.runs.has(run.id);
		this.runs.set(run.id, run);
		await mkdir(this.runDir(run.id), { recursive: true });
		await atomicWrite(path.join(this.runDir(run.id), "run.json"), JSON.stringify(run, null, "\t"));
		if (isNew) {
			this.ids.push(run.id);
			await atomicWrite(
				path.join(this.dataDir, "registry.json"),
				JSON.stringify({ ids: this.ids } satisfies RegistryIndex, null, "\t"),
			);
		}
	}
}
