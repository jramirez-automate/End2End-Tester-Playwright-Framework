import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import playwright from "eslint-plugin-playwright";

const tsLanguage = {
	parser: tsparser,
	parserOptions: { ecmaVersion: 2022, sourceType: "module" },
};

const tsRules = {
	"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
	"@typescript-eslint/no-explicit-any": "warn",
	"no-console": "off",
	"no-debugger": "warn",
	"prefer-const": "warn",
	"no-var": "error",
	eqeqeq: ["warn", "always"],
};

export default [
	{
		files: ["src/tests/**/*.ts"],
		languageOptions: tsLanguage,
		plugins: { "@typescript-eslint": tseslint, playwright },
		rules: {
			...tsRules,
			// The fixtures wrap test/expect with the env guard and cleanup; a spec
			// importing the raw runner silently loses both.
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "@playwright/test",
							message: "Import test and expect from src/fixtures.ts.",
							allowTypeImports: true,
						},
					],
				},
			],
			"playwright/missing-playwright-await": "error",
			"playwright/valid-expect": "error",
			"playwright/no-focused-test": "error",
			"playwright/no-page-pause": "error",
			// Conditional skips are the write-env and credentials guards, not
			// forgotten tests.
			"playwright/no-skipped-test": "off",
			"playwright/no-force-option": "warn",
			"playwright/no-wait-for-timeout": "warn",
		},
	},
	{
		files: ["src/**/*.ts", "playwright.config.ts", "evidence-reporter.ts"],
		ignores: ["src/tests/**"],
		languageOptions: tsLanguage,
		plugins: { "@typescript-eslint": tseslint },
		rules: tsRules,
	},
	{
		files: ["scripts/**/*.mjs", "allurerc.mjs", "eslint.config.mjs"],
		languageOptions: { ecmaVersion: 2022, sourceType: "module" },
		rules: {
			"no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
			"prefer-const": "warn",
			"no-var": "error",
			eqeqeq: ["warn", "always"],
		},
	},
	{
		ignores: [
			"node_modules/**",
			"src/test-results/**",
			"src/evidence/**",
			"playwright-report/**",
			"allure-report/**",
			"allure-results/**",
			".auth/**",
			"templates/**",
			"evals/**",
			"scripts/**/*.js",
		],
	},
];
