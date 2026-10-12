import { test, expect } from "../../fixtures";
import { InventoryPage } from "../../pages";

/** Read-only checks against the signed-in product list. */
test.describe("Product list", { tag: "@smoke" }, () => {
	test("lists products with a name and a price", async ({ page }) => {
		const inventory = new InventoryPage(page);

		await test.step("WHEN the shopper opens the products page", () => inventory.open());

		await test.step("THEN products are listed", async () => {
			await expect(inventory.items).not.toHaveCount(0);
		});

		await test.step('AND the first product has a name and a price like "$29.99"', async () => {
			await expect(inventory.itemNames.first()).not.toBeEmpty();
			await expect(inventory.itemPrices.first()).toHaveText(/\$\d+\.\d{2}/);
		});
	});

	test("sorting by price low to high reorders the list", async ({ page }) => {
		const inventory = new InventoryPage(page);

		await test.step("GIVEN the shopper is on the products page", () => inventory.open());

		await test.step('WHEN the shopper sorts by "Price (low to high)"', () =>
			inventory.sortBy("lohi"));

		await test.step("THEN the prices are listed lowest first", async () => {
			const prices = await inventory.visiblePrices();
			expect(prices.length).toBeGreaterThan(1);
			expect(prices).toEqual([...prices].sort((a, b) => a - b));
		});
	});
});
