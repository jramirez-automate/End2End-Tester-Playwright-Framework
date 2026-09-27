/**
 * Allure reporter wiring.
 *
 * Allure is the **run** report: what the last execution did, how it trended,
 * which failures cluster together. It is not the acceptance record. Ticket
 * proof is the EVIDENCE=true bundle published by scripts/publish.mjs, because
 * Allure has no notion of a TC id or an acceptance criterion.
 *
 * Consumed by playwright.config.ts; report generation is allurerc.mjs.
 */
import type { Label, TestResult } from "allure-js-commons";

import { currentTestEnv, playwrightBaseURL, siteName } from "./env";

/** Jira browse URL for issue links, e.g. https://your-tenant.atlassian.net/browse. Unset adds none. */
const JIRA_BROWSE = (process.env.ALLURE_JIRA_BROWSE_URL ?? "").replace(/\/$/, "");

/** Describe tags that are ticket keys, e.g. @ABC-123. */
const TICKET_TAG = new RegExp(process.env.ALLURE_TICKET_PATTERN ?? "^@?([A-Z][A-Z0-9]*-\\d+)$");

/**
 * Feature area and severity per ticket, so the report groups the way a release
 * readout does and the severity chart is not one flat bar. Band severity from
 * whatever risk scoring sequenced the work:
 *
 *   blocker   sign-in, permissions, anything that gates the rest of the suite
 *   critical  primary revenue or data paths
 *   normal    supporting features
 *   minor     cosmetic, secondary screens
 *   trivial   reporting, exports
 */
export const STORIES: Record<string, { area: string; severity: string }> = {
	"DEMO-001": { area: "Checkout", severity: "critical" },
};

/**
 * Promote describe tags to links, areas and severities here rather than with
 * allure.issue() in every test: the tag is already the traceability
 * convention, and specs stay free of reporting code.
 */
function linkTicketTags(result: TestResult): void {
	const keys = (result.labels ?? [])
		.filter((label: Label) => label.name === "tag")
		.map((label: Label) => TICKET_TAG.exec(label.value)?.[1])
		.filter((key): key is string => Boolean(key));

	for (const key of keys) {
		if (JIRA_BROWSE && !result.links?.some((link) => link.url?.endsWith(`/${key}`))) {
			result.links = [
				...(result.links ?? []),
				{ type: "issue", name: key, url: `${JIRA_BROWSE}/${key}` },
			];
		}

		const story = STORIES[key];
		if (!story) continue;
		// The default parentSuite is the project name, which puts every test under
		// one "chromium" node. The feature area is the grouping worth having.
		result.labels = [
			...result.labels.filter((label) => label.name !== "parentSuite" && label.name !== "severity"),
			{ name: "parentSuite", value: story.area },
			{ name: "severity", value: story.severity },
		];
	}
}

/**
 * Buckets for the Categories view. They describe shapes of failure rather than
 * specific defects: a shape survives the next release, a message from one
 * build does not.
 */
const CATEGORIES = [
	{
		name: "Environment unreachable",
		description: "The host did not answer. Not a defect in the feature under test.",
		messageRegex: ".*(ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ECONNREFUSED|net::ERR).*",
		matchedStatuses: ["failed", "broken"],
	},
	{
		name: "Server rejected the request",
		description: "The app called its own API and got a 4xx or 5xx.",
		messageRegex: ".*(status code 4\\d\\d|status code 5\\d\\d|Internal Server Error).*",
		matchedStatuses: ["failed", "broken"],
	},
	{
		name: "Waiting for something that never appeared",
		description:
			"Timeout on a locator or navigation. A stale selector fails exactly like a missing control, so read error-context.md before blaming the product.",
		messageRegex: ".*(Timeout .* exceeded|waiting for locator|waiting for navigation).*",
		matchedStatuses: ["failed", "broken"],
	},
	{
		name: "Assertion failed",
		description: "The behaviour ran but did not match the criterion.",
		messageRegex: ".*expect.*",
		matchedStatuses: ["failed"],
	},
	{
		name: "Flaky",
		description: "Passed only after a retry. Triage before trusting either result.",
		matchedStatuses: ["passed", "failed", "broken"],
		flaky: true,
	},
];

export function allureReporterOptions(testEnv = currentTestEnv()) {
	return {
		resultsDir: "allure-results",
		...(JIRA_BROWSE
			? { links: { issue: { urlTemplate: `${JIRA_BROWSE}/%s`, nameTemplate: "%s" } } }
			: {}),
		// Environments are redeployed mid-cycle, so a green report only means
		// something against a named build. Set APP_VERSION from the deploy.
		environmentInfo: {
			"Test env": testEnv,
			"Base URL": playwrightBaseURL(),
			Site: siteName() || "n/a",
			"App version": process.env.APP_VERSION ?? "unset",
			Ticket: process.env.TICKET ?? "full suite",
			Evidence: process.env.EVIDENCE === "true" ? "capturing" : "off",
			Commit: process.env.GITHUB_SHA ?? "local",
			CI: process.env.CI ? "yes" : "no",
			Node: process.version,
		},
		categories: CATEGORIES,
		listeners: [{ beforeTestResultWrite: linkTicketTags }],
	};
}
