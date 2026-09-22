import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Generic sign-in. Adapt the locators to your app — labels and roles first.
 * Supports a single form, or email-then-password (Continue, then the password field).
 */
export class LoginPage extends BasePage {
	readonly usernameInput: Locator;
	readonly passwordInput: Locator;
	readonly submitButton: Locator;

	constructor(page: Page) {
		super(page);
		this.usernameInput = page
			.getByRole("textbox", { name: /email|username|user name/i })
			.or(page.locator("input[type='email'], input[name='username'], input[name='email']"))
			.filter({ visible: true })
			.first();
		this.passwordInput = page
			.getByLabel(/password/i)
			.or(page.locator("input[type='password'], input[name='password']"))
			.filter({ visible: true })
			.first();
		this.submitButton = page
			.getByRole("button", { name: /sign in|log in|login|continue/i })
			.filter({ visible: true })
			.first();
	}

	async open() {
		const loginPath = process.env.E2E_LOGIN_PATH ?? "/";
		await this.page.goto(loginPath, {
			waitUntil: "domcontentloaded",
			timeout: 60_000,
		});
		await expect(this.usernameInput.or(this.passwordInput)).toBeVisible({ timeout: 30_000 });
	}

	async login(username: string, password: string) {
		await this.open();

		if (await this.usernameInput.isVisible().catch(() => false)) {
			await this.usernameInput.fill(username);
		}

		if (!(await this.passwordInput.isVisible().catch(() => false))) {
			await this.submitButton.click();
			await expect(this.passwordInput).toBeVisible({ timeout: 20_000 });
		}

		await this.passwordInput.fill(password);
		await this.submitButton.click();
		await expect(this.passwordInput).toBeHidden({ timeout: 30_000 });
	}
}
