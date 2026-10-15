import { useCallback, useRef } from "react";
import type { JiraStatusResponse } from "../../../shared/types";
import { fetchJiraIssues } from "./api";
import { useLoad, type Loaded } from "./useLoad";

/**
 * Jira status for the tracker views. The server caches it for 5 minutes;
 * `refresh()` (the views' Refresh button) asks it to re-read Jira instead.
 */
export function useJira(): Loaded<JiraStatusResponse> & { refresh: () => void } {
	const fresh = useRef(false);
	const loaded = useLoad(() => {
		const skipCache = fresh.current;
		fresh.current = false;
		return fetchJiraIssues(skipCache);
	}, "jira");
	const { reload } = loaded;
	const refresh = useCallback(() => {
		fresh.current = true;
		reload();
	}, [reload]);
	return { ...loaded, refresh };
}
