#!/usr/bin/env node
/**
 * Publishing pipeline for one ticket's evidence bundle.
 *
 *   node scripts/publish.mjs <command> --ticket ABC-123 [--dry-run]
 *
 * Every result comes from src/evidence/<ticket>/results-<env>.json, which the run
 * writes. The only hand-written input is the test-case plan used by `cases`,
 * and that holds cases, never results.
 *
 * Providers come from .env.publish (see .env.publish.example). Anything set to
 * "none", or missing credentials, is skipped rather than failing the run.
 * Without credentials every command runs as a dry run.
 */
import fs from "node:fs";
import path from "node:path";

import {
	config,
	assertTicket,
	jiraConfigured,
	githubConfigured,
	confluenceConfigured,
	confluenceTarget,
	zephyrConfigured,
	chatConfigured,
} from "./lib/config.mjs";
import { log, fail } from "./lib/logger.mjs";
import {
	bundleDir,
	cyclesStateFile,
	failedMedia,
	mergeRuns,
	overallStatus,
	planFile,
	readCyclesState,
	readPlan,
	readResults,
	readZephyrState,
	referencedMedia,
	writeCyclesState,
	writeSummary,
	writeZephyrState,
	zephyrStateFile,
} from "./lib/evidence.mjs";
import * as jira from "./lib/providers/tracker-jira.mjs";
import * as github from "./lib/providers/tracker-github.mjs";
import * as wiki from "./lib/providers/wiki-confluence.mjs";
import * as testmgmt from "./lib/providers/testmgmt-zephyr.mjs";
import * as chat from "./lib/providers/chat-webhook.mjs";

const args = process.argv.slice(2);
const VALUE_FLAGS = [
	"--ticket",
	"--summary",
	"--comment-id",
	"--only",
	"--target",
	"--page-id",
	"--plan",
	"--from",
	"--tc",
	"--files",
];
const command =
	args.find((arg, index) => !arg.startsWith("-") && !VALUE_FLAGS.includes(args[index - 1])) ??
	"all";
const flag = (name) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1];
};
const has = (name) => args.includes(`--${name}`);

const USAGE = `
Publish one ticket's evidence bundle.

  node scripts/publish.mjs <command> --ticket ABC-123 [options]

Commands
  summary    Write src/evidence/<ticket>/SUMMARY.md from the run results
  attach     Upload the media the results table references
  comment    Post the results table, with media embedded inline
  plan       Create or update the test plan page, with media embedded
  cases      Create test cases and a cycle from the test-case plan, once
             every automated case's test is in the run's results
  mark-pass  Record the run's results against the planned cases
  cycles     No plan: create cases from the run, a cycle per environment
  notify     Post a chat card for the environments in NOTIFY_ON_ENVS
  cleanup    Delete ticket attachments no comment or description references
  prune      Delete wiki page attachments the current table no longer uses
  bug        Give a bug its own proof: copy one failed case's media, attach
             it, embed it in the bug's description, link it to the parent
  all        summary, attach, plan, mark-pass (or cycles), comment, notify

Options
  --ticket <key>       Ticket key. Defaults to $TICKET.
  --summary <text>     One-line description for the page and the chat card.
  --comment-id <id>    Update an existing comment instead of posting a new one.
  --traces             attach: also upload each referenced case's trace.zip.
  --only <text>        attach: only files whose name contains <text>.
  --target <name>      plan / prune: wiki destination (CONFLUENCE_<NAME>_*).
  --page-id <id>       plan / prune: this page, not a title lookup.
  --skip-media         plan: republish the body without re-uploading media.
  --plan <file>        cases: defaults to src/evidence/<ticket>/test-cases.json.
  --create-cases       cases / cycles: allow creating Zephyr test cases. Zephyr
                       cannot delete a case, so review the dry run first.
  --force              cases / cycles: create again although zephyr.json or
                       zephyr-cycles.json exists. This duplicates every case.
  --from <key>         bug: the ticket whose run found the failure.
  --tc <TC-00N>        bug: the failed case to take the proof from.
  --files <a,b>        bug: a manual finding's media, already in src/evidence/<bug>/.
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
const target = confluenceTarget(flag("target"));
const pageId = flag("page-id") ?? config.confluence.pageId;

const trackerReady =
	config.tracker === "jira"
		? jiraConfigured()
		: config.tracker === "github"
			? githubConfigured()
			: false;
const dryRun = config.dryRun || has("dry-run") || !trackerReady;

const state = { links: [] };

function section(title) {
	log.step(title);
}

function loadTable(key = ticket) {
	const table = mergeRuns(readResults(key));
	const totals = { pass: 0, fail: 0, skipped: 0 };
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
	const media = referencedMedia(ticket, table.rows, { traces: has("traces"), only: flag("only") });
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

function wikiReady() {
	if (config.wiki !== "confluence") {
		log.warn("no wiki configured — skipping");
		return false;
	}
	if (!confluenceConfigured(target) && !dryRun) {
		log.warn(`wiki credentials or space for target "${target.name}" missing — skipping`);
		return false;
	}
	return true;
}

const planTitle = () => `[${ticket}] Test Plan`;

async function cmdPlan(table) {
	section(`Test plan page (target: ${target.name})`);
	if (!wikiReady()) return;
	const title = planTitle();
	const storage = wiki.buildStorage({ ticket, summary: summaryText, ...table, links: state.links });
	const page = await wiki.publishPage({ title, storage, target, pageId }, { dryRun });
	if (has("skip-media")) {
		log.info("--skip-media: media left as already uploaded");
	} else {
		await wiki.uploadMedia(page.id, referencedMedia(ticket, table.rows), { dryRun });
	}
	const url = wiki.pageUrl(page, target);
	state.links.push({ title: `${title} (wiki)`, url });
	log.ok(`page ${url}`);
}

async function cmdPrune(table) {
	section(`Prune test plan attachments (target: ${target.name})`);
	if (!wikiReady()) return;
	if (!confluenceConfigured(target)) {
		log.warn(
			"pruning reads the live page, so it needs wiki credentials even for a dry run — skipping",
		);
		return;
	}
	const page = await wiki.resolvePage({ title: planTitle(), target, pageId });
	if (!page) {
		log.warn(`no page "${planTitle()}" in target "${target.name}" — nothing to prune`);
		return;
	}
	const keepNames = referencedMedia(ticket, table.rows).map((entry) => entry.name);
	const { deleted, guarded } = await wiki.prune(page.id, { dryRun, keepNames });
	log.ok(
		deleted.length
			? `${deleted.length} page attachment(s) removed, ${guarded.length} kept`
			: `nothing to remove, ${guarded.length} kept`,
	);
}

function testmgmtReady() {
	if (config.testManagement !== "zephyr") {
		log.warn("no test management configured — skipping");
		return false;
	}
	if (!zephyrConfigured() && !dryRun) {
		log.warn("test management credentials missing — skipping");
		return false;
	}
	return true;
}

/** Zephyr cannot delete a test case, so creating one takes an explicit flag. */
function caseCreationAllowed() {
	if (dryRun || has("create-cases")) return true;
	log.warn(
		"this step creates Zephyr test cases, which cannot be deleted — review the dry run, then pass --create-cases",
	);
	return false;
}

/**
 * An automated case goes to Zephyr only once its `test` title is in the run's
 * results and ran. A failure still counts: it is an app bug, and its case is
 * where that failure gets recorded.
 */
function unverifiedCases(cases) {
	const automated = cases.filter((entry) => !entry.manual);
	if (!automated.length) return [];
	let rows;
	try {
		rows = loadTable().rows;
	} catch (error) {
		return [error.message];
	}
	const problems = [];
	for (const entry of automated) {
		if (!entry.test) {
			problems.push(`${entry.tc}: no "test" title`);
			continue;
		}
		const row = rows.find((candidate) => candidate.title === entry.test);
		if (!row) {
			problems.push(
				`${entry.tc}: "${entry.test}" is not in the run's results — the title must match the spec exactly`,
			);
			continue;
		}
		const statuses = Object.values(row.results).map((result) => result.status);
		if (!statuses.some((status) => status === "Pass" || status === "Fail")) {
			problems.push(`${entry.tc}: "${entry.test}" was skipped on every environment`);
		} else if (statuses.includes("Fail")) {
			log.warn(`${entry.tc}: "${entry.test}" failed — its case records an app bug`);
		}
	}
	return problems;
}

async function cmdCases() {
	section("Planned test cases");
	if (!testmgmtReady()) return;
	if (!caseCreationAllowed()) return;
	const existing = readZephyrState(ticket);
	if (existing && !has("force")) {
		log.warn(
			`${zephyrStateFile(ticket)} already records cycle ${existing.cycleKey} — pass --force to create again`,
		);
		return;
	}
	const cases = readPlan(planFile(ticket, flag("plan")));
	const problems = unverifiedCases(cases);
	problems.forEach((problem) => log.warn(problem));
	if (problems.length && !dryRun) {
		log.warn('nothing created — run the specs first, or mark a case "manual": true');
		return;
	}
	const created = await testmgmt.createPlannedCases({ ticket, cases }, { dryRun });
	if (dryRun) return;
	writeZephyrState(ticket, { ...created, createdAt: new Date().toISOString() });
	log.ok(`wrote ${zephyrStateFile(ticket)}`);
}

async function cmdMarkPass(table) {
	section("Record results against planned cases");
	if (!testmgmtReady()) return;
	const saved = readZephyrState(ticket);
	if (!saved) {
		log.warn(`no ${zephyrStateFile(ticket)} — run "cases" first, or use "cycles"`);
		return;
	}
	// Titles may be filled into the plan after `cases` ran; the plan wins.
	const plan = fs.existsSync(planFile(ticket, flag("plan")))
		? readPlan(planFile(ticket, flag("plan")))
		: [];
	const withTitles = {
		...saved,
		cases: saved.cases.map((entry) => ({
			...entry,
			test: plan.find((p) => p.tc === entry.tc)?.test ?? entry.test,
		})),
	};
	for (const env of table.environments) {
		const recorded = await testmgmt.markResults(
			{ state: withTitles, rows: table.rows, env },
			{ dryRun },
		);
		const missed = withTitles.cases
			.filter((entry) => !recorded.includes(entry.tc))
			.map((entry) => entry.tc);
		log.ok(`${env}: ${recorded.length} result(s) recorded`);
		if (missed.length) log.warn(`${env}: no automated result for ${missed.join(", ")}`);
	}
	const planned = new Set(withTitles.cases.map((entry) => entry.test).filter(Boolean));
	const extra = table.rows.filter((row) => !planned.has(row.title)).map((row) => row.title);
	if (extra.length) log.warn(`tests with no planned case: ${extra.join("; ")}`);
	state.links.push({
		title: withTitles.cycleName ?? `${ticket} — test cycle`,
		url: `${config.jira.baseUrl}/projects/${config.zephyr.projectKey}`,
	});
}

async function cmdCycles(table) {
	section("Test management");
	if (!testmgmtReady()) return;
	const previous = readCyclesState(ticket);
	if (previous && !has("force")) {
		log.warn(
			`${cyclesStateFile(ticket)} records cases created on ${previous.createdAt} — pass --force to create them again`,
		);
		return;
	}
	if (!caseCreationAllowed()) return;
	const cases = await testmgmt.createTestCases({ ticket, rows: table.rows }, { dryRun });
	if (!dryRun) {
		writeCyclesState(ticket, { cases, createdAt: new Date().toISOString() });
		log.ok(`wrote ${cyclesStateFile(ticket)}`);
	}
	for (const env of table.environments) {
		const envRows = table.rows.filter((row) => row.results[env]);
		const status = envRows.some((row) => row.results[env].status === "Fail") ? "Fail" : "Pass";
		const cycle = await testmgmt.createCycle({ ticket, env, status }, { dryRun });
		await testmgmt.recordExecutions({ cycleKey: cycle.key, cases, rows: envRows, env }, { dryRun });
		state.links.push({
			title: cycle.name,
			url: `${config.jira.baseUrl}/projects/${config.zephyr.projectKey}`,
		});
	}
}

async function cmdResults(table) {
	return readZephyrState(ticket) ? cmdMarkPass(table) : cmdCycles(table);
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
		log.info(
			`none of NOTIFY_ON_ENVS (${config.notifyOnEnvs.join(", ")}) were tested — not notifying`,
		);
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
	if (!jiraConfigured()) {
		log.warn(
			"cleanup reads the live issue, so it needs tracker credentials even for a dry run — skipping",
		);
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

/** A manual finding's own media, already saved in src/evidence/<BUG-KEY>/. */
function manualMedia(list) {
	const dir = bundleDir(ticket);
	const media = list
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean)
		.map((name) => ({ name, file: path.join(dir, name) }));
	const missing = media.filter((entry) => !fs.existsSync(entry.file)).map((entry) => entry.name);
	if (missing.length) fail(`not in ${dir}: ${missing.join(", ")}`);
	return media;
}

async function cmdBug() {
	const parent = flag("from");
	const tc = flag("tc");
	const files = flag("files");
	if (!parent)
		fail("bug needs --from <ticket under test>, plus --tc <TC-00N> or --files <a.png,b.webm>");
	if (!tc && !files)
		fail("bug needs --tc <TC-00N> (an automated failure) or --files <names> (a manual finding)");
	assertTicket(parent);
	section(`Bug proof: ${ticket} ← ${parent} ${tc ?? "(manual finding)"}`);

	const dir = bundleDir(ticket);
	let copies;
	if (files) {
		copies = manualMedia(files);
	} else {
		const parentTable = loadTable(parent);
		const row = parentTable.rows.find((candidate) => candidate.tc === tc);
		if (!row)
			fail(`${tc} is not in ${parent}'s results (${parentTable.rows.map((r) => r.tc).join(", ")})`);
		const media = failedMedia(parent, row);
		if (!media.length)
			fail(`${parent} ${tc} ("${row.title}") has no *-FAILED media — did it fail?`);
		copies = media.map((entry) => ({ name: entry.name, file: path.join(dir, entry.name) }));
		if (dryRun) {
			copies.forEach((entry) => log.plan(`copy ${entry.name} → ${dir}/`));
			copies = media;
		} else {
			fs.mkdirSync(dir, { recursive: true });
			media.forEach((entry, i) => fs.copyFileSync(entry.file, copies[i].file));
			log.ok(`copied ${copies.length} file(s) into ${dir}`);
		}
	}

	if (config.tracker !== "jira") {
		log.warn(
			`tracker "${config.tracker}" cannot host attachments — attach ${copies.map((c) => c.name).join(", ")} by hand`,
		);
		return;
	}
	await jira.attach(ticket, copies, { dryRun });
	const uuids = await jira.mediaUuidsByFilename(
		ticket,
		copies.map((c) => c.name),
		{ dryRun },
	);
	await jira.embedInDescription(ticket, uuids, { dryRun });
	await jira.linkIssues(ticket, parent, { dryRun });
}

/** Commands that read this ticket's run results take the table; the rest do not. */
const commands = {
	summary: [cmdSummary],
	attach: [cmdAttach],
	comment: [cmdComment],
	plan: [cmdPlan],
	cases: [cmdCases],
	"mark-pass": [cmdMarkPass],
	cycles: [cmdCycles],
	notify: [cmdNotify],
	cleanup: [cmdCleanup],
	prune: [cmdPrune],
	bug: [cmdBug],
	all: [cmdSummary, cmdAttach, cmdPlan, cmdResults, cmdComment, cmdNotify],
};
const WITHOUT_TABLE = new Set(["cases", "bug"]);

const steps = commands[command];
if (!steps) fail(`Unknown command "${command}". One of: ${Object.keys(commands).join(", ")}`);

try {
	log.info(
		`providers: tracker=${config.tracker} wiki=${config.wiki} testmgmt=${config.testManagement} chat=${config.chat}`,
	);
	if (dryRun) log.warn("dry run: nothing will be written to any external system");

	let table;
	if (!WITHOUT_TABLE.has(command)) {
		table = loadTable();
		log.info(
			`${ticket} · ${table.rows.length} case(s) · env ${table.environments.join(", ") || "none"} · ${table.status}`,
		);
	}

	for (const step of steps) await step(table);

	log.ok(`publish ${command} finished`);
} catch (error) {
	fail(error.message);
}
