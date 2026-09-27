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

	evidenceDir: process.env.EVIDENCE_DIR ?? "src/evidence",

	jira: {
		baseUrl: (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, ""),
		email: process.env.JIRA_EMAIL ?? "",
		apiToken: process.env.JIRA_API_TOKEN ?? "",
		/** Issue link type used by `bug`, as named in the Jira project. */
		bugLinkType: process.env.JIRA_BUG_LINK_TYPE ?? "Relates",
	},
	github: {
		repo: process.env.GITHUB_REPOSITORY ?? "",
		token: process.env.GITHUB_TOKEN ?? "",
		artifactBaseUrl: process.env.GITHUB_ARTIFACT_URL ?? "",
	},
	confluence: {
		baseUrl: (process.env.CONFLUENCE_BASE_URL ?? process.env.JIRA_BASE_URL ?? "").replace(
			/\/$/,
			"",
		),
		spaceId: process.env.CONFLUENCE_SPACE_ID ?? "",
		spaceKey: process.env.CONFLUENCE_SPACE_KEY ?? "",
		parentPageId: process.env.CONFLUENCE_PARENT_PAGE_ID ?? "",
		/** Target used when --target is not passed. */
		defaultTarget: (process.env.CONFLUENCE_TARGET ?? "default").toLowerCase(),
		/** Update this page instead of looking the plan up by title. */
		pageId: process.env.CONFLUENCE_PAGE_ID ?? "",
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

/**
 * A named wiki destination. `--target release` reads CONFLUENCE_RELEASE_SPACE_ID,
 * CONFLUENCE_RELEASE_SPACE_KEY and CONFLUENCE_RELEASE_PARENT_PAGE_ID; any of
 * those left unset falls back to the default target's value.
 */
export function confluenceTarget(name = config.confluence.defaultTarget) {
	const target = String(name).toLowerCase();
	const read = (field) =>
		target === "default" ? "" : (process.env[`CONFLUENCE_${target.toUpperCase()}_${field}`] ?? "");
	return {
		name: target,
		spaceId: read("SPACE_ID") || config.confluence.spaceId,
		spaceKey: read("SPACE_KEY") || config.confluence.spaceKey,
		parentPageId: read("PARENT_PAGE_ID") || config.confluence.parentPageId,
	};
}

export function confluenceConfigured(target = confluenceTarget()) {
	return Boolean(
		config.confluence.baseUrl && target.spaceId && config.jira.email && config.jira.apiToken,
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
		throw new Error(`Ticket "${ticket}" does not match TICKET_PATTERN (${config.ticketPattern}).`);
	}
	return ticket;
}
