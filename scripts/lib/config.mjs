import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Publishing configuration. Every provider, project, space, and ticket prefix
 * comes from here, so the pipeline carries no knowledge of any one product.
 *
 * Credentials live in .env.publish (gitignored) or in CI secrets.
 */
const ENV_FILE = path.resolve(process.cwd(), ".env.publish");
if (fs.existsSync(ENV_FILE)) dotenv.config({ path: ENV_FILE, quiet: true });

const bool = (value, fallback = false) =>
	value === undefined ? fallback : /^(1|true|yes|on)$/i.test(String(value));

export const config = {
	/** jira | github | none */
	tracker: (process.env.PUBLISH_TRACKER ?? "none").toLowerCase(),
	/** confluence | none */
	wiki: (process.env.PUBLISH_WIKI ?? "none").toLowerCase(),
	/** zephyr | none */
	testManagement: (process.env.PUBLISH_TEST_MANAGEMENT ?? "none").toLowerCase(),
	/** teams | slack | none */
	chat: (process.env.PUBLISH_CHAT ?? "none").toLowerCase(),

	/** Ticket keys this suite recognises, e.g. ABC-123. */
	ticketPattern: new RegExp(process.env.TICKET_PATTERN ?? "^[A-Z][A-Z0-9]*-\\d+$"),

	evidenceDir: process.env.EVIDENCE_DIR ?? "evidence",

	jira: {
		baseUrl: (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, ""),
		email: process.env.JIRA_EMAIL ?? "",
		apiToken: process.env.JIRA_API_TOKEN ?? "",
	},
	github: {
		repo: process.env.GITHUB_REPOSITORY ?? "",
		token: process.env.GITHUB_TOKEN ?? "",
		artifactBaseUrl: process.env.GITHUB_ARTIFACT_URL ?? "",
	},
	confluence: {
		baseUrl: (process.env.CONFLUENCE_BASE_URL ?? process.env.JIRA_BASE_URL ?? "").replace(/\/$/, ""),
		spaceId: process.env.CONFLUENCE_SPACE_ID ?? "",
		spaceKey: process.env.CONFLUENCE_SPACE_KEY ?? "",
		parentPageId: process.env.CONFLUENCE_PARENT_PAGE_ID ?? "",
	},
	zephyr: {
		apiUrl: process.env.ZEPHYR_API_URL ?? "https://api.zephyrscale.smartbear.com/v2",
		token: process.env.ZEPHYR_API_TOKEN ?? "",
		projectKey: process.env.ZEPHYR_PROJECT_KEY ?? "",
		folderId: process.env.ZEPHYR_FOLDER_ID ?? "",
	},
	chatWebhook: process.env.CHAT_WEBHOOK_URL ?? "",

	/** Environments whose pass result is allowed to trigger a chat notification. */
	notifyOnEnvs: (process.env.NOTIFY_ON_ENVS ?? "prod")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean),

	dryRun: bool(process.env.PUBLISH_DRY_RUN),
};

export function jiraConfigured() {
	return Boolean(config.jira.baseUrl && config.jira.email && config.jira.apiToken);
}

export function githubConfigured() {
	return Boolean(config.github.repo && config.github.token);
}

export function confluenceConfigured() {
	return Boolean(
		config.confluence.baseUrl &&
			config.confluence.spaceId &&
			config.jira.email &&
			config.jira.apiToken,
	);
}

export function zephyrConfigured() {
	return Boolean(config.zephyr.token && config.zephyr.projectKey);
}

export function chatConfigured() {
	return Boolean(config.chatWebhook);
}

export function jiraAuthHeader() {
	const basic = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString("base64");
	return `Basic ${basic}`;
}

export function assertTicket(ticket) {
	if (!ticket) {
		throw new Error("No ticket given. Pass --ticket ABC-123 or set TICKET.");
	}
	if (!config.ticketPattern.test(ticket)) {
		throw new Error(
			`Ticket "${ticket}" does not match TICKET_PATTERN (${config.ticketPattern}).`,
		);
	}
	return ticket;
}
