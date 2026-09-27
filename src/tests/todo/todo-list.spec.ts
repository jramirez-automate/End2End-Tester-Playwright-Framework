import { test, expect } from "../../fixtures";
import { TodoPage } from "../../pages";
import { e2eName } from "../../utils";

/**
 * A second public app, with no sign-in at all. Shows that specs name the data
 * they create with e2eName so parallel runs never collide.
 */
test.describe("Todo list", { tag: "@DEMO-002" }, () => {
	test("adds an item and counts it as remaining", async ({ page }) => {
		const todos = new TodoPage(page);
		const title = e2eName("Todo");

		await todos.open();
		await todos.add(title);

		await expect(todos.item(title)).toBeVisible();
		await expect(todos.counter).toHaveText(/1 item left/i);
	});

	test("completing an item moves it out of the active filter", async ({ page }) => {
		const todos = new TodoPage(page);
		const done = e2eName("Done");
		const pending = e2eName("Pending");

		await todos.open();
		await todos.add(done);
		await todos.add(pending);
		await todos.complete(done);

		await todos.filterBy("Active");
		await expect(todos.item(pending)).toBeVisible();
		await expect(todos.item(done)).toHaveCount(0);

		await todos.filterBy("Completed");
		await expect(todos.item(done)).toBeVisible();
	});
});
