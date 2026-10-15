import { appendFile } from "node:fs/promises";
import path from "node:path";
import type { RunEvent } from "../../shared/types.js";
import { readRunEvents } from "./supervisor.js";

/**
 * Standalone WAL append for writers that run when no supervisor stream is
 * live (orphan sweep, partial actions). The supervisor re-reads the file on
 * resume (restoreSeq), so seqs appended here stay monotonic.
 */

export async function lastWalSeq(runDir: string): Promise<number> {
	return (await readRunEvents(runDir, 0)).at(-1)?.seq ?? 0;
}

export async function appendWalEvents(runDir: string, events: RunEvent[]): Promise<void> {
	await appendFile(
		path.join(runDir, "events.ndjson"),
		events.map((ev) => `${JSON.stringify(ev)}\n`).join(""),
	);
}
