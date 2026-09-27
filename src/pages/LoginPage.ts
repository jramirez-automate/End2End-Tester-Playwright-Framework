import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Sign-in page. Written against roles and placeholders rather than ids, so it
 * works on the demo app unchanged and is the one file most apps need to adapt.
 * Handles a single form and the email-then-password pattern.
 */
export class LoginPage extends BasePage {
	readonly usernameInput: Locator;
	readonly passwordInput: Locator;
	readonly submitButton: Locator;
	readonly errorMessage: Locator;

	constructor(page: Page) {
		super(page);
		this.usernameInput = page
			.getByRole("textbox", { name: /email|username|user name/i })
			.or(page.getByPlaceholder(/username|email/i))
			.or(page.locator("input[name='username'], input[name='email'], input[type='email']"))
			.filter({ visible: true })
			.first();
		this.passwordInput = page
			.getByLabel(/password/i)
			.or(page.getByPlaceholder(/^password$/i))
			.or(page.locator("input[type='password'], input[name='password']"))
			.filter({ visible: true })
			.first();
		this.submitButton = page
			.getByRole("button", { name: /^(sign in|log ?in|continue)$/i })
			.filter({ visible: true })
			.first();
		this.errorMessage = page
			.locator("[data-test='error'], [role='alert'], .error-message-container")
			.filter({ visible: true })
			.first();
	}

	async open() {
		const loginPath = process.env.E2E_LOGIN_PATH ?? "/";
		await this.page.goto(loginPath, { waitUntil: "domcontentloaded", timeout: 60_000 });
		// .first() on the composition, not on each side: an .or() of two
		// single-element locators still resolves to two and trips strict mode.
		await expect(this.usernameInput.or(this.passwordInput).first()).toBeVisible({
			timeout: 30_000,
		});
	}

	/** Fill and submit. Does not assert the outcome, so failure paths can assert too. */
	async submitCredentials(username: string, password: string) {
		if (await this.usernameInput.isVisible().catch(() => false)) {
			await this.usernameInput.fill(username);
		}

		// Email-first flows reveal the password field only after Continue.
		if (!(await this.passwordInput.isVisible().catch(() => false))) {
			await this.submitButton.click();
			await expect(this.passwordInput).toBeVisible({ timeout: 20_000 });
		}

		await this.passwordInput.fill(password);
		await this.submitButton.click();
	}

	/**
	 * Open the form and sign in. Waits for the password field to detach rather
	 * than for a URL: sign-in URLs embed redirect_uri, so a URL match can pass
	 * while the browser is still on the identity provider.
	 */
	async signIn(username: string, password: string) {
		await this.open();
		await this.submitCredentials(username, password);
		await expect(this.passwordInput).toBeHidden({ timeout: 30_000 });
	}
}
