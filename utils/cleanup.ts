import type { Page } from "@playwright/test";

type CleanupTask = (page: Page) => Promise<unknown>;

/**
 * LIFO registry of best-effort cleanup for data a spec creates.
 * Register a task right after you create something; run it in test.afterEach.
 * Last-in-first-out so dependents are removed before the records they need.
 * Failures are swallowed — cleanup must never fail the run.
 */
export class CleanupRegistry {
	private tasks: CleanupTask[] = [];

	add(task: CleanupTask): void {
		this.tasks.push(task);
	}

	async run(page: Page): Promise<void> {
		while (this.tasks.length) {
			const task = this.tasks.pop() as CleanupTask;
			await task(page).catch(() => undefined);
		}
	}
}
