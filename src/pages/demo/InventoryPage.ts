import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "../BasePage";

/** Product list of the public demo shop. */
export class InventoryPage extends BasePage {
	readonly title: Locator;
	readonly items: Locator;
	readonly itemNames: Locator;
	readonly itemPrices: Locator;
	readonly sortSelect: Locator;
	readonly cartLink: Locator;
	readonly cartBadge: Locator;

	constructor(page: Page) {
		super(page);
		this.title = page.locator(".title");
		this.items = page.locator(".inventory_item");
		this.itemNames = page.locator(".inventory_item_name");
		this.itemPrices = page.locator(".inventory_item_price");
		this.sortSelect = page.locator("[data-test='product-sort-container']");
		this.cartLink = page.locator(".shopping_cart_link");
		this.cartBadge = page.locator(".shopping_cart_badge");
	}

	async open() {
		await this.goto("/inventory.html");
		await expect(this.title).toHaveText("Products");
	}

	item(name: string): Locator {
		return this.items.filter({ hasText: name });
	}

	async addToCart(name: string) {
		await this.item(name).getByRole("button", { name: /add to cart/i }).click();
	}

	async removeFromCart(name: string) {
		const remove = this.item(name).getByRole("button", { name: /^remove$/i });
		if (await remove.isVisible().catch(() => false)) await remove.click();
	}

	async sortBy(option: "az" | "za" | "lohi" | "hilo") {
		await this.sortSelect.selectOption(option);
	}

	/** Prices in the order the page renders them, as numbers. */
	async visiblePrices(): Promise<number[]> {
		const texts = await this.itemPrices.allTextContents();
		return texts.map((text) => Number(text.replace(/[^0-9.]/g, "")));
	}

	async openCart() {
		await this.cartLink.click();
	}
}
