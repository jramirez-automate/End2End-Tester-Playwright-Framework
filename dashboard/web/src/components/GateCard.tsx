import { useState } from "react";
import type { GateInfo } from "../../../shared/types";
import { renderMarkdown } from "../markdown";
import { CustomReply } from "./CustomReply";

/**
 * The amber gate banner — button-first: quick replies are the primary action,
 * free text hides behind a collapse. `busy` comes from the store's sending
 * flag so the pressed button shows a spinner until the session echoes back.
 */
export function GateCard({
	gate,
	onAnswer,
	busy = false,
	compact = false,
	auto = false,
}: {
	gate: GateInfo;
	onAnswer: (text: string) => void;
	busy?: boolean;
	compact?: boolean;
	/** Safe-auto will answer this (non-publishing) gate shortly — show a hint. */
	auto?: boolean;
}) {
	const [pressed, setPressed] = useState<string | null>(null);

	const answer = (text: string): void => {
		if (busy) return;
		setPressed(text);
		onAnswer(text);
	};

	return (
		<div
			className="flex flex-col gap-3 rounded-r-lg border-l-4 border-standby bg-ink-1 p-4"
			role="group"
			aria-live="polite"
		>
			<span className="eyebrow text-standby">Gate — the run needs your call</span>
			{compact ? (
				<p className="line-clamp-3 text-sm text-bone/90">{gate.question.slice(-220)}</p>
			) : (
				<div className="md text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(gate.question) }} />
			)}
			{auto && !busy ? (
				<div className="flex items-center gap-2 text-xs text-feed">
					<span className="loading loading-spinner loading-xs" aria-hidden />
					Auto-approving shortly — pick a choice to decide it yourself.
				</div>
			) : null}
			<div className="flex flex-wrap gap-2">
				{gate.quickReplies.map((reply) => (
					<button
						key={reply}
						type="button"
						className="btn btn-primary btn-sm"
						disabled={busy}
						onClick={() => answer(reply)}
					>
						{busy && pressed === reply ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
						{reply}
					</button>
				))}
			</div>
			{compact ? null : (
				<div className="collapse-arrow collapse border border-line bg-ink-2">
					<input type="checkbox" aria-label="Write a custom reply" />
					<div className="collapse-title min-h-0 py-2 text-xs text-putty">Custom reply…</div>
					<div className="collapse-content">
						<CustomReply onSend={answer} busy={busy} placeholder="Answer in your own words" />
					</div>
				</div>
			)}
		</div>
	);
}
