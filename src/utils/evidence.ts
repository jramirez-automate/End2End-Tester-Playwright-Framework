import type { Browser, Locator } from "@playwright/test";

/**
 * Centre `subject` in the viewport for an evidence shot. On a page with CSS smooth scrolling a
 * plain `scrollIntoView()` / `scrollIntoViewIfNeeded()` animates, and an immediate screenshot
 * catches the pre-scroll frame. `behavior: "instant"` overrides the smooth scrolling; two
 * animation frames let the page paint before capturing.
 */
export async function centerInViewport(subject: Locator): Promise<void> {
	await subject.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
	await subject
		.page()
		.evaluate(
			() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
		);
}

/** One labelled panel of a spliced evidence image. */
export interface EvidencePanel {
	label: string;
	/** PNG bytes, e.g. from `locator.screenshot()`. */
	body: Buffer;
}

const escapeHtml = (s: string) =>
	s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Splice several screenshots into one labelled PNG, stacked top to bottom: a before / after
 * pair proves a change that a single end-state shot cannot, such as a removed row that is only
 * shown gone next to a shot where it was listed.
 *
 * Renders the panels in a throwaway browser context, so no image library is needed, and that
 * context records no video, so the test's own `.webm` is untouched. Attach the result as
 * `test.info().attach("screenshot", { body, contentType: "image/png" })` so `evidence-reporter.ts`
 * keeps it as the test's `<title>-<env>.png`.
 */
export async function spliceScreenshots(
	browser: Browser,
	panels: EvidencePanel[],
): Promise<Buffer> {
	const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
	try {
		const page = await context.newPage();
		const figures = panels
			.map(
				(p) =>
					`<figure><figcaption>${escapeHtml(p.label)}</figcaption>` +
					`<img src="data:image/png;base64,${p.body.toString("base64")}"></figure>`,
			)
			.join("");
		await page.setContent(
			`<html><head><style>
				body { margin: 0; padding: 16px; background: #fff; font: 600 22px system-ui, sans-serif; }
				figure { margin: 0 0 24px; }
				figcaption { margin: 0 0 8px; color: #1b1b1b; }
				img { display: block; max-width: 100%; border: 2px solid #c8c8c8; }
			</style></head><body>${figures}</body></html>`,
		);
		await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
		return await page.screenshot({ fullPage: true });
	} finally {
		await context.close();
	}
}
