import type { Locator, Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Example feature page. Replace the route and selectors with a real screen,
 * or delete this file together with tests/example/items.spec.ts.
 *
 * Assumed UI: a list at /items, a Create button, a dialog with a Name field
 * and Save, and a row action named Delete.
 */
export class ItemPage extends BasePage {
	readonly dialog: Locator;
	readonly createButton: Locator;
	readonly nameInput: Locator;
	readonly saveButton: Locator;

	constructor(page: Page) {
		super(page);
		this.dialog = page.getByRole("dialog");
		this.createButton = page.getByRole("button", { name: /^create$/i });
		this.nameInput = this.dialog.getByRole("textbox", { name: /name/i });
		this.saveButton = this.dialog.getByRole("button", { name: /^save$/i });
	}

	row(name: string): Locator {
		return this.page.getByRole("row", { name });
	}

	async gotoList() {
		await this.goto("/items");
		await this.waitForPageLoad();
	}

	async create(name: string) {
		await this.createButton.click();
		await expectDialog(this);
		await this.nameInput.fill(name);
		await this.saveButton.click();
		await this.dialog.waitFor({ state: "hidden" });
	}

	/** Best-effort. Never throws. */
	async deleteByName(name: string): Promise<boolean> {
		try {
			const row = this.row(name);
			if (!(await row.isVisible().catch(() => false))) return false;
			await row.getByRole("button", { name: /delete/i }).click();
			const confirm = this.page.getByRole("button", { name: /^(confirm|delete)$/i }).last();
			await confirm.click();
			return true;
		} catch {
			return false;
		}
	}
}

async function expectDialog(page: ItemPage) {
	await page.dialog.waitFor({ state: "visible" });
}
