import { spawn } from "node:child_process";

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM = exists but owned by someone else — still alive.
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Send a signal to the whole process group (children are spawned detached on POSIX). */
export function signalTree(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// already gone
		}
	}
}

export function killTree(pid: number): void {
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
		return;
	}
	signalTree(pid, "SIGKILL");
}
