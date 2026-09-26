import { GEval, PatternMatchMetric, type BaseMetric } from "deepeval/metrics";
import { SingleTurnParams } from "deepeval/test-case";

import { createJudge } from "./judge";

/**
 * Rubrics for the QA artifacts, written from this suite's conventions
 * (`test-case-design`, `bug-reporting`, `exploratory-testing` skills).
 * An artifact passes only when every check passes.
 *
 * Two kinds of check:
 * - **pattern** — a format rule (ids, headings, forbidden code words). Checked
 *   with a regular expression: instant, free, and never wrong. Always runs.
 * - **judge** — a question that needs reading comprehension (are all criteria
 *   covered? is anything invented?). Scored by the LLM judge in `.env.eval`,
 *   one question per metric. Runs only when a judge is configured.
 */
export const PASS_THRESHOLD = 0.7;

export type Check =
	| { name: string; type: "pattern"; pattern: string }
	| { name: string; type: "judge"; question: string; needsInput?: boolean };

/*
 * PatternMatchMetric must match the WHOLE artifact, so these helpers turn
 * "starts with / contains / lacks X" into a full-text pattern.
 */
const startsWith = (re: string) => `\\s*(?:${re})[\\s\\S]*`;
const contains = (...res: string[]) =>
	`${res.map((re) => `(?=[\\s\\S]*?(?:${re}))`).join("")}[\\s\\S]*`;
const lacks = (re: string) => `(?![\\s\\S]*?(?:${re}))[\\s\\S]*`;
const both = (a: string, b: string) => `(?=${a}$)${b}`;

export const rubrics: Record<string, Check[]> = {
	"test-cases": [
		{
			name: "TC ids",
			type: "pattern",
			// At least one TC-###, and no TC1 / TC-1 / TC-0001 style ids.
			pattern: both(
				contains("\\bTC-\\d{3}\\b"),
				lacks("\\bTC(?!-\\d{3}\\b)-?\\d"),
			),
		},
		{
			name: "Verify names",
			type: "pattern",
			// No table row whose name column doesn't start with "Verify".
			pattern: lacks("(?:^|\\n)\\|\\s*TC[^|\\n]*\\|\\s*(?![\\s]|Verify\\b)"),
		},
		{
			name: "User-action steps",
			type: "pattern",
			pattern: lacks(
				"\\bawait\\b|getBy\\w+\\(|=>|\\w\\(\\)|\\.spec\\.ts|\\bsrc/",
			),
		},
		{
			name: "One expected result",
			type: "judge",
			question:
				"Does each test case state exactly one specific, observable expected result, such as a quoted message? Vague results like 'Works' or several results in one case fail.",
		},
		{
			name: "Criteria covered",
			type: "judge",
			needsInput: true,
			question:
				"Is every acceptance criterion in the input covered by at least one test case, including at least one case where the product refuses an invalid action?",
		},
		{
			name: "No invented facts",
			type: "judge",
			needsInput: true,
			question:
				"Does the output avoid stating any limit or error message that the input does not mention? Raising such things as an open question is fine; stating them as an expected result fails.",
		},
	],
	"bug-report": [
		{
			name: "Environment first",
			type: "pattern",
			pattern: startsWith(
				"Environment:\\s*\\n\\s*URL:\\s*https?://[^\\s/]+/\\S+\\s*\\n\\s*Browser ver:\\s*\\S",
			),
		},
		{
			name: "Summary says what and where",
			type: "judge",
			question:
				"Is there a one-line summary that says what is wrong and on which screen, in words a user would use? A vague summary like 'checkout broken' fails.",
		},
		{
			name: "Numbered steps",
			type: "pattern",
			pattern: contains("Steps to reproduce:\\s*\\n\\s*1\\.\\s+\\S"),
		},
		{
			name: "Expected vs actual",
			type: "pattern",
			pattern: contains("Expected result:", "Actual result:"),
		},
		{
			name: "Severity and priority",
			type: "pattern",
			pattern: contains(
				"Severity:\\s*(?:Critical|High|Medium|Low)\\b",
				"Priority:\\s*\\w",
			),
		},
		{
			name: "No code references",
			type: "pattern",
			pattern: lacks(
				"\\.(?:ts|tsx|js|jsx|py)\\b|\\bline \\d+|getBy\\w+\\(|\\w\\(\\)",
			),
		},
	],
	"session-debrief": [
		{
			name: "Five sections",
			type: "pattern",
			pattern: contains(
				"Covered:",
				"Found:",
				"Blocked by:",
				"Still open:",
				"Risk call:",
			),
		},
		{
			name: "Bugs with ids",
			type: "pattern",
			pattern: contains(
				"Found:[\\s\\S]*?(?:\\b[A-Z][A-Z0-9]+-\\d+\\b|\\bnone\\b)",
			),
		},
		{
			name: "Risk call",
			type: "pattern",
			pattern: contains(
				"Risk call:\\s*\\n?\\s*(?:Ship with known issues|Ship|Hold)\\b",
			),
		},
		{
			name: "Mission, env, duration",
			type: "judge",
			question:
				"Does it state the mission, the environment and how many minutes the session lasted?",
		},
		{
			name: "Concrete follow-ups",
			type: "judge",
			question:
				"Does it list concrete follow-up missions, each saying what to explore and how, rather than 'look at it more later'?",
		},
	],
};

export function checkMetric(check: Check): BaseMetric {
	if (check.type === "pattern") {
		return new PatternMatchMetric({
			pattern: check.pattern,
			threshold: PASS_THRESHOLD,
		});
	}
	return new GEval({
		name: check.name,
		evaluationParams: check.needsInput
			? [SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT]
			: [SingleTurnParams.ACTUAL_OUTPUT],
		evaluationSteps: [
			check.question,
			"Score 10 if the answer is clearly yes, 0 if it is no. Judge only this question and ignore every other quality of the text.",
		],
		model: createJudge(),
		threshold: PASS_THRESHOLD,
	});
}
