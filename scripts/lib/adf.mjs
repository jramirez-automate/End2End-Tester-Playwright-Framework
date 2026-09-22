/**
 * Minimal Atlassian Document Format builders.
 *
 * Inline, playable media in a comment is only possible with ADF media nodes.
 * A markdown comment can link to an attachment, never embed it.
 */
export const text = (value, marks) => ({ type: "text", text: String(value), ...(marks ? { marks } : {}) });
export const strong = (value) => text(value, [{ type: "strong" }]);
export const link = (value, href) => text(value, [{ type: "link", attrs: { href } }]);

export const paragraph = (...content) => ({
	type: "paragraph",
	content: content.flat().filter(Boolean),
});

export const heading = (level, value) => ({
	type: "heading",
	attrs: { level },
	content: [text(value)],
});

export const cell = (content, isHeader = false) => ({
	type: isHeader ? "tableHeader" : "tableCell",
	attrs: {},
	content: Array.isArray(content) ? content : [content],
});

export const row = (cells) => ({ type: "tableRow", content: cells });

export const table = (rows) => ({
	type: "table",
	attrs: { isNumberColumnEnabled: false, layout: "default" },
	content: rows,
});

/** An attachment rendered inline. `id` is the media services uuid, not the attachment id. */
export const mediaSingle = (id, width = 760) => ({
	type: "mediaSingle",
	attrs: { layout: "center", width },
	content: [
		{
			type: "media",
			attrs: { type: "file", id, collection: "" },
		},
	],
});

export const doc = (content) => ({ type: "doc", version: 1, content: content.flat().filter(Boolean) });
