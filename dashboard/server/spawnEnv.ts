/**
 * VSCode's "Auto Attach" (and launching a debug session) injects a debugger into
 * every child node process via
 *   NODE_OPTIONS=--require .../ms-vscode.js-debug/src/bootloader.js --inspect-publish-uid=…
 *   VSCODE_INSPECTOR_OPTIONS={"autoAttachMode":"always",…}
 * When the dashboard server is started from that terminal, those vars are inherited
 * by every `claude`/`npm` child it spawns. The bootloader + `--inspect` injected into
 * a nested node CLI like `claude` makes it exit 1 at startup with no output. Strip the
 * injection so children run in a clean node environment.
 */
const DEBUGGER_ENV_KEYS = [
	"NODE_OPTIONS",
	"VSCODE_INSPECTOR_OPTIONS",
	"NODE_INSPECT_RESUME_ON_START",
] as const;

export function cleanSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...base };
	for (const key of DEBUGGER_ENV_KEYS) delete env[key];
	return env;
}
