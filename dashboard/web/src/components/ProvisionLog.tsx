import { useEffect, useRef } from "react";

const TAIL_LINES = 200;

/**
 * Step 0's streaming workspace log (git worktree add, env copy, npm install).
 * Auto-scrolling and open while provisioning; collapses into a details
 * disclosure once the step is over — the same idiom as ToolCallCard.
 */
export function ProvisionLog({ lines, live }: { lines: string[]; live: boolean }) {
	if (lines.length === 0) return null;
	if (live) return <LogBox lines={lines} follow />;
	return (
		<details className="mt-1">
			<summary className="cursor-pointer font-mono text-[11px] text-putty">
				workspace log ({lines.length} lines)
			</summary>
			<LogBox lines={lines} />
		</details>
	);
}

/** Mono streaming log box — shared by the provision log and partial-action output. */
export function LogBox({ lines, follow = false }: { lines: string[]; follow?: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	const tail = lines.slice(-TAIL_LINES);

	useEffect(() => {
		const el = ref.current;
		if (el && follow) el.scrollTop = el.scrollHeight;
	}, [lines.length, follow]);

	return (
		<div
			ref={ref}
			className="mt-1 max-h-40 overflow-y-auto rounded bg-ink-0 p-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-putty"
			aria-label="Workspace provisioning log"
		>
			{tail.map((line, i) => (
				// Log lines are append-only — index keys are stable here.
				// eslint-disable-next-line react/no-array-index-key
				<div key={i}>{line}</div>
			))}
		</div>
	);
}
