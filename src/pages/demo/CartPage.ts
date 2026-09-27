import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "../BasePage";

/** Cart of the public demo shop. */
export class CartPage extends BasePage {
	readonly title: Locator;
	readonly items: Locator;
	readonly checkoutButton: Locator;

	constructor(page: Page) {
		super(page);
		this.title = page.locator(".title");
		this.items = page.locator(".cart_item");
		this.checkoutButton = page.locator("[data-test='checkout']");
	}

	async open() {
		await this.goto("/cart.html");
		await expect(this.title).toHaveText("Your Cart");
	}

	item(name: string): Locator {
		return this.items.filter({ hasText: name });
	}

	async checkout() {
		await this.checkoutButton.click();
	}

	/** Best-effort cleanup so a failed run does not leave a full cart behind. */
	async removeAll(): Promise<void> {
		const remove = this.page.getByRole("button", { name: /^remove$/i });
		for (let count = await remove.count(); count > 0; count = await remove.count()) {
			await remove.first().click().catch(() => undefined);
		}
	}
}
