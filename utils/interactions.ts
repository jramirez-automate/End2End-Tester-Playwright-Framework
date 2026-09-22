import type { Locator, Page } from "@playwright/test";

export interface ModalThenToastOptions {
	modal: Locator;
	toast: Locator;
	modalTimeout?: number;
	toastTimeout?: number;
}

/** Wait until the dialog is gone, then until the success toast is visible. */
export async function waitForModalDetachedThenToast({
	modal,
	toast,
	modalTimeout = 15_000,
	toastTimeout = 10_000,
}: ModalThenToastOptions): Promise<void> {
	await modal.waitFor({ state: "detached", timeout: modalTimeout });
	await toast.waitFor({ state: "visible", timeout: toastTimeout });
}

export interface CollectedPageErrors {
	consoleErrors: string[];
	failedResponses: string[];
}

/**
 * Record console errors and HTTP responses at or above minStatus (default 400).
 * Call this before the action under test.
 */
export function collectPageErrors(
	page: Page,
	opts?: { minStatus?: number },
): CollectedPageErrors {
	const consoleErrors: string[] = [];
	const failedResponses: string[] = [];
	const minStatus = opts?.minStatus ?? 400;
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("response", (response) => {
		if (response.status() >= minStatus) {
			failedResponses.push(`${response.status()} ${response.url()}`);
		}
	});
	return { consoleErrors, failedResponses };
}
