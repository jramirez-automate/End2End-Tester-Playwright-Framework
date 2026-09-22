/**
 * Copy to pages/<Feature>Page.ts and export it from pages/index.ts.
 * Keep selectors in the page object. Specs call methods and assert outcomes.
 */
import { type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class FeaturePage extends BasePage {
	readonly dialog: Locator;

	constructor(page: Page) {
		super(page);
		this.dialog = page.getByRole("dialog");
	}

	async gotoList() {
		await this.goto("/<route>");
		await this.waitForPageLoad();
	}

	/** Best-effort cleanup by name. Never throws. */
	async deleteByName(_name: string): Promise<boolean> {
		return false;
	}
}
