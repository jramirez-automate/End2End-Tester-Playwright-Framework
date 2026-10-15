import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply } from "fastify";

export const CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".webm": "video/webm",
	".md": "text/markdown; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".zip": "application/zip",
	".json": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".ndjson": "application/x-ndjson; charset=utf-8",
	".har": "application/json; charset=utf-8",
};

export async function sendFileAt(
	reply: FastifyReply,
	filePath: string,
	headers: Record<string, string>,
): Promise<void> {
	let st;
	try {
		st = await stat(filePath);
	} catch {
		await reply.code(404).send({ error: "not found" });
		return;
	}
	if (!st.isFile()) {
		await reply.code(404).send({ error: "not found" });
		return;
	}
	reply.headers({ ...headers, "content-length": String(st.size) });
	await reply.send(createReadStream(filePath));
}

/** True when `candidate` is `jail` or inside it. */
function within(jail: string, candidate: string): boolean {
	return candidate === jail || candidate.startsWith(jail + path.sep);
}

/**
 * Serves `requested` (a relative path from the URL) only if it resolves inside
 * `jail` — both lexically and after following symlinks. Anything else is a 404.
 */
export async function sendJailedFile(
	reply: FastifyReply,
	jail: string,
	requested: string,
): Promise<void> {
	const resolved = path.resolve(jail, requested);
	if (!within(jail, resolved)) {
		await reply.code(404).send({ error: "not found" });
		return;
	}
	// path.resolve normalizes ".." but does NOT follow symlinks — a symlink inside
	// the jail could still point outside it. Re-check the REAL path.
	let real: string;
	let jailReal: string;
	try {
		real = await realpath(resolved);
		jailReal = await realpath(jail);
	} catch {
		await reply.code(404).send({ error: "not found" });
		return;
	}
	if (!within(jailReal, real)) {
		await reply.code(404).send({ error: "not found" });
		return;
	}
	const contentType =
		CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
	await sendFileAt(reply, resolved, { "content-type": contentType, "cache-control": "no-store" });
}
