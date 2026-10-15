import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// web/src pure modules (format/derive/transcript) are DOM-free and run under node.
		include: ["server/**/*.test.ts", "shared/**/*.test.ts", "web/src/**/*.test.ts"],
	},
});
