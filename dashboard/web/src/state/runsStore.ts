import { create } from "zustand";
import { ACTIVE_STATES } from "../../../shared/types";
import type { CreateRunRequest, LocksSnapshot, RunEvent, RunRecord } from "../../../shared/types";
import { autoReply, shouldAutoApprove } from "../autoApprove";
import * as api from "./api";
import { openGlobalStream, openRunStream, type StreamHandle } from "./eventsClient";
import { shouldReplaceRecord } from "./reconcile";

/** Ring buffer cap per run — old events fall off the front. */
const EVENT_CAP = 3000;

/** How long a terminal run's stream stays open so trailing events flush. */
const LINGER_MS = 5000;

/** Grace before auto-mode answers a gate — a beat to see it land / flip auto off. */
const AUTO_APPROVE_DELAY_MS = 1200;

let navigateFn: ((path: string) => void) | null = null;

/** Registered from the router shell so gate notifications can deep-link. */
export function registerNavigator(fn: (path: string) => void): void {
	navigateFn = fn;
}

const runStreams = new Map<string, StreamHandle>();
const lingerTimers = new Map<string, number>();
const autoApproveTimers = new Map<string, number>();
let globalStream: StreamHandle | null = null;
let started = false;

interface RunsState {
	runs: Record<string, RunRecord>;
	events: Record<string, RunEvent[]>;
	/** True between sending a message and the session echoing it back. */
	sending: Record<string, boolean>;
	/** Live env-lock occupancy, pushed over the global SSE stream. */
	locks: LocksSnapshot | null;
	/** Partial action currently running per run — cleared by its terminal action event. */
	actionBusy: Record<string, string | null>;
	/** Per-run "safe auto" — auto-answer flow gates; publishing gates still pause. */
	autoApprove: Record<string, boolean>;
	loaded: boolean;
	loadError: string | null;
	/** Idempotent boot: initial GET /api/runs + global SSE wiring. */
	start: () => void;
	loadRuns: () => Promise<void>;
	createRun: (req: CreateRunRequest) => Promise<RunRecord>;
	sendMessage: (id: string, text: string) => Promise<void>;
	interrupt: (id: string) => Promise<void>;
	abort: (id: string) => Promise<void>;
	resume: (id: string) => Promise<void>;
	deleteRun: (id: string) => Promise<void>;
	connectRun: (id: string) => void;
	disconnectRun: (id: string) => void;
	runAction: (
		id: string,
		action: string,
		body?: { dryRun?: boolean; commentId?: string },
	) => Promise<void>;
	abortAction: (id: string) => Promise<void>;
	setAutoApprove: (id: string, on: boolean) => void;
}

export const useRunsStore = create<RunsState>()((set, get) => {
	const ingest = (runId: string, ev: RunEvent): void => {
		set((state) => {
			const prev = state.events[runId] ?? [];
			const last = prev.at(-1);
			if (last && ev.seq <= last.seq) return {};
			const appended = [...prev, ev];
			const next =
				appended.length > EVENT_CAP ? appended.slice(appended.length - EVENT_CAP) : appended;
			// Any fresh event means the session heard us — clear the send spinner.
			const sending = state.sending[runId] ? { ...state.sending, [runId]: false } : state.sending;
			// A terminal action event releases that run's action buttons.
			const payload = ev.kind === "action" ? (ev.payload as { done?: unknown } | null) : null;
			const actionBusy =
				payload?.done === true && state.actionBusy[runId]
					? { ...state.actionBusy, [runId]: null }
					: state.actionBusy;
			return { events: { ...state.events, [runId]: next }, sending, actionBusy };
		});
		if (ev.kind === "state") {
			const payload = ev.payload as { run?: unknown } | null;
			if (
				payload &&
				typeof payload === "object" &&
				payload.run &&
				typeof payload.run === "object"
			) {
				const incoming = payload.run as RunRecord;
				const existing = get().runs[incoming.id];
				// WAL replays deliver historical snapshots — never let one roll a
				// fresher record back (it resurrects dead runs as "running"). Guards
				// against NaN timestamps that would otherwise freeze the card.
				if (shouldReplaceRecord(existing, incoming)) {
					upsert(incoming);
				}
			}
		}
	};

	const notifyIfGated = (prev: RunRecord | undefined, run: RunRecord): void => {
		if (run.state !== "waiting_gate" || prev?.state === "waiting_gate") return;
		if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
		if (!document.hidden) return;
		const body = (run.gate?.question ?? "The run is waiting on you.").slice(0, 120);
		const notification = new Notification(`${run.ticket} — gate raised`, { body });
		notification.onclick = () => {
			window.focus();
			navigateFn?.(`/runs/${run.id}`);
			notification.close();
		};
	};

	/** Schedule a safe-auto reply for a gated run (no-op unless auto is on & non-publishing). */
	const scheduleAutoApprove = (run: RunRecord): void => {
		if (run.state !== "waiting_gate" || !run.gate) return;
		if (!get().autoApprove[run.id] || !shouldAutoApprove(run.gate, true)) return;
		if (autoReply(run.gate) === null) return;
		const existing = autoApproveTimers.get(run.id);
		if (existing !== undefined) window.clearTimeout(existing);
		autoApproveTimers.set(
			run.id,
			window.setTimeout(() => {
				autoApproveTimers.delete(run.id);
				// Re-check at fire time — the gate, auto flag, or step may have changed.
				const cur = get().runs[run.id];
				if (!cur || cur.state !== "waiting_gate" || !cur.gate) return;
				if (!get().autoApprove[run.id] || !shouldAutoApprove(cur.gate, true)) return;
				const reply = autoReply(cur.gate);
				if (reply) void get().sendMessage(run.id, reply);
			}, AUTO_APPROVE_DELAY_MS),
		);
	};

	const connect = (id: string): void => {
		const linger = lingerTimers.get(id);
		if (linger !== undefined) {
			window.clearTimeout(linger);
			lingerTimers.delete(id);
		}
		if (runStreams.has(id)) return;
		const since = get().events[id]?.at(-1)?.seq ?? 0;
		runStreams.set(
			id,
			openRunStream(id, since, (ev) => ingest(id, ev)),
		);
	};

	const close = (id: string): void => {
		runStreams.get(id)?.close();
		runStreams.delete(id);
	};

	const scheduleClose = (id: string): void => {
		if (!runStreams.has(id) || lingerTimers.has(id)) return;
		lingerTimers.set(
			id,
			window.setTimeout(() => {
				lingerTimers.delete(id);
				close(id);
			}, LINGER_MS),
		);
	};

	const upsert = (run: RunRecord): void => {
		const prev = get().runs[run.id];
		set((state) => ({ runs: { ...state.runs, [run.id]: run } }));
		notifyIfGated(prev, run);
		// Only on the transition INTO a gate, so we don't re-fire on every frame.
		if (run.state === "waiting_gate" && prev?.state !== "waiting_gate") scheduleAutoApprove(run);
		if (ACTIVE_STATES.includes(run.state)) connect(run.id);
		else scheduleClose(run.id);
	};

	/** Drop a run and its accumulated state — the server confirmed it was deleted. */
	const removeLocal = (id: string): void => {
		close(id);
		const autoTimer = autoApproveTimers.get(id);
		if (autoTimer !== undefined) {
			window.clearTimeout(autoTimer);
			autoApproveTimers.delete(id);
		}
		set((state) => {
			if (!(id in state.runs)) return {};
			const runs = { ...state.runs };
			const events = { ...state.events };
			const sending = { ...state.sending };
			const actionBusy = { ...state.actionBusy };
			const autoApprove = { ...state.autoApprove };
			delete runs[id];
			delete events[id];
			delete sending[id];
			delete actionBusy[id];
			delete autoApprove[id];
			return { runs, events, sending, actionBusy, autoApprove };
		});
	};

	return {
		runs: {},
		events: {},
		sending: {},
		locks: null,
		actionBusy: {},
		autoApprove: {},
		loaded: false,
		loadError: null,

		start: () => {
			if (started) return;
			started = true;
			void get().loadRuns();
			void api
				.fetchLocks()
				.then((locks) => set({ locks }))
				.catch(() => {}); // older server without /api/locks — readout just stays hidden
			// Refetch on every reconnect — run frames missed while the server was
			// down (restart, crash) are not replayed, and a stale tab would keep
			// showing a dead run as live forever.
			globalStream = openGlobalStream(
				upsert,
				() => void get().loadRuns(),
				(locks) => set({ locks }),
				removeLocal,
			);
			void globalStream;
		},

		loadRuns: async () => {
			try {
				const runs = await api.fetchRuns();
				// Runs missing from the authoritative list were deleted while we were
				// away (a run-removed frame the server never replays after a restart).
				// Drop them locally so their EventSource stops reconnecting to a 404.
				const alive = new Set(runs.map((r) => r.id));
				for (const id of Object.keys(get().runs)) {
					if (!alive.has(id)) removeLocal(id);
				}
				set({
					runs: Object.fromEntries(runs.map((r) => [r.id, r])),
					loaded: true,
					loadError: null,
				});
				for (const run of runs) {
					if (ACTIVE_STATES.includes(run.state)) connect(run.id);
				}
			} catch (err) {
				set({
					loaded: true,
					loadError: err instanceof Error ? err.message : "Runs failed to load.",
				});
			}
		},

		createRun: async (req) => {
			const run = await api.createRun(req);
			upsert(run);
			return run;
		},

		sendMessage: async (id, text) => {
			set((state) => ({ sending: { ...state.sending, [id]: true } }));
			try {
				await api.sendMessage(id, text);
			} catch (err) {
				set((state) => ({ sending: { ...state.sending, [id]: false } }));
				throw err;
			}
			// Optimistic gate clear — the server's global frame confirms shortly.
			set((state) => {
				const run = state.runs[id];
				if (!run || (!run.gate && run.state !== "waiting_gate")) return {};
				return {
					runs: {
						...state.runs,
						[id]: {
							...run,
							gate: null,
							state: run.state === "waiting_gate" ? "running" : run.state,
						},
					},
				};
			});
		},

		interrupt: async (id) => {
			await api.interruptRun(id);
		},

		abort: async (id) => {
			await api.abortRun(id);
		},

		resume: async (id) => {
			await api.resumeRun(id);
		},

		deleteRun: async (id) => {
			await api.deleteRun(id);
			// The server broadcasts run-removed over SSE, but drop it locally now so
			// the card disappears immediately even on the tab that clicked.
			removeLocal(id);
		},

		runAction: async (id, action, body) => {
			set((state) => ({ actionBusy: { ...state.actionBusy, [id]: action } }));
			connect(id); // ended runs have no auto-stream — the action's output needs one
			try {
				await api.runAction(id, action, body);
			} catch (err) {
				set((state) => ({ actionBusy: { ...state.actionBusy, [id]: null } }));
				throw err;
			}
		},

		abortAction: async (id) => {
			await api.abortRunAction(id);
		},

		connectRun: (id) => {
			if (id) connect(id);
		},

		disconnectRun: (id) => {
			const run = get().runs[id];
			// Keep active runs streaming for the wall + notifications.
			if (run && ACTIVE_STATES.includes(run.state)) return;
			close(id);
		},

		setAutoApprove: (id, on) => {
			set((state) => ({ autoApprove: { ...state.autoApprove, [id]: on } }));
			if (on) {
				// Turning auto on while a gate is already open should resolve it now.
				const run = get().runs[id];
				if (run) scheduleAutoApprove(run);
			} else {
				const timer = autoApproveTimers.get(id);
				if (timer !== undefined) {
					window.clearTimeout(timer);
					autoApproveTimers.delete(id);
				}
			}
		},
	};
});
