import { describe, expect, it } from "vitest";
import { buildSessionArgs } from "./claudeArgs.js";

const BASE_ARGS = [
	"-p",
	"--input-format",
	"stream-json",
	"--output-format",
	"stream-json",
	"--include-partial-messages",
	"--verbose",
	"--permission-mode",
	"bypassPermissions",
	"--allow-dangerously-skip-permissions",
];

describe("buildSessionArgs — permission acknowledgment (claude 2.1.x gate)", () => {
	it("pairs bypassPermissions with --allow-dangerously-skip-permissions so the CLI actually enables bypass", () => {
		// claude >= 2.1 rejects `--permission-mode bypassPermissions` on its own
		// (exit 1, no output) unless bypass is explicitly enabled as an option.
		const args = buildSessionArgs({}, false);
		expect(args).toContain("bypassPermissions");
		expect(args).toContain("--allow-dangerously-skip-permissions");
	});
});

describe("buildSessionArgs", () => {
	it("returns exactly the base flags for a fresh spawn without model/effort", () => {
		expect(buildSessionArgs({}, false)).toEqual(BASE_ARGS);
	});

	it("appends --resume with the session id when resuming", () => {
		expect(buildSessionArgs({ sessionId: "sess-1" }, true)).toEqual([
			...BASE_ARGS,
			"--resume",
			"sess-1",
		]);
	});

	it("omits --resume when resuming without a recorded session id", () => {
		expect(buildSessionArgs({}, true)).toEqual(BASE_ARGS);
	});

	it("appends --model and --effort when set on the run", () => {
		expect(buildSessionArgs({ model: "sonnet", effort: "medium" }, false)).toEqual([
			...BASE_ARGS,
			"--model",
			"sonnet",
			"--effort",
			"medium",
		]);
	});

	it("appends only the flag that is set", () => {
		expect(buildSessionArgs({ model: "opus" }, false)).toEqual([...BASE_ARGS, "--model", "opus"]);
		expect(buildSessionArgs({ effort: "low" }, false)).toEqual([...BASE_ARGS, "--effort", "low"]);
	});

	it("re-applies persisted model/effort on resume", () => {
		expect(buildSessionArgs({ sessionId: "sess-1", model: "haiku", effort: "high" }, true)).toEqual(
			[...BASE_ARGS, "--resume", "sess-1", "--model", "haiku", "--effort", "high"],
		);
	});
});
