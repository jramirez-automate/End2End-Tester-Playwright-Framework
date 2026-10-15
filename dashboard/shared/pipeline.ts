/**
 * The /e2e-ticket pipeline catalog (mirrors .claude/commands/e2e-ticket.md)
 * plus the tool-event → step inference table used when the telemetry file
 * (src/evidence/<TICKET>/pipeline-status.ndjson) is absent.
 */

export interface PipelineGateDef {
	label: string;
	quickReplies: string[];
}

export interface PipelineStepDef {
	step: number;
	title: string;
	/** Short label for tight UI (rail segments, wall cards). */
	short: string;
	subagent?: "e2e-explorer" | "e2e-runner" | "e2e-evidence" | "e2e-publisher";
	gate?: PipelineGateDef;
}

export const PROVISION_STEP: PipelineStepDef = {
	step: 0,
	title: "Prepare workspace",
	short: "workspace",
};

export const PIPELINE_STEPS: PipelineStepDef[] = [
	{
		step: 1,
		title: "Requirements and test cases",
		short: "requirements",
		gate: {
			label: "Ticket already covered, or the criteria need input — continue?",
			quickReplies: ["Yes, continue", "No, stop here"],
		},
	},
	{
		step: 2,
		title: "Map the screens and the API",
		short: "explore",
		subagent: "e2e-explorer",
		gate: {
			label: "Layer table ready — start authoring?",
			quickReplies: ["Looks right, start authoring", "Change the plan first"],
		},
	},
	{ step: 3, title: "Author specs, one slice at a time", short: "specs" },
	{
		step: 4,
		title: "Regression",
		short: "regression",
		subagent: "e2e-runner",
		gate: {
			label: "Run on another environment?",
			quickReplies: ["No, this environment only", "Yes, add another environment"],
		},
	},
	{ step: 5, title: "Evidence", short: "evidence", subagent: "e2e-evidence" },
	{
		step: 6,
		title: "Publish",
		short: "publish",
		subagent: "e2e-publisher",
		gate: {
			label: "Publish the results (test cases, comment, wiki plan, bugs)?",
			quickReplies: ["Yes, publish", "No, skip publishing"],
		},
	},
	{ step: 7, title: "Record coverage and app map", short: "record" },
];

export function stepDef(step: number): PipelineStepDef | undefined {
	if (step === 0) return PROVISION_STEP;
	return PIPELINE_STEPS.find((s) => s.step === step);
}

/**
 * Steps whose gate publishes to an external service (test management, the
 * tracker comment, the wiki plan, bugs). Nothing leaves the machine without a
 * human OK.
 */
export const PUBLISHING_STEPS: ReadonlySet<number> = new Set([6]);

export function isPublishingStep(step: number): boolean {
	return PUBLISHING_STEPS.has(step);
}

/**
 * Gates "safe" auto-approve never answers: publishing, and the regression gate,
 * which asks before a run on another (possibly shared) environment.
 */
const HUMAN_ONLY_STEPS: ReadonlySet<number> = new Set([...PUBLISHING_STEPS, 4]);

export function isHumanOnlyStep(step: number): boolean {
	return HUMAN_ONLY_STEPS.has(step);
}

// ---------------------------------------------------------------------------
// Tool-event → step inference
// ---------------------------------------------------------------------------

export interface ToolUseLike {
	name: string;
	input: Record<string, unknown>;
}

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function taskAgent(tool: ToolUseLike): string {
	return str(tool.input["subagent_type"]);
}

function bashCmd(tool: ToolUseLike): string {
	return str(tool.input["command"]).toLowerCase();
}

function editedPath(tool: ToolUseLike): string {
	return str(tool.input["file_path"]).toLowerCase();
}

const isEdit = (t: ToolUseLike) => ["Edit", "Write"].includes(t.name);
const isBash = (t: ToolUseLike) => t.name === "Bash";

/**
 * Ordered rules — the FIRST match wins. The step tracker applies the result
 * monotonically (a run never moves backward from inference).
 */
const RULES: Array<{ step: number; match: (t: ToolUseLike) => boolean }> = [
	// Most specific first: scripts and file targets.
	{
		step: 6,
		match: (t) =>
			isBash(t) && /scripts\/publish\.mjs|npm run publish\b|npm run publish:/.test(bashCmd(t)),
	},
	{
		step: 6,
		match: (t) =>
			t.name === "mcp__atlassian__createJiraIssue" ||
			t.name === "mcp__atlassian__createIssueLink" ||
			t.name === "mcp__atlassian__createConfluencePage" ||
			t.name === "mcp__atlassian__updateConfluencePage",
	},
	{
		step: 7,
		match: (t) =>
			isEdit(t) && (editedPath(t).endsWith("coverage.md") || editedPath(t).endsWith("app-map.md")),
	},
	{ step: 1, match: (t) => isEdit(t) && editedPath(t).endsWith("test-cases.json") },
	// Subagents.
	{ step: 2, match: (t) => t.name === "Task" && taskAgent(t) === "e2e-explorer" },
	{ step: 4, match: (t) => t.name === "Task" && taskAgent(t) === "e2e-runner" },
	{ step: 5, match: (t) => t.name === "Task" && taskAgent(t) === "e2e-evidence" },
	{ step: 6, match: (t) => t.name === "Task" && taskAgent(t) === "e2e-publisher" },
	// Bash runs when the main session runs them directly. Evidence capture first:
	// it is also a playwright run.
	{ step: 5, match: (t) => isBash(t) && /evidence=true|npm run test:evidence/.test(bashCmd(t)) },
	// Single-test slice runs and --list checks are step 3's loop — they must
	// outrank the generic step-4 playwright rule (first match wins).
	{
		step: 3,
		match: (t) =>
			isBash(t) &&
			bashCmd(t).includes("playwright test") &&
			/--list|--grep|\s-g\s|\.spec\.ts/.test(bashCmd(t)),
	},
	{
		step: 4,
		match: (t) => isBash(t) && /npm (run )?test\b|npm run test:|playwright test/.test(bashCmd(t)),
	},
	// Spec and page-object writing.
	{
		step: 3,
		match: (t) =>
			isEdit(t) && (editedPath(t).endsWith(".spec.ts") || editedPath(t).includes("/pages/")),
	},
	// Ticket fetch — only meaningful early; monotonicity keeps it from firing late.
	{ step: 1, match: (t) => t.name === "mcp__atlassian__getJiraIssue" },
];

/** Returns the pipeline step a tool call implies, or null when it implies nothing. */
export function inferStepFromTool(tool: ToolUseLike): number | null {
	for (const rule of RULES) {
		if (rule.match(tool)) return rule.step;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Telemetry file (pipeline-status.ndjson) line shape
// ---------------------------------------------------------------------------

export interface TelemetryLine {
	step?: number;
	status?: "started" | "done" | "skipped" | "blocked";
	pipeline?: "complete";
	ts?: string;
	/** Step-3 slice progress marker — informational only. */
	slice?: number;
}
