import fs from "node:fs";
import path from "node:path";

import { config, jiraAuthHeader } from "../config.mjs";
import { expectOk, log } from "../logger.mjs";
import * as adf from "../adf.mjs";

const api = () => `${config.jira.baseUrl}/rest/api/3`;
const authHeaders = () => ({ Authorization: jiraAuthHeader(), Accept: "application/json" });

export async function listAttachments(ticket) {
	const res = await fetch(`${api()}/issue/${encodeURIComponent(ticket)}?fields=attachment`, {
		headers: authHeaders(),
	});
	await expectOk(res, `Read ${ticket}`);
	const data = await res.json();
	return data.fields?.attachment ?? [];
}

/** Upload files, skipping any name already attached. */
export async function attach(ticket, files, { dryRun }) {
	const existing = dryRun ? [] : (await listAttachments(ticket)).map((a) => a.filename);
	const pending = files.filter((entry) => !existing.includes(entry.name));

	if (dryRun) {
		pending.forEach((entry) => log.plan(`attach ${entry.name} → ${ticket}`));
		return pending.map((entry) => ({ filename: entry.name, id: "dry-run" }));
	}
	if (!pending.length) {
		log.info("All media already attached.");
		return [];
	}

	const form = new FormData();
	for (const entry of pending) {
		const blob = new Blob([fs.readFileSync(entry.file)]);
		form.append("file", blob, path.basename(entry.name));
	}

	const res = await fetch(`${api()}/issue/${encodeURIComponent(ticket)}/attachments`, {
		method: "POST",
		headers: { ...authHeaders(), "X-Atlassian-Token": "no-check" },
		body: form,
	});
	await expectOk(res, `Attach to ${ticket}`);
	const uploaded = await res.json();
	uploaded.forEach((entry) => log.ok(`attached ${entry.filename}`));
	return uploaded;
}

/**
 * Resolve an attachment to the media services uuid an ADF media node needs.
 * The content endpoint answers 303 with .../file/<uuid>/binary in Location.
 */
async function mediaUuid(attachmentId) {
	const res = await fetch(`${api()}/attachment/content/${attachmentId}`, {
		headers: authHeaders(),
		redirect: "manual",
	});
	const location = res.headers.get("location") ?? "";
	const uuid = location.match(/\/file\/([0-9a-f-]{36})/i)?.[1];
	if (!uuid) throw new Error(`Could not resolve media uuid for attachment ${attachmentId}`);
	return uuid;
}

export async function mediaUuidsByFilename(ticket, names, { dryRun }) {
	const map = new Map();
	if (dryRun) {
		names.forEach((name) => map.set(name, "00000000-0000-0000-0000-000000000000"));
		return map;
	}
	const attachments = await listAttachments(ticket);
	for (const name of names) {
		const match = attachments.find((entry) => entry.filename === name);
		if (!match) continue;
		map.set(name, await mediaUuid(match.id));
	}
	return map;
}

const STATUS_ICON = { Pass: "✅ Pass", Fail: "❌ Fail", Skipped: "⏭ Skipped" };

/** Build the results comment: a test scenario table with media embedded per cell. */
export function buildCommentBody({ ticket, environments, rows, uuids, links }) {
	const header = adf.row([
		adf.cell(adf.paragraph(adf.strong("TC")), true),
		adf.cell(adf.paragraph(adf.strong("Case")), true),
		...environments.map((env) => adf.cell(adf.paragraph(adf.strong(env)), true)),
	]);

	const bodyRows = rows.map((row) =>
		adf.row([
			adf.cell(adf.paragraph(adf.text(row.tc))),
			adf.cell(adf.paragraph(adf.text(row.title))),
			...environments.map((env) => {
				const result = row.results[env];
				if (!result) return adf.cell(adf.paragraph(adf.text("—")));
				const media = (result.media ?? [])
					.filter((name) => uuids.has(name))
					.map((name) => adf.mediaSingle(uuids.get(name)));
				return adf.cell([
					adf.paragraph(adf.text(STATUS_ICON[result.status] ?? result.status)),
					...media,
					...(result.error ? [adf.paragraph(adf.text(result.error))] : []),
				]);
			}),
		]),
	);

	return adf.doc([
		adf.heading(3, `${ticket} — automated test results`),
		adf.heading(4, "Test Scenario"),
		adf.table([header, ...bodyRows]),
		...(links?.length
			? [
					adf.heading(4, "Links"),
					...links.map((entry) => adf.paragraph(adf.link(entry.title, entry.url))),
				]
			: []),
	]);
}

export async function comment(ticket, body, { dryRun, commentId }) {
	if (dryRun) {
		log.plan(`post comment to ${ticket} (${JSON.stringify(body).length} bytes of ADF)`);
		return { id: "dry-run" };
	}
	const url = commentId
		? `${api()}/issue/${encodeURIComponent(ticket)}/comment/${commentId}`
		: `${api()}/issue/${encodeURIComponent(ticket)}/comment`;
	const res = await fetch(url, {
		method: commentId ? "PUT" : "POST",
		headers: { ...authHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify({ body }),
	});
	await expectOk(res, `Comment on ${ticket}`);
	return res.json();
}

async function readDescription(ticket) {
	const res = await fetch(`${api()}/issue/${encodeURIComponent(ticket)}?fields=description`, {
		headers: authHeaders(),
	});
	await expectOk(res, `Read ${ticket} description`);
	return (await res.json()).fields?.description ?? null;
}

const EVIDENCE_HEADING = "Evidence";

/**
 * Render media inside the issue description, under a trailing "Evidence"
 * heading. Everything from that heading down is replaced, so re-running
 * refreshes the proof instead of stacking a second copy under the first.
 */
export async function embedInDescription(ticket, uuids, { dryRun }) {
	if (dryRun) {
		log.plan(`embed ${uuids.size} media file(s) in the ${ticket} description under "${EVIDENCE_HEADING}"`);
		return;
	}
	const current = await readDescription(ticket);
	const content = [...(current?.content ?? [])];
	const at = content.findIndex(
		(node) =>
			node.type === "heading" &&
			node.content?.map((part) => part.text ?? "").join("").trim() === EVIDENCE_HEADING,
	);
	const kept = at === -1 ? content : content.slice(0, at);
	const body = adf.doc([
		...kept,
		adf.heading(3, EVIDENCE_HEADING),
		...[...uuids.entries()].flatMap(([name, uuid]) => [
			adf.paragraph(adf.text(name)),
			adf.mediaSingle(uuid),
		]),
	]);
	const res = await fetch(`${api()}/issue/${encodeURIComponent(ticket)}`, {
		method: "PUT",
		headers: { ...authHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify({ fields: { description: body } }),
	});
	await expectOk(res, `Update ${ticket} description`);
	log.ok(`embedded ${uuids.size} media file(s) in the ${ticket} description`);
}

/** Link a bug to the ticket under test, once. */
export async function linkIssues(bug, parent, { dryRun }) {
	const type = config.jira.bugLinkType;
	if (dryRun) {
		log.plan(`link ${bug} → ${parent} ("${type}")`);
		return;
	}
	const res = await fetch(`${api()}/issue/${encodeURIComponent(bug)}?fields=issuelinks`, {
		headers: authHeaders(),
	});
	await expectOk(res, `Read ${bug} links`);
	const links = (await res.json()).fields?.issuelinks ?? [];
	const already = links.some(
		(link) => link.inwardIssue?.key === parent || link.outwardIssue?.key === parent,
	);
	if (already) {
		log.info(`${bug} is already linked to ${parent}`);
		return;
	}
	const post = await fetch(`${api()}/issueLink`, {
		method: "POST",
		headers: { ...authHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify({
			type: { name: type },
			inwardIssue: { key: bug },
			outwardIssue: { key: parent },
		}),
	});
	await expectOk(post, `Link ${bug} to ${parent}`);
	log.ok(`linked ${bug} → ${parent} ("${type}")`);
}

/**
 * Delete attachments that neither a comment nor the description references.
 *
 * Guarded on purpose: only files this pipeline could have produced are ever
 * candidates. Source material someone else attached is reported and kept.
 * With no embedded media anywhere on the issue, nothing is deleted at all:
 * that state means the results comment has not been posted yet, not that
 * every capture is an orphan.
 */
export async function cleanup(ticket, { dryRun, keepNames = [] }) {
	const attachments = await listAttachments(ticket);
	const res = await fetch(`${api()}/issue/${encodeURIComponent(ticket)}/comment`, {
		headers: authHeaders(),
	});
	await expectOk(res, `Read comments on ${ticket}`);
	const references =
		JSON.stringify((await res.json()).comments ?? []) +
		JSON.stringify(await readDescription(ticket));

	const capture = /\.(png|jpe?g|webm|zip|md)$/i;
	const deleted = [];
	const guarded = [];

	if (!references.includes('"type":"media"')) {
		attachments.forEach((attachment) =>
			guarded.push(`${attachment.filename} (no embedded media on ${ticket} yet)`),
		);
		guarded.forEach((entry) => log.warn(`kept ${entry}`));
		return { deleted, guarded };
	}

	for (const attachment of attachments) {
		const named =
			references.includes(attachment.id) || references.includes(attachment.filename);
		if (named || keepNames.includes(attachment.filename)) continue;
		if (!capture.test(attachment.filename)) {
			guarded.push(`${attachment.filename} (not a capture artifact)`);
			continue;
		}
		if (attachment.author?.emailAddress && attachment.author.emailAddress !== config.jira.email) {
			guarded.push(`${attachment.filename} (uploaded by someone else)`);
			continue;
		}
		const uuid = await mediaUuid(attachment.id).catch(() => undefined);
		if (uuid && references.includes(uuid)) continue;
		if (dryRun) {
			log.plan(`delete attachment ${attachment.filename}`);
			deleted.push(attachment.filename);
			continue;
		}
		const del = await fetch(`${api()}/attachment/${attachment.id}`, {
			method: "DELETE",
			headers: authHeaders(),
		});
		await expectOk(del, `Delete ${attachment.filename}`);
		deleted.push(attachment.filename);
	}

	guarded.forEach((entry) => log.warn(`kept ${entry}`));
	return { deleted, guarded };
}
