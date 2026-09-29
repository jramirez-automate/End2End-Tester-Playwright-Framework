/**
 * Playwright trace → HAR 1.2, for handing a bug's network side to the devs.
 *
 * A trace's *.network files are already HAR entries (one `resource-snapshot` per line);
 * bodies live beside them in resources/<sha1>. This puts them back together as a HAR a
 * dev can drop into DevTools → Network → Import. Redacted before it leaves the machine:
 * Authorization / Cookie / Set-Cookie (+ similar) headers, cookie arrays, and token /
 * password fields in JSON bodies. Only text-like bodies (JSON, text, XML, form data) are
 * inlined — scripts, styles, markup and binaries are dropped to keep the file small.
 *
 * Playwright does not record multipart/form-data request bodies, so a failing multipart
 * POST has no postData — `failures()` flags that so the note on the bug can say so.
 *
 * Used by `publish.mjs bug`.
 */
import fs from "node:fs";
import zlib from "node:zlib";

/** Entries of a (non-zip64) zip — enough for Playwright traces. Returns Map<name, Buffer>. */
function readZip(file) {
	const buf = fs.readFileSync(file);
	let eocd = buf.length - 22;
	while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
	if (eocd < 0) throw new Error(`${file} is not a zip`);
	const entries = new Map();
	let at = buf.readUInt32LE(eocd + 16);
	for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
		const method = buf.readUInt16LE(at + 10);
		const size = buf.readUInt32LE(at + 20);
		const nameLen = buf.readUInt16LE(at + 28);
		const skip = nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
		const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
		const local = buf.readUInt32LE(at + 42);
		const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
		const raw = buf.subarray(start, start + size);
		entries.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
		at += 46 + skip;
	}
	return entries;
}

const SENSITIVE_HEADER =
	/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-amz-security-token)$/i;
const SENSITIVE_FIELD =
	/("(?:access_token|id_token|refresh_token|password|client_secret)"\s*:\s*)"[^"]*"/gi;
const isTextBody = (mime) => /json|text\/plain|xml|x-www-form-urlencoded/i.test(mime ?? "");
const scrubHeaders = (headers) =>
	(headers ?? []).map((h) => (SENSITIVE_HEADER.test(h.name) ? { ...h, value: "[REDACTED]" } : h));
const scrubText = (text) => text.replace(SENSITIVE_FIELD, '$1"[REDACTED]"');

/** Build a redacted HAR object from a Playwright trace .zip. */
export function traceToHar(traceZip) {
	const zip = readZip(traceZip);
	const body = (sha1) => zip.get(`resources/${sha1}`)?.toString("utf8");
	const pages = new Map();
	const entries = [];
	for (const [name, data] of zip) {
		if (!name.endsWith(".network")) continue;
		for (const line of data.toString("utf8").split("\n")) {
			if (!line.trim()) continue;
			const event = JSON.parse(line);
			if (event.type !== "resource-snapshot") continue;
			const e = structuredClone(event.snapshot);
			e.request.headers = scrubHeaders(e.request.headers);
			e.request.cookies = [];
			e.response.headers = scrubHeaders(e.response.headers);
			e.response.cookies = [];
			const post = e.request.postData;
			if (post?._sha1) {
				const text = body(post._sha1);
				if (text !== undefined) post.text = scrubText(text);
				delete post._sha1;
			}
			const content = e.response.content;
			if (content?._sha1) {
				const text = isTextBody(content.mimeType) ? body(content._sha1) : undefined;
				if (text !== undefined) content.text = scrubText(text);
				delete content._sha1;
			}
			for (const key of Object.keys(e)) if (key.startsWith("_")) delete e[key];
			if (e.pageref && !pages.has(e.pageref))
				pages.set(e.pageref, {
					startedDateTime: e.startedDateTime,
					id: e.pageref,
					title: e.request.url,
					pageTimings: {},
				});
			entries.push(e);
		}
	}
	entries.sort((a, b) => a.startedDateTime.localeCompare(b.startedDateTime));
	return {
		log: {
			version: "1.2",
			creator: { name: "e2e trace-to-har", version: "1" },
			pages: [...pages.values()],
			entries,
		},
	};
}

/**
 * The failing calls in a HAR (HTTP ≥ 400), for the bug's Network capture note.
 * `bodyMissing` = a non-GET request whose body the capture didn't record (multipart).
 */
export function failures(har) {
	return (har.log?.entries ?? [])
		.filter((e) => e.response?.status >= 400)
		.map((e) => {
			const url = new URL(e.request.url);
			return {
				method: e.request.method,
				status: e.response.status,
				path: `${url.pathname}${url.search}`,
				response: (e.response.content?.text ?? "").trim().slice(0, 500),
				bodyMissing: e.request.method !== "GET" && !e.request.postData?.text,
			};
		});
}
