/**
 * Copy to tests/<feature>/<name>.spec.ts.
 * Write one test, run it alone, then the next.
 * Tag the describe with the ticket id: { tag: "@ABC-123" }.
 */
import { test, expect } from "../../fixtures";
import { HomePage } from "../../pages";
import { CleanupRegistry, e2eName, siteName } from "../../utils";

test.describe("<Feature>", { tag: "@ABC-123" }, () => {
	const cleanup = new CleanupRegistry();

	test.afterEach(async ({ page }) => {
		await cleanup.run(page);
	});

	test("<what the user can see>", async ({ page }) => {
		const home = new HomePage(page);
		const name = e2eName("<Kind>");

		// cleanup.add((p) => new FeaturePage(p).deleteByName(name));

		await home.open();
		await home.ensureSiteSelected(siteName());

		await expect(page.getByText(name)).toBeVisible();
	});
});
