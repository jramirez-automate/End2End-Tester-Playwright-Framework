import type { UiConfig } from "../../../shared/types";
import { fetchConfig } from "./api";
import { useLoad, type Loaded } from "./useLoad";

/** The server config never changes while it runs, so every view shares one request. */
let pending: Promise<UiConfig> | null = null;

function loadConfig(): Promise<UiConfig> {
	pending ??= fetchConfig().catch((err: unknown) => {
		pending = null;
		throw err;
	});
	return pending;
}

export function useUiConfig(): Loaded<UiConfig> {
	return useLoad(loadConfig, "config");
}
