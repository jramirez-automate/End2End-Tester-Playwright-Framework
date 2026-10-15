import { useState } from "react";

/** Browser-notification opt-in (gate nudges while the tab is hidden). */
export function NotificationsSection() {
	const [permission, setPermission] = useState<NotificationPermission>(() =>
		typeof Notification === "undefined" ? "denied" : Notification.permission,
	);

	if (permission === "granted") {
		return (
			<p className="text-sm text-putty">
				<span className="mr-2 inline-block h-2 w-2 rounded-full bg-ok" aria-hidden />
				<span className="sr-only">enabled</span>
				Enabled — you get a nudge when a run hits a gate while this tab is hidden.
			</p>
		);
	}
	if (permission === "denied") {
		return (
			<p className="text-sm text-putty">
				Blocked in the browser. Allow notifications for this site (icon left of the address bar → Site settings), then
				reload.
			</p>
		);
	}
	return (
		<button
			type="button"
			className="btn btn-primary btn-sm"
			onClick={() => {
				void Notification.requestPermission().then(setPermission);
			}}
		>
			Enable notifications
		</button>
	);
}
