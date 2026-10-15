import type { ReactNode } from "react";
import { useUiConfig } from "../state/useUiConfig";

/** A ticket key linked to the tracker (JIRA_BASE_URL in .env.publish), else plain text. */
export function TrackerLink({ ticket, className, children }: { ticket: string; className?: string; children?: ReactNode }) {
	const base = useUiConfig().data?.trackerBrowseUrl;
	if (!base) return <span className={className}>{children ?? ticket}</span>;
	return (
		<a className={`link ${className ?? ""}`} href={`${base}${ticket}`} target="_blank" rel="noopener noreferrer">
			{children ?? ticket}
		</a>
	);
}
