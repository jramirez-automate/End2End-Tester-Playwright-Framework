import DOMPurify from "dompurify";
import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: true });

marked.use({
	hooks: {
		// Every link opens in a new tab — the console stays on air.
		postprocess: (html: string): string =>
			html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" '),
	},
});

export function renderMarkdown(text: string): string {
	const out = marked.parse(text);
	if (typeof out !== "string") return "";
	// Content is model/Jira-sourced — sanitize after the postprocess hook so the
	// injected target="_blank" survives (ADD_ATTR), everything unsafe does not.
	return DOMPurify.sanitize(out, { ADD_ATTR: ["target"] });
}
