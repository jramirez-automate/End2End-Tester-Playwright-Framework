import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "../BasePage";
import { todoAppURL } from "../../utils";

/** Public TodoMVC sample. Needs no sign-in, so it runs on any machine. */
export class TodoPage extends BasePage {
	readonly newTodoInput: Locator;
	readonly items: Locator;
	readonly counter: Locator;

	constructor(page: Page) {
		super(page);
		this.newTodoInput = page.getByPlaceholder("What needs to be done?");
		this.items = page.getByTestId("todo-item");
		this.counter = page.getByTestId("todo-count");
	}

	async open() {
		await this.page.goto(todoAppURL(), { waitUntil: "domcontentloaded" });
		await expect(this.newTodoInput).toBeVisible();
	}

	item(title: string): Locator {
		return this.items.filter({ hasText: title });
	}

	async add(title: string) {
		await this.newTodoInput.fill(title);
		await this.newTodoInput.press("Enter");
	}

	async complete(title: string) {
		await this.item(title).getByRole("checkbox").check();
	}

	async filterBy(name: "All" | "Active" | "Completed") {
		await this.page.getByRole("link", { name }).click();
	}
}
