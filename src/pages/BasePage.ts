import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared page-object base. Product selectors stay in the subclass, not in specs.
 */
export abstract class BasePage {
	readonly page: Page;
	readonly loadingIndicator: Locator;

	constructor(page: Page) {
		this.page = page;
		this.loadingIndicator = page.locator(
			"[aria-busy='true'], [data-testid='loading'], [role='progressbar']",
		);
	}

	async goto(path = "/") {
		await this.page.goto(path, { waitUntil: "domcontentloaded" });
	}

	/** Best-effort. Returns immediately when no busy indicator is on screen. */
	async waitForPageLoad() {
		const indicator = this.loadingIndicator.first();
		if (await indicator.isVisible().catch(() => false)) {
			await indicator.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
		}
	}

	heading(name: string | RegExp): Locator {
		return this.page.getByRole("heading", { name }).filter({ visible: true }).first();
	}

	/**
	 * Click through a first-run dialog (Got it / Next / Skip / Close).
	 * No-op when nothing is open.
	 */
	async dismissBlockingDialog(timeout = 5_000) {
		const dialog = this.page.getByRole("dialog").filter({ visible: true }).first();
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			if (!(await dialog.isVisible().catch(() => false))) return;
			const button = dialog
				.getByRole("button", { name: /^(got it|next|finish|skip|close|ok|dismiss)$/i })
				.first();
			if (!(await button.isVisible().catch(() => false))) return;
			await button.click();
			await dialog.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => undefined);
		}
	}
}

export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function expectVisibleHeading(page: Page, name: string): Promise<void> {
	await expect(page.getByRole("heading", { name: new RegExp(escapeRegex(name), "i") }).first()).toBeVisible();
}
