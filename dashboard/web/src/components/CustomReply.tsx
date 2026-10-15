import { useState } from "react";

/**
 * Free-text steering, deliberately tucked away — buttons are the primary
 * interaction; this is the escape hatch for when no button fits.
 */
export function CustomReply({
	onSend,
	busy = false,
	placeholder = "Type a custom instruction for the run",
}: {
	onSend: (text: string) => void;
	busy?: boolean;
	placeholder?: string;
}) {
	const [text, setText] = useState("");

	const send = (): void => {
		const trimmed = text.trim();
		if (!trimmed || busy) return;
		onSend(trimmed);
		setText("");
	};

	return (
		<div className="flex items-end gap-2">
			<textarea
				className="textarea textarea-bordered min-h-16 flex-1 bg-ink-0 text-sm"
				rows={2}
				placeholder={placeholder}
				value={text}
				disabled={busy}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						send();
					}
				}}
			/>
			<button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={busy || !text.trim()}>
				{busy ? <span className="loading loading-spinner loading-xs" aria-hidden /> : null}
				Send
			</button>
		</div>
	);
}
