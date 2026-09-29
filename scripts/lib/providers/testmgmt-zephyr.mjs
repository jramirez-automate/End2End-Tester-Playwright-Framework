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

export async function createTestCases({ rows }, { dryRun }) {
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
				labels: [
					"automated",
					...(row.layer === "api" ? ["API"] : []),
					...(row.tags ?? []).map((tag) => tag.replace(/^@/, "")),
				],
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

const zephyrStatus = (status) =>
	status === "Pass" ? "Pass" : status === "Fail" ? "Fail" : "Not Executed";

async function execute({ testCaseKey, testCycleKey, statusName, env }) {
	await call("/testexecutions", {
		method: "POST",
		body: JSON.stringify({
			projectKey: config.zephyr.projectKey,
			testCaseKey,
			testCycleKey,
			statusName,
			...(env ? { environmentName: env } : {}),
		}),
	});
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
		await execute({
			testCaseKey: testCase.key,
			testCycleKey: cycleKey,
			statusName: zephyrStatus(status),
			env,
		});
	}
}

/**
 * Create the planned cases, written from the ticket's criteria, plus one cycle
 * holding a "Not Executed" execution per case for `mark-pass` to record into.
 */
export async function createPlannedCases({ ticket, cases }, { dryRun }) {
	const created = [];
	for (const entry of cases) {
		const name = `${entry.tc} ${entry.name}`;
		if (dryRun) {
			log.plan(
				`create planned ${entry.layer === "api" ? "API " : ""}case "${name}" (${entry.steps.length} step(s))`,
			);
			created.push({
				tc: entry.tc,
				key: `${config.zephyr.projectKey}-T?`,
				name,
				test: entry.test ?? "",
				...(entry.layer ? { layer: entry.layer } : {}),
			});
			continue;
		}
		const testCase = await call("/testcases", {
			method: "POST",
			body: JSON.stringify({
				projectKey: config.zephyr.projectKey,
				name,
				objective: entry.objective ?? `Acceptance criteria of ${ticket}`,
				...(entry.precondition ? { precondition: entry.precondition } : {}),
				labels: [
					ticket,
					...(entry.manual ? [] : ["Automated"]),
					...(entry.layer === "api" ? ["API"] : []),
				],
				...(config.zephyr.folderId ? { folderId: Number(config.zephyr.folderId) } : {}),
			}),
		});
		// The expected result sits on the last step only: one observable
		// outcome per case, which is how a manual tester reads it.
		await call(`/testcases/${testCase.key}/teststeps`, {
			method: "POST",
			body: JSON.stringify({
				mode: "OVERWRITE",
				items: entry.steps.map((step, index) => ({
					inline: {
						description: step,
						expectedResult: index === entry.steps.length - 1 ? entry.expected : "",
					},
				})),
			}),
		});
		created.push({
			tc: entry.tc,
			key: testCase.key,
			name,
			test: entry.test ?? "",
			...(entry.layer ? { layer: entry.layer } : {}),
		});
		log.ok(`planned case ${testCase.key} — ${name}`);
	}

	const cycleName = `${ticket} — test cycle`;
	if (dryRun) {
		log.plan(`create cycle "${cycleName}" with ${created.length} "Not Executed" execution(s)`);
		return { cycleKey: `${config.zephyr.projectKey}-R?`, cycleName, cases: created };
	}
	const cycle = await call("/testcycles", {
		method: "POST",
		body: JSON.stringify({
			projectKey: config.zephyr.projectKey,
			name: cycleName,
			description: `Planned from the acceptance criteria of ${ticket}`,
			statusName: "In Progress",
		}),
	});
	for (const entry of created) {
		await execute({ testCaseKey: entry.key, testCycleKey: cycle.key, statusName: "Not Executed" });
	}
	log.ok(`cycle ${cycle.key} — ${cycleName}`);
	return { cycleKey: cycle.key, cycleName, cases: created };
}

/**
 * Record the run against the planned cases. Each result is a new execution in
 * the same cycle rather than an edit of the planned one: Zephyr keeps every
 * execution as the record of one attempt, and the planned "Not Executed" entry
 * is what proves the cases came first.
 */
export async function markResults({ state, rows, env }, { dryRun }) {
	const recorded = [];
	for (const entry of state.cases) {
		const row = entry.test ? rows.find((candidate) => candidate.title === entry.test) : undefined;
		const result = row?.results[env];
		if (!result) continue;
		recorded.push(entry.tc);
		if (dryRun) {
			log.plan(
				`execution ${entry.key} (${entry.tc}) in ${state.cycleKey} on ${env} → ${result.status}`,
			);
			continue;
		}
		await execute({
			testCaseKey: entry.key,
			testCycleKey: state.cycleKey,
			statusName: zephyrStatus(result.status),
			env,
		});
	}
	return recorded;
}
