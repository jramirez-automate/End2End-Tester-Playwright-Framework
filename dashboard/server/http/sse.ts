import type { FastifyReply, FastifyRequest } from "fastify";
import type { RunEvent } from "../../shared/types.js";

const KEEPALIVE_MS = 20_000;

export interface SseConnection {
	send: (frame: string) => void;
	onClose: (fn: () => void) => void;
}

/** Hijack the reply and speak raw SSE: headers, 20s keepalive comments, cleanup. */
export function openSse(request: FastifyRequest, reply: FastifyReply): SseConnection {
	reply.hijack();
	const res = reply.raw;
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
	});
	const keepalive = setInterval(() => res.write(": keepalive\n\n"), KEEPALIVE_MS);
	const closers: Array<() => void> = [() => clearInterval(keepalive)];
	let closed = false;
	request.raw.on("close", () => {
		if (closed) return;
		closed = true;
		for (const fn of closers) fn();
	});
	return {
		send: (frame) => {
			if (!closed) res.write(frame);
		},
		onClose: (fn) => closers.push(fn),
	};
}

/** "?since=<seq>" query beats the Last-Event-ID reconnect header; default 0. */
export function parseSince(request: FastifyRequest): number {
	const query = request.query as Record<string, unknown>;
	const header = request.headers["last-event-id"];
	const raw =
		typeof query["since"] === "string"
			? query["since"]
			: typeof header === "string"
				? header
				: Array.isArray(header)
					? header[0]
					: undefined;
	const n = raw === undefined ? Number.NaN : Number(raw);
	return Number.isFinite(n) ? n : 0;
}

function frame(ev: RunEvent): string {
	return `id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`;
}

export interface RunEventSource {
	replay: (since: number) => Promise<RunEvent[]>;
	/** Returns the unsubscribe function. */
	subscribe: (listener: (ev: RunEvent) => void) => () => void;
}

/** Per-run event stream: replay WAL lines with seq > since, then live events. */
export async function sseRunEvents(
	request: FastifyRequest,
	reply: FastifyReply,
	source: RunEventSource,
): Promise<void> {
	const since = parseSince(request);
	const sse = openSse(request, reply);

	// Buffer live events during replay so ordering holds; dedupe by seq after.
	let replaying = true;
	const buffered: RunEvent[] = [];
	const listener = (ev: RunEvent): void => {
		if (replaying) buffered.push(ev);
		else sse.send(frame(ev));
	};
	sse.onClose(source.subscribe(listener));

	let maxSeq = since;
	try {
		for (const ev of await source.replay(since)) {
			sse.send(frame(ev));
			if (ev.seq > maxSeq) maxSeq = ev.seq;
		}
	} catch {
		// The reply is already hijacked, so a WAL-read rejection must NOT bubble to
		// Fastify's error handler (it would write to the hijacked socket and hang the
		// client). Skip the replay and let live events flow instead.
	}
	for (const ev of buffered) {
		if (ev.seq > maxSeq) sse.send(frame(ev));
	}
	replaying = false;
}
