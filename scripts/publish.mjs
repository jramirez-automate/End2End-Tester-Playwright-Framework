#!/usr/bin/env node
/**
 * Publishing pipeline for one ticket's evidence bundle.
 *
 *   node scripts/publish.mjs <command> --ticket ABC-123 [--dry-run]
 *
 * Commands
 *   summary   Write evidence/<ticket>/SUMMARY.md from the run results
 *   attach    Upload the media the results table references
 *   comment   Post the results table, with media embedded inline
 *   plan      Create or update the test plan page on the wiki
 *   cycles    Create test cases and a cycle per environment, record results
 *   notify    Post a chat card, only for the environments in NOTIFY_ON_ENVS
 *   cleanup   Delete attachments no comment references
 *   all       summary → attach → comment → plan → cycles → notify
 *
 * Providers come from .env.publish (see .env.publish.example). Anything set to
 * "none", or missing credentials, is skipped rather than failing the run.
 * Without credentials every command runs as a dry run.
 */
import { config, assertTicket, jiraConfigured, githubConfigured, confluenceConfigured, zephyrConfigured, chatConfigured } from "./lib/config.mjs";
import { log, fail } from "./lib/logger.mjs";
import {
	bundleDir,
	mergeRuns,
	overallStatus,
	readResults,
	referencedMedia,
	writeSummary,
} from "./lib/evidence.mjs";
import * as jira from "./lib/providers/tracker-jira.mjs";
import * as github from "./lib/providers/tracker-github.mjs";
import * as wiki from "./lib/providers/wiki-confluence.mjs";
import * as testmgmt from "./lib/providers/testmgmt-zephyr.mjs";
import * as chat from "./lib/providers/chat-webhook.mjs";

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("-")) ?? "all";
const flag = (name) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1];
};
const has = (name) => args.includes(`--${name}`);

const USAGE = `
Publish one ticket's evidence bundle.

  node scripts/publish.mjs <command> --ticket ABC-123 [options]

Commands
  summary   Write evidence/<ticket>/SUMMARY.md from the run results
  attach    Upload the media the results table references
  comment   Post the results table, with media embedded inline
  plan      Create or update the test plan page on the wiki
  cycles    Create test cases and a cycle per environment, record results
  notify    Post a chat card for the environments in NOTIFY_ON_ENVS
  cleanup   Delete attachments no comment references
  all       summary, attach, plan, cycles, comment, notify

Options
  --ticket <key>       Ticket key. Defaults to $TICKET.
  --summary <text>     One-line description for the page and the chat card.
  --comment-id <id>    Update an existing comment instead of posting a new one.
  --dry-run            Print what would happen and write nothing.

Providers are configured in .env.publish (see .env.publish.example).
`;

if (has("help") || args.includes("-h")) {
	console.log(USAGE.trim());
	process.exit(0);
}

let ticket;
try {
	ticket = assertTicket(flag("ticket") ?? process.env.TICKET);
} catch (error) {
	fail(`${error.message}\n${USAGE.trim()}`);
}
const summaryText = flag("summary") ?? "";
const commentId = flag("comment-id");

const trackerReady = config.tracker === "jira" ? jiraConfigured() : config.tracker === "github" ? githubConfigured() : false;
const dryRun = config.dryRun || has("dry-run") || !trackerReady;

const state = { links: [] };

function section(title) {
	log.step(title);
}

async function loadTable() {
	const runs = readResults(ticket);
	const table = mergeRuns(runs);
	const totals = {
		pass: 0,
		fail: 0,
		skipped: 0,
	};
	for (const row of table.rows) {
		for (const result of Object.values(row.results)) {
			if (result.status === "Pass") totals.pass += 1;
			else if (result.status === "Fail") totals.fail += 1;
			else totals.skipped += 1;
		}
	}
	return { ...table, totals, status: overallStatus(table.rows) };
}

async function cmdSummary(table) {
	section("Summary");
	const file = writeSummary(ticket, table);
	log.ok(`wrote ${file}`);
}

async function cmdAttach(table) {
	section("Attach evidence");
	if (config.tracker !== "jira") {
		log.warn(`tracker "${config.tracker}" cannot host attachments — skipping upload`);
		return;
	}
	const media = referencedMedia(ticket, table.rows);
	if (!media.length) {
		log.warn(`no media found in ${bundleDir(ticket)}`);
		return;
	}
	await jira.attach(ticket, media, { dryRun });
}

async function cmdComment(table) {
	section("Results comment");
	if (config.tracker === "none") {
		log.warn("no tracker configured — skipping comment");
		return;
	}

	if (config.tracker === "github") {
		const body = github.buildCommentBody({ ticket, ...table, links: state.links });
		const posted = await github.comment(ticket, body, { dryRun });
		log.ok(`comment ${posted.id}`);
		return;
	}

	const names = referencedMedia(ticket, table.rows).map((entry) => entry.name);
	const uuids = await jira.mediaUuidsByFilename(ticket, names, { dryRun });
	const missing = names.filter((name) => !uuids.has(name));
	if (missing.length) {
		log.warn(`not attached yet, so not embedded: ${missing.join(", ")}`);
	}
	const body = jira.buildCommentBody({ ticket, ...table, uuids, links: state.links });
	const posted = await jira.comment(ticket, body, { dryRun, commentId });
	log.ok(`comment ${posted.id}`);
}

async function cmdPlan(table) {
	section("Test plan page");
	if (config.wiki !== "confluence") {
		log.warn("no wiki configured — skipping test plan");
		return;
	}
	if (!confluenceConfigured() && !dryRun) {
		log.warn("wiki credentials missing — skipping test plan");
		return;
	}
	const title = `[${ticket}] Test Plan`;
	const storage = wiki.buildStorage({ ticket, summary: summaryText, ...table, links: state.links });
	const page = await wiki.publishPage({ title, storage }, { dryRun });
	const url = wiki.pageUrl(page);
	state.links.push({ title: `${title} (wiki)`, url });
	log.ok(`page ${url}`);
}

async function cmdCycles(table) {
	section("Test management");
	if (config.testManagement !== "zephyr") {
		log.warn("no test management configured — skipping cycles");
		return;
	}
	if (!zephyrConfigured() && !dryRun) {
		log.warn("test management credentials missing — skipping cycles");
		return;
	}
	const cases = await testmgmt.createTestCases({ ticket, rows: table.rows }, { dryRun });
	for (const env of table.environments) {
		const envRows = table.rows.filter((row) => row.results[env]);
		const status = envRows.some((row) => row.results[env].status === "Fail") ? "Fail" : "Pass";
		const cycle = await testmgmt.createCycle({ ticket, env, status }, { dryRun });
		await testmgmt.recordExecutions(
			{ cycleKey: cycle.key, cases, rows: envRows, env },
			{ dryRun },
		);
		state.links.push({ title: cycle.name, url: `${config.jira.baseUrl}/projects/${config.zephyr.projectKey}` });
	}
}

async function cmdNotify(table) {
	section("Chat notification");
	if (config.chat === "none") {
		log.warn("no chat provider configured — skipping notification");
		return;
	}
	if (!chatConfigured() && !dryRun) {
		log.warn("CHAT_WEBHOOK_URL not set — skipping notification");
		return;
	}
	// Only announce the environments that are worth announcing, and only on green.
	const gated = config.notifyOnEnvs.filter((env) => table.environments.includes(env));
	if (!gated.length) {
		log.info(`none of NOTIFY_ON_ENVS (${config.notifyOnEnvs.join(", ")}) were tested — not notifying`);
		return;
	}
	if (table.status !== "Pass") {
		log.info(`overall status is ${table.status} — not notifying`);
		return;
	}
	const payload = chat.buildPayload({
		ticket,
		summary: summaryText,
		environments: gated,
		status: table.status,
		totals: table.totals,
		links: state.links,
	});
	await chat.notify(payload, { dryRun });
}

async function cmdCleanup(table) {
	section("Attachment cleanup");
	if (config.tracker !== "jira") {
		log.warn(`tracker "${config.tracker}" has no attachments to clean`);
		return;
	}
	const keepNames = ["SUMMARY.md", ...referencedMedia(ticket, table.rows).map((e) => e.name)];
	const { deleted, guarded } = await jira.cleanup(ticket, { dryRun, keepNames });
	log.ok(
		deleted.length
			? `${deleted.length} attachment(s) removed, ${guarded.length} kept`
			: `nothing to remove, ${guarded.length} kept`,
	);
}

const commands = {
	summary: [cmdSummary],
	attach: [cmdAttach],
	comment: [cmdComment],
	plan: [cmdPlan],
	cycles: [cmdCycles],
	notify: [cmdNotify],
	cleanup: [cmdCleanup],
	all: [cmdSummary, cmdAttach, cmdPlan, cmdCycles, cmdComment, cmdNotify],
};

const steps = commands[command];
if (!steps) fail(`Unknown command "${command}". One of: ${Object.keys(commands).join(", ")}`);

try {
	const table = await loadTable();
	log.info(
		`${ticket} · ${table.rows.length} case(s) · env ${table.environments.join(", ") || "none"} · ${table.status}`,
	);
	log.info(
		`providers: tracker=${config.tracker} wiki=${config.wiki} testmgmt=${config.testManagement} chat=${config.chat}`,
	);
	if (dryRun) log.warn("dry run: nothing will be written to any external system");

	for (const step of steps) await step(table);

	log.ok(`publish ${command} finished`);
} catch (error) {
	fail(error.message);
}
