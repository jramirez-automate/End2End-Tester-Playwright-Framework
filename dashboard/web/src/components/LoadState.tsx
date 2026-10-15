/** Skeleton while loading, error with Retry on failure, nothing once data is in. */
export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
	if (error) {
		return (
			<div className="alert alert-error text-sm">
				<span>{error}</span>
				<button type="button" className="btn btn-sm" onClick={onRetry}>
					Retry
				</button>
			</div>
		);
	}
	if (!loading) return null;
	return (
		<div className="flex flex-col gap-2" aria-live="polite">
			<span className="sr-only">Loading…</span>
			<div className="skeleton h-8 w-full bg-ink-2" />
			<div className="skeleton h-8 w-full bg-ink-2" />
			<div className="skeleton h-8 w-2/3 bg-ink-2" />
		</div>
	);
}
