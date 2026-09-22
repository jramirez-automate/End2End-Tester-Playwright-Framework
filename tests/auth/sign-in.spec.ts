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

		await login.signIn(username, password);

		await expect(inventory.title).toHaveText("Products");
	});

	test("invalid credentials are rejected with an error", async ({ page }) => {
		const login = new LoginPage(page);

		await login.open();
		await login.submitCredentials("wrong_user", "wrong_password");

		await expect(login.errorMessage).toBeVisible();
		await expect(login.passwordInput).toBeVisible();
	});
});
