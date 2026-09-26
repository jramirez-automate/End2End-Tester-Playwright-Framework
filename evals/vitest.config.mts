import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.eval", quiet: true });
process.env.DEEPEVAL_TELEMETRY_OPT_OUT ??= "YES";

export default defineConfig({
	test: {
		include: ["evals/**/*.eval.ts"],
		// A local judge on CPU can take minutes per rubric.
		testTimeout: 10 * 60_000,
		// One judge call at a time: a local model can't serve parallel requests well.
		fileParallelism: false,
		sequence: { concurrent: false },
	},
});
