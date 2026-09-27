/**
 * Allure Report 3 configuration. The CLI is Node, so no Java is needed locally
 * or in CI.
 *
 * One `generate` builds both views from allure-results/:
 *   awesome    the per-test report (steps, retries, history)
 *   dashboard  the charts view for a release readout
 * Running them as separate CLI passes would append a trend point per pass, so
 * one run would show up twice in the trend.
 *
 * History is appended to docs/allure-history.jsonl, which is committed, so the
 * trend survives a fresh clone and a fresh CI runner.
 */
export default {
	name: "End2End test report",
	output: "allure-report",
	historyPath: "docs/allure-history.jsonl",
	appendHistory: true,
	/**
	 * Declare failures that are already raised defects, so the report stops
	 * reading them as new regressions. Once `resolutions` is present, `rules`
	 * must be an array. A rule matches on `messageRegexp`, `testCaseId`,
	 * `retryHash` or `environment`, and resolves to:
	 *   "issue"     needs `issue: { id, type }`, `type` naming a key in `links`
	 *   "muted"     needs `comment`; hidden from the headline
	 *   "accepted"  needs `comment`; known and tolerated
	 * Rules go here, never in known-issues.json: the report writes that file
	 * itself, and hand-editing it breaks generation.
	 *
	 * resolutions: {
	 * 	links: { jira: { urlTemplate: "https://your-tenant.atlassian.net/browse/%s", nameTemplate: "%s" } },
	 * 	rules: [{ resolution: "issue", issue: { id: "ABC-456", type: "jira" }, messageRegexp: "Postal Code" }],
	 * },
	 */
	plugins: {
		awesome: {
			options: {
				reportName: "End2End test report",
				groupBy: ["parentSuite", "suite"],
			},
		},
		dashboard: {
			options: {
				reportName: "End2End health",
				singleFile: true,
			},
		},
	},
	/**
	 * Advisory gate for `npm run report:allure:gate`. Below 1 on purpose: a
	 * shared environment usually carries known defects. Declare them in
	 * `resolutions` above, then raise this so only a new failure breaks it.
	 */
	qualityGate: {
		rules: [{ successRate: 0.9 }],
	},
};
