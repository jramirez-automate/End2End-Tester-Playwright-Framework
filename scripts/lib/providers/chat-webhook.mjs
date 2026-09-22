import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../config.mjs";
import { expectOk, log } from "../logger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, "../../../templates");

/** Teams adaptive card or Slack blocks, from the same inputs. */
export function buildPayload({ ticket, summary, environments, status, totals, links }) {
	const title = `${ticket} — ${status}`;
	const facts = [
		{ title: "Environments", value: environments.join(", ") || "—" },
		{ title: "Passed", value: String(totals.pass) },
		{ title: "Failed", value: String(totals.fail) },
	];

	if (config.chat === "slack") {
		return {
			text: title,
			blocks: [
				{ type: "header", text: { type: "plain_text", text: title } },
				...(summary ? [{ type: "section", text: { type: "mrkdwn", text: summary } }] : []),
				{
					type: "section",
					fields: facts.map((fact) => ({ type: "mrkdwn", text: `*${fact.title}*\n${fact.value}` })),
				},
				...(links?.length
					? [
							{
								type: "section",
								text: {
									type: "mrkdwn",
									text: links.map((l) => `<${l.url}|${l.title}>`).join("  ·  "),
								},
							},
						]
					: []),
			],
		};
	}

	const templateFile = path.join(templateDir, "chat-card.json");
	const card = JSON.parse(fs.readFileSync(templateFile, "utf8"));
	const content = card.attachments[0].content;
	content.body[0].text = title;
	content.body[1].text = summary ?? `Automated suite finished with status ${status}.`;
	content.body[2].facts = facts;
	content.actions = (links ?? []).map((entry) => ({
		type: "Action.OpenUrl",
		title: entry.title,
		url: entry.url,
	}));
	return card;
}

export async function notify(payload, { dryRun }) {
	if (dryRun) {
		log.plan(`post chat notification (${config.chat || "teams"})`);
		return;
	}
	const res = await fetch(config.chatWebhook, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	await expectOk(res, "Chat webhook");
	log.ok("chat notification sent");
}
