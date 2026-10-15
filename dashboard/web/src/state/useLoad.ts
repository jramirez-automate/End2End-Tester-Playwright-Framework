import { useCallback, useEffect, useState } from "react";

export interface Loaded<T> {
	data: T | null;
	error: string | null;
	loading: boolean;
	reload: () => void;
}

/**
 * One-shot fetch for the read-only tracker views: re-runs when `key` changes,
 * ignores responses that land after unmount or a newer request.
 */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		load()
			.then((value) => {
				if (!alive) return;
				setData(value);
				setError(null);
			})
			.catch((err: unknown) => {
				if (alive) setError(err instanceof Error ? err.message : "Request failed.");
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the request
	}, [key, nonce]);

	const reload = useCallback(() => setNonce((n) => n + 1), []);
	return { data, error, loading, reload };
}
