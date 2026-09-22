import { test, expect } from "../../fixtures";
import { HomePage, ItemPage } from "../../pages";
import { CleanupRegistry, e2eName, siteName } from "../../utils";

/**
 * Example write flow. Ignored until you adapt ItemPage and run with
 * E2E_INCLUDE_EXAMPLES=1. Copy this shape for each new behaviour:
 * one test, a unique name, cleanup in afterEach, one user-visible expect.
 */
test.describe("Items", { tag: "@EXAMPLE-001" }, () => {
	const cleanup = new CleanupRegistry();

	test.afterEach(async ({ page }) => {
		await cleanup.run(page);
	});

	test("creates an item that appears in the list", async ({ page }) => {
		const home = new HomePage(page);
		const items = new ItemPage(page);
		const name = e2eName("Item");

		cleanup.add((p) => new ItemPage(p).deleteByName(name));

		await home.open();
		await home.ensureSiteSelected(siteName());
		await items.gotoList();
		await items.create(name);

		await expect(items.row(name)).toBeVisible();
	});
});
