import { useEffect, useState } from "react";

/** Re-renders on an interval; returns Date.now(). Drives elapsed clocks. */
export function useNow(intervalMs = 1000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}

/** Shown for a missing/non-finite value (e.g. a timestamp that failed to parse). */
const NO_VALUE = "—";

/** m:ss under an hour, h:mm:ss beyond. */
export function formatElapsed(ms: number): string {
	if (!Number.isFinite(ms)) return NO_VALUE;
	const total = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const mm = String(minutes).padStart(2, "0");
	const ss = String(seconds).padStart(2, "0");
	return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/** Compact duration: 12s, 3m 04s, 1h 02m. */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms)) return NO_VALUE;
	const total = Math.max(0, Math.round(ms / 1000));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatCost(usd: number): string {
	if (!Number.isFinite(usd)) return NO_VALUE;
	return `$${usd.toFixed(2)}`;
}

/** Compact token count: 842, 4.2k, 1.3M. */
export function formatTokens(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "0";
	if (n < 1000) return String(Math.round(n));
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "just now", "12m ago", "3h ago", "4d ago", then the date. */
export function formatAgo(iso: string, now = Date.now()): string {
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return NO_VALUE;
	const minutes = Math.floor((now - then) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 14) return `${days}d ago`;
	return new Date(then).toISOString().slice(0, 10);
}

/** 0.8667 → "87%". */
export function formatPercent(ratio: number): string {
	if (!Number.isFinite(ratio)) return NO_VALUE;
	return `${Math.round(ratio * 100)}%`;
}
