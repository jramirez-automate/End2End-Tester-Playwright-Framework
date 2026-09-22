import { config } from "../config.mjs";
import { expectOk, log } from "../logger.mjs";

/**
 * Test management sync. Creates one test case per spec title, a cycle per
 * environment, and an execution result per case. Zephyr Scale here; the shape
 * is small enough to swap for TestRail or Xray behind the same three calls.
 */
const headers = () => ({
	Authorization: `Bearer ${config.zephyr.token}`,
	"Content-Type": "application/json",
});

async function call(endpoint, options = {}) {
	const res = await fetch(`${config.zephyr.apiUrl}${endpoint}`, { ...options, headers: headers() });
	await expectOk(res, `Zephyr ${options.method ?? "GET"} ${endpoint}`);
	return res.status === 204 ? undefined : res.json();
}

export async function createTestCases({ ticket, rows }, { dryRun }) {
	const created = [];
	for (const row of rows) {
		if (dryRun) {
			log.plan(`create test case "${row.title}" in ${config.zephyr.projectKey}`);
			created.push({ key: `${config.zephyr.projectKey}-T?`, title: row.title });
			continue;
		}
		const testCase = await call("/testcases", {
			method: "POST",
			body: JSON.stringify({
				projectKey: config.zephyr.projectKey,
				name: row.title,
				objective: `Automated by ${row.file}`,
				labels: ["automated", ...(row.tags ?? []).map((tag) => tag.replace(/^@/, ""))],
				...(config.zephyr.folderId ? { folderId: Number(config.zephyr.folderId) } : {}),
			}),
		});
		created.push({ key: testCase.key, title: row.title });
		log.ok(`test case ${testCase.key} — ${row.title}`);
	}
	return created;
}

export async function createCycle({ ticket, env, status }, { dryRun }) {
	const name = `${ticket} — ${env.toUpperCase()} test cycle`;
	if (dryRun) {
		log.plan(`create cycle "${name}" (${status})`);
		return { key: `${config.zephyr.projectKey}-R?`, name };
	}
	const cycle = await call("/testcycles", {
		method: "POST",
		body: JSON.stringify({
			projectKey: config.zephyr.projectKey,
			name,
			description: `Automated run on ${env}`,
			statusName: status === "Pass" ? "Done" : "In Progress",
		}),
	});
	log.ok(`cycle ${cycle.key} — ${name}`);
	return { ...cycle, name };
}

export async function recordExecutions({ cycleKey, cases, rows, env }, { dryRun }) {
	for (const row of rows) {
		const testCase = cases.find((entry) => entry.title === row.title);
		const status = row.results[env]?.status ?? "Skipped";
		if (!testCase) continue;
		if (dryRun) {
			log.plan(`execution ${testCase.key} in ${cycleKey} → ${status}`);
			continue;
		}
		await call("/testexecutions", {
			method: "POST",
			body: JSON.stringify({
				projectKey: config.zephyr.projectKey,
				testCaseKey: testCase.key,
				testCycleKey: cycleKey,
				statusName: status === "Pass" ? "Pass" : status === "Fail" ? "Fail" : "Not Executed",
				environmentName: env,
			}),
		});
	}
}
