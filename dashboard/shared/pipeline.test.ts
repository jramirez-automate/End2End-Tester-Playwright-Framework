import { describe, expect, it } from "vitest";
import {
	inferStepFromTool,
	isHumanOnlyStep,
	isPublishingStep,
	PIPELINE_STEPS,
	PROVISION_STEP,
	stepDef,
	type ToolUseLike,
} from "./pipeline.js";

const task = (subagent_type: string, extra: Record<string, unknown> = {}): ToolUseLike => ({
	name: "Task",
	input: { subagent_type, ...extra },
});
const bash = (command: string): ToolUseLike => ({ name: "Bash", input: { command } });
const edit = (file_path: string): ToolUseLike => ({ name: "Edit", input: { file_path } });
const mcp = (name: string, input: Record<string, unknown> = {}): ToolUseLike => ({ name, input });

describe("stepDef", () => {
	it("returns the provisioning step for 0 and the catalog step otherwise", () => {
		expect(stepDef(0)).toBe(PROVISION_STEP);
		expect(stepDef(2)?.subagent).toBe("e2e-explorer");
		expect(stepDef(7)?.short).toBe("record");
	});

	it("returns undefined for a step outside the 1..7 catalog", () => {
		expect(stepDef(8)).toBeUndefined();
		expect(stepDef(-1)).toBeUndefined();
	});

	it("has exactly the 7 steps of .claude/commands/e2e-ticket.md", () => {
		expect(PIPELINE_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});
});

describe("isPublishingStep / isHumanOnlyStep", () => {
	it("flags only the publish step as outward-facing", () => {
		expect(PIPELINE_STEPS.filter((s) => isPublishingStep(s.step)).map((s) => s.step)).toEqual([6]);
	});

	it("keeps the regression gate (another environment?) away from auto-approve", () => {
		expect(isHumanOnlyStep(4)).toBe(true);
		expect(isHumanOnlyStep(6)).toBe(true);
	});

	it("lets auto-approve answer the flow gates (continue, start authoring)", () => {
		expect(isHumanOnlyStep(1)).toBe(false);
		expect(isHumanOnlyStep(2)).toBe(false);
	});
});

describe("inferStepFromTool — subagents", () => {
	it("maps each pipeline subagent to its step", () => {
		expect(inferStepFromTool(task("e2e-explorer"))).toBe(2);
		expect(inferStepFromTool(task("e2e-runner", { description: "run the suite" }))).toBe(4);
		expect(inferStepFromTool(task("e2e-evidence"))).toBe(5);
		expect(inferStepFromTool(task("e2e-publisher"))).toBe(6);
	});
});

describe("inferStepFromTool — bash runs", () => {
	it("treats a single-file / --grep slice run as the step-3 loop, not step 4", () => {
		expect(
			inferStepFromTool(bash("npx playwright test src/tests/checkout/cart.spec.ts -g 'add'")),
		).toBe(3);
		expect(inferStepFromTool(bash("npx playwright test --grep @ABC-123"))).toBe(3);
	});

	it("treats a full suite or ticket-tag run as step 4", () => {
		expect(inferStepFromTool(bash("TICKET=ABC-1 TEST_ENV=dev npx playwright test"))).toBe(4);
		expect(inferStepFromTool(bash("npm test"))).toBe(4);
		expect(inferStepFromTool(bash("npm run test:dev"))).toBe(4);
	});

	it("maps an EVIDENCE=true run to step 5, not step 4", () => {
		expect(inferStepFromTool(bash("TICKET=ABC-1 EVIDENCE=true npx playwright test"))).toBe(5);
	});

	it("maps publish.mjs to step 6", () => {
		expect(inferStepFromTool(bash("node scripts/publish.mjs all --ticket ABC-1 --dry-run"))).toBe(
			6,
		);
		expect(inferStepFromTool(bash("npm run publish:dry -- --ticket ABC-1"))).toBe(6);
	});
});

describe("inferStepFromTool — file edits and MCP", () => {
	it("maps the test-case plan to step 1 and COVERAGE.md / APP-MAP.md to step 7", () => {
		expect(inferStepFromTool(edit("/repo/src/evidence/ABC-1/test-cases.json"))).toBe(1);
		expect(inferStepFromTool(edit("/repo/COVERAGE.md"))).toBe(7);
		expect(inferStepFromTool(edit("/repo/docs/APP-MAP.md"))).toBe(7);
	});

	it("maps spec and page-object edits to step 3", () => {
		expect(inferStepFromTool(edit("/repo/src/tests/checkout/cart.spec.ts"))).toBe(3);
		expect(inferStepFromTool(edit("/repo/src/pages/cart.page.ts"))).toBe(3);
	});

	it("maps a Jira issue fetch to step 1 and issue or page creation to step 6", () => {
		expect(inferStepFromTool(mcp("mcp__atlassian__getJiraIssue", { issueIdOrKey: "ABC-1" }))).toBe(
			1,
		);
		expect(inferStepFromTool(mcp("mcp__atlassian__createJiraIssue"))).toBe(6);
		expect(inferStepFromTool(mcp("mcp__atlassian__createConfluencePage"))).toBe(6);
	});

	it("returns null when a tool implies no pipeline step", () => {
		expect(inferStepFromTool(mcp("Read", { file_path: "/repo/README.md" }))).toBeNull();
		expect(inferStepFromTool(bash("ls -la"))).toBeNull();
	});
});
