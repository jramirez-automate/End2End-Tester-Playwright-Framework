import { test, expect } from "../../fixtures";
import { CartPage, CheckoutPage, InventoryPage } from "../../pages";
import { CleanupRegistry } from "../../utils";

const BACKPACK = "Sauce Labs Backpack";
const BIKE_LIGHT = "Sauce Labs Bike Light";

/**
 * The state-changing example. Anything a test adds is removed in afterEach
 * through the cleanup registry, the same contract a real suite needs.
 */
test.describe("Cart and checkout", { tag: "@DEMO-001" }, () => {
	const cleanup = new CleanupRegistry();

	test.afterEach(async ({ page }) => {
		cleanup.add(async (p) => {
			const cart = new CartPage(p);
			await cart.open();
			await cart.removeAll();
		});
		await cleanup.run(page);
	});

	test("adding products updates the cart badge", async ({ page }) => {
		const inventory = new InventoryPage(page);
		await inventory.open();

		await inventory.addToCart(BACKPACK);
		await inventory.addToCart(BIKE_LIGHT);

		await expect(inventory.cartBadge).toHaveText("2");
	});

	test("a cart can be checked out to a confirmation", async ({ page }) => {
		const inventory = new InventoryPage(page);
		const cart = new CartPage(page);
		const checkout = new CheckoutPage(page);

		await inventory.open();
		await inventory.addToCart(BACKPACK);
		await inventory.openCart();

		await expect(cart.item(BACKPACK)).toBeVisible();
		await cart.checkout();

		await checkout.fillDetails({
			firstName: "Ada",
			lastName: "Lovelace",
			postalCode: "2000",
		});
		await checkout.continue();
		await expect(checkout.total).toContainText(/total/i);
		await checkout.finish();

		await expect(checkout.confirmation).toHaveText(/thank you for your order/i);
	});

	test("checkout rejects missing details", async ({ page }) => {
		const inventory = new InventoryPage(page);
		const cart = new CartPage(page);
		const checkout = new CheckoutPage(page);

		await inventory.open();
		await inventory.addToCart(BACKPACK);
		await inventory.openCart();
		await cart.checkout();

		await checkout.continue();

		await expect(checkout.errorMessage).toContainText(/first name is required/i);
	});
});
