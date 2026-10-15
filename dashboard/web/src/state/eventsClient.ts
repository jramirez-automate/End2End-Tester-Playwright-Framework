import type { LocksSnapshot, RunEvent, RunRecord } from "../../../shared/types";

export interface StreamHandle {
	close: () => void;
}

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * Reconnect delay: exponential backoff with jitter. A fixed retry made every
 * open stream reconnect in lockstep every 1.5s, hammering a server that just
 * restarted (thundering herd). Jitter spreads them; the cap bounds the wait.
 */
export function backoffDelay(attempt: number, rand: () => number = Math.random): number {
	const cap = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempt, 20));
	return Math.round(cap / 2 + rand() * (cap / 2));
}

/**
 * Opens the per-run SSE stream. Reconnects automatically, passing the last
 * seen seq as ?since= so the server replays only what was missed.
 */
export function openRunStream(
	runId: string,
	sinceSeq: number,
	onEvent: (ev: RunEvent) => void,
): StreamHandle {
	let lastSeq = sinceSeq;
	let source: EventSource | null = null;
	let retryTimer: number | undefined;
	let closed = false;
	let attempt = 0;

	const connect = (): void => {
		if (closed) return;
		source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?since=${lastSeq}`);
		source.onopen = () => {
			attempt = 0; // a successful connect resets the backoff
		};
		source.onmessage = (msg: MessageEvent<string>) => {
			try {
				const ev = JSON.parse(msg.data) as RunEvent;
				if (typeof ev.seq === "number" && ev.seq > lastSeq) lastSeq = ev.seq;
				onEvent(ev);
			} catch {
				// Malformed frame — skip it.
			}
		};
		source.onerror = () => {
			source?.close();
			source = null;
			if (!closed) retryTimer = window.setTimeout(connect, backoffDelay(attempt++));
		};
	};

	connect();

	return {
		close: () => {
			closed = true;
			window.clearTimeout(retryTimer);
			source?.close();
			source = null;
		},
	};
}

/**
 * Opens the global SSE stream; fires onRun for every run create/update frame.
 * onConnect fires on every (re)connect — the stream has no replay, so any run
 * frame missed while disconnected (e.g. a server restart) is gone; callers
 * refetch state there to heal stale tabs.
 */
export function openGlobalStream(
	onRun: (run: RunRecord) => void,
	onConnect?: () => void,
	onLocks?: (locks: LocksSnapshot) => void,
	onRemove?: (id: string) => void,
): StreamHandle {
	let source: EventSource | null = null;
	let retryTimer: number | undefined;
	let closed = false;
	let everConnected = false;
	let attempt = 0;

	const connect = (): void => {
		if (closed) return;
		source = new EventSource("/api/events");
		source.onopen = () => {
			attempt = 0; // a successful connect resets the backoff
			// The first open races the caller's own initial fetch — skip it.
			if (everConnected) onConnect?.();
			everConnected = true;
		};
		source.onmessage = (msg: MessageEvent<string>) => {
			try {
				const frame = JSON.parse(msg.data) as { kind?: unknown; payload?: unknown };
				if (frame.kind === "run" && frame.payload && typeof frame.payload === "object") {
					onRun(frame.payload as RunRecord);
				}
				if (frame.kind === "locks" && frame.payload && typeof frame.payload === "object") {
					onLocks?.(frame.payload as LocksSnapshot);
				}
				if (frame.kind === "run-removed" && frame.payload && typeof frame.payload === "object") {
					const id = (frame.payload as { id?: unknown }).id;
					if (typeof id === "string") onRemove?.(id);
				}
			} catch {
				// Malformed frame — skip it.
			}
		};
		source.onerror = () => {
			source?.close();
			source = null;
			if (!closed) retryTimer = window.setTimeout(connect, backoffDelay(attempt++));
		};
	};

	connect();

	return {
		close: () => {
			closed = true;
			window.clearTimeout(retryTimer);
			source?.close();
			source = null;
		},
	};
}
