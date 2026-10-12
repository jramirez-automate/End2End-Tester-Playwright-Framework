import { test, expect } from "../../fixtures";
import { LoginPage, InventoryPage } from "../../pages";
import { credentials, credentialsConfigured } from "../../utils";

/**
 * Read-only. Safe on any environment, including production.
 * Starts from a clean session so the sign-in form is actually exercised.
 */
test.describe("Sign in", { tag: "@smoke" }, () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test.skip(() => !credentialsConfigured(), "No credentials for this environment");

	test("valid credentials reach the signed-in shell", async ({ page }) => {
		const { username, password } = credentials();
		const login = new LoginPage(page);
		const inventory = new InventoryPage(page);

		await test.step("WHEN the user signs in with this environment's credentials", () =>
			login.signIn(username, password));

		await test.step('THEN the "Products" page is shown', async () => {
			await expect(inventory.title).toHaveText("Products");
		});
	});

	test("invalid credentials are rejected with an error", async ({ page }) => {
		const login = new LoginPage(page);

		await test.step("GIVEN the user is on the sign-in page", () => login.open());

		await test.step('WHEN the user submits "wrong_user" with "wrong_password"', () =>
			login.submitCredentials("wrong_user", "wrong_password"));

		await test.step("THEN an error is shown and the password field stays on screen", async () => {
			await expect(login.errorMessage).toBeVisible();
			await expect(login.passwordInput).toBeVisible();
		});
	});
});
