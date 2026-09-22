import { test, expect } from "../../fixtures";
import { InventoryPage } from "../../pages";

/** Read-only checks against the signed-in product list. */
test.describe("Product list", { tag: "@smoke" }, () => {
	test("lists products with a name and a price", async ({ page }) => {
		const inventory = new InventoryPage(page);
		await inventory.open();

		await expect(inventory.items).not.toHaveCount(0);
		await expect(inventory.itemNames.first()).not.toBeEmpty();
		await expect(inventory.itemPrices.first()).toHaveText(/\$\d+\.\d{2}/);
	});

	test("sorting by price low to high reorders the list", async ({ page }) => {
		const inventory = new InventoryPage(page);
		await inventory.open();

		await inventory.sortBy("lohi");

		const prices = await inventory.visiblePrices();
		expect(prices.length).toBeGreaterThan(1);
		expect(prices).toEqual([...prices].sort((a, b) => a - b));
	});
});
