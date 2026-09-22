import { config } from "../config.mjs";
import { expectOk, log } from "../logger.mjs";

/**
 * GitHub Issues fallback. The REST API has no attachment upload, so evidence
 * is linked rather than embedded: point GITHUB_ARTIFACT_URL at the CI artifact
 * or a storage bucket and the comment links each file.
 */
const api = "https://api.github.com";
const headers = () => ({
	Authorization: `Bearer ${config.github.token}`,
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
});

const ICON = { Pass: "✅", Fail: "❌", Skipped: "⏭" };

export function buildCommentBody({ ticket, environments, rows, links }) {
	const base = config.github.artifactBaseUrl.replace(/\/$/, "");
	const mediaLinks = (media) =>
		(media ?? [])
			.map((name) => (base ? `[${name}](${base}/${encodeURIComponent(name)})` : name))
			.join("<br>");

	const head = `| TC | Case | ${environments.join(" | ")} |`;
	const divider = `| --- | --- | ${environments.map(() => "---").join(" | ")} |`;
	const body = rows.map((row) => {
		const cells = environments.map((env) => {
			const result = row.results[env];
			if (!result) return "—";
			return [`${ICON[result.status] ?? ""} ${result.status}`, mediaLinks(result.media)]
				.filter(Boolean)
				.join("<br>");
		});
		return `| ${row.tc} | ${row.title} | ${cells.join(" | ")} |`;
	});

	return [
		`### ${ticket} — automated test results`,
		"",
		"#### Test Scenario",
		head,
		divider,
		...body,
		...(links?.length ? ["", "#### Links", ...links.map((l) => `- [${l.title}](${l.url})`)] : []),
		"",
	].join("\n");
}

/** `ticket` is the issue number for this provider. */
export async function comment(ticket, body, { dryRun }) {
	const issue = String(ticket).replace(/^#/, "").split("-").pop();
	if (dryRun) {
		log.plan(`comment on ${config.github.repo}#${issue} (${body.length} chars)`);
		return { id: "dry-run" };
	}
	const res = await fetch(`${api}/repos/${config.github.repo}/issues/${issue}/comments`, {
		method: "POST",
		headers: { ...headers(), "Content-Type": "application/json" },
		body: JSON.stringify({ body }),
	});
	await expectOk(res, `Comment on issue ${issue}`);
	return res.json();
}
