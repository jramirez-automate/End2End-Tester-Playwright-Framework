import { expect, type Page } from "@playwright/test";
import { BasePage, escapeRegex } from "./BasePage";

/** Signed-in landing page. Point E2E_HOME_PATH / E2E_HOME_HEADING at your shell. */
export class HomePage extends BasePage {
	constructor(page: Page) {
		super(page);
	}

	async open() {
		const homePath = process.env.E2E_HOME_PATH ?? "/";
		await this.goto(homePath);
		await this.dismissBlockingDialog();
		await this.waitForPageLoad();
	}

	/** Proves the session restored and the shell rendered. */
	async expectSignedIn() {
		const heading = (process.env.E2E_HOME_HEADING ?? "").trim();
		if (heading) {
			await expect(this.heading(new RegExp(escapeRegex(heading), "i"))).toBeVisible();
			return;
		}
		await expect(this.page.getByRole("heading").first()).toBeVisible();
	}

	/**
	 * Confirm the configured site is already selected.
	 * Replace the button lookup with your app's site switcher.
	 */
	async ensureSiteSelected(name: string) {
		if (!name) return;
		const selected = this.page
			.getByRole("button", { name: new RegExp(escapeRegex(name), "i") })
			.filter({ visible: true })
			.first();
		if (await selected.isVisible().catch(() => false)) return;
		throw new Error(
			`Site "${name}" is not selected. Implement HomePage.ensureSiteSelected for your site switcher.`,
		);
	}
}
