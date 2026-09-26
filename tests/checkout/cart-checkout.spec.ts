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

		await test.step("GIVEN the shopper is on the products page", () => inventory.open());

		await test.step(`WHEN the shopper adds "${BACKPACK}" and "${BIKE_LIGHT}" to the cart`, async () => {
			await inventory.addToCart(BACKPACK);
			await inventory.addToCart(BIKE_LIGHT);
		});

		await test.step("THEN the cart badge shows 2", async () => {
			await expect(inventory.cartBadge).toHaveText("2");
		});
	});

	test("a cart can be checked out to a confirmation", async ({ page }) => {
		const inventory = new InventoryPage(page);
		const cart = new CartPage(page);
		const checkout = new CheckoutPage(page);

		await test.step(`GIVEN the shopper adds "${BACKPACK}" to the cart`, async () => {
			await inventory.open();
			await inventory.addToCart(BACKPACK);
		});

		await test.step(`WHEN the shopper opens the cart, "${BACKPACK}" is listed`, async () => {
			await inventory.openCart();
			await expect(cart.item(BACKPACK)).toBeVisible();
		});

		await test.step('AND checks out as "Ada Lovelace" with postcode "2000"', async () => {
			await cart.checkout();
			await checkout.fillDetails({
				firstName: "Ada",
				lastName: "Lovelace",
				postalCode: "2000",
			});
			await checkout.continue();
		});

		await test.step("AND the order overview shows a total", async () => {
			await expect(checkout.total).toContainText(/total/i);
		});

		await test.step("AND confirms the order with Finish", () => checkout.finish());

		await test.step('THEN the page shows "Thank you for your order!"', async () => {
			await expect(checkout.confirmation).toHaveText(/thank you for your order/i);
		});
	});

	test("checkout rejects missing details", async ({ page }) => {
		const inventory = new InventoryPage(page);
		const cart = new CartPage(page);
		const checkout = new CheckoutPage(page);

		await test.step(`GIVEN the shopper has "${BACKPACK}" in the cart and starts checkout`, async () => {
			await inventory.open();
			await inventory.addToCart(BACKPACK);
			await inventory.openCart();
			await cart.checkout();
		});

		await test.step("WHEN the shopper continues without filling in any details", () => checkout.continue());

		await test.step('THEN the error "First Name is required" is shown', async () => {
			await expect(checkout.errorMessage).toContainText(/first name is required/i);
		});
	});
});
