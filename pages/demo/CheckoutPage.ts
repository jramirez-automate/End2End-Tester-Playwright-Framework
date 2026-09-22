import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "../BasePage";

export interface CheckoutDetails {
	firstName: string;
	lastName: string;
	postalCode: string;
}

/** Two-step checkout of the public demo shop. */
export class CheckoutPage extends BasePage {
	readonly firstNameInput: Locator;
	readonly lastNameInput: Locator;
	readonly postalCodeInput: Locator;
	readonly continueButton: Locator;
	readonly finishButton: Locator;
	readonly total: Locator;
	readonly confirmation: Locator;
	readonly errorMessage: Locator;

	constructor(page: Page) {
		super(page);
		this.firstNameInput = page.locator("[data-test='firstName']");
		this.lastNameInput = page.locator("[data-test='lastName']");
		this.postalCodeInput = page.locator("[data-test='postalCode']");
		this.continueButton = page.locator("[data-test='continue']");
		this.finishButton = page.locator("[data-test='finish']");
		this.total = page.locator(".summary_total_label");
		this.confirmation = page.locator(".complete-header");
		this.errorMessage = page.locator("[data-test='error']");
	}

	async fillDetails({ firstName, lastName, postalCode }: CheckoutDetails) {
		await this.firstNameInput.fill(firstName);
		await this.lastNameInput.fill(lastName);
		await this.postalCodeInput.fill(postalCode);
	}

	async continue() {
		await this.continueButton.click();
	}

	async finish() {
		await this.finishButton.click();
		await expect(this.confirmation).toBeVisible();
	}
}
