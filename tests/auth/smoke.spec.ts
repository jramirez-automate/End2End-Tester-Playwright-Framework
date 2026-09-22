import { test } from "../../fixtures";
import { HomePage } from "../../pages";
import { siteName } from "../../utils";

/**
 * Read-only. Safe on every environment, including production.
 * Asserts the saved session restores and the app shell renders.
 */
test.describe("Smoke", { tag: "@smoke" }, () => {
	test("signs in and shows the home shell", async ({ page }) => {
		const home = new HomePage(page);
		await home.open();
		await home.expectSignedIn();

		const site = (process.env.E2E_SITE_NAME ?? "").trim();
		if (site) {
			await home.ensureSiteSelected(siteName());
		}
	});
});
