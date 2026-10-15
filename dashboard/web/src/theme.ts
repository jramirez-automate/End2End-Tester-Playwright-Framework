import { useSyncExternalStore } from "react";

/**
 * Visual theme (web/DESIGN.md), written as data-theme on <html> — the id is
 * also the daisyUI theme name. Stored per browser — a viewer convenience, so
 * every storage call is guarded and the default renders without it.
 * index.html repeats the id list to apply the choice before first paint.
 */
export type ThemeId = "matrix" | "retro" | "futuristic" | "minimal";

export const THEMES: Array<{ id: ThemeId; label: string; hint: string }> = [
	{ id: "matrix", label: "Matrix", hint: "Phosphor green on black, digital rain" },
	{ id: "retro", label: "Retro", hint: "1970s print — cream, brown ink, racing stripe" },
	{ id: "futuristic", label: "Futuristic", hint: "Starship HUD — glass panels, cyan light" },
	{ id: "minimal", label: "Minimal", hint: "White paper, black ink, nothing extra" },
];

const STORAGE_KEY = "e2e-theme";
const DEFAULT_THEME: ThemeId = "matrix";

const listeners = new Set<() => void>();

function isTheme(v: unknown): v is ThemeId {
	return THEMES.some((t) => t.id === v);
}

export function readStoredTheme(): ThemeId {
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		return isTheme(stored) ? stored : DEFAULT_THEME;
	} catch {
		return DEFAULT_THEME;
	}
}

let current: ThemeId = typeof window === "undefined" ? DEFAULT_THEME : readStoredTheme();

export function getTheme(): ThemeId {
	return current;
}

export function setTheme(theme: ThemeId): void {
	current = theme;
	document.documentElement.dataset["theme"] = theme;
	try {
		window.localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// private window / blocked storage — the choice lasts this tab only
	}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useTheme(): ThemeId {
	return useSyncExternalStore(subscribe, getTheme, () => DEFAULT_THEME);
}
