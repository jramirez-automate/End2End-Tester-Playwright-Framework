import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Provisioner } from "./provision.js";

/**
 * Integration tests against real temp git repos. This is a STANDALONE e2e repo:
 * the suite (playwright.config.ts, tests/, .env.*) lives at the repo root, NOT
 * in a subfolder. The credentials store is pointed at a temp dir via
 * XDG_CONFIG_HOME so tests never touch the user's real ~/.config/e2e-dashboard.
 */

let tmp: string;
let savedXdg: string | undefined;

function git(cwd: string, ...args: string[]): void {
	const res = spawnSync(
		"git",
		[
			"-c",
			"user.email=e2e@test.local",
			"-c",
			"user.name=e2e-test",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{ cwd, encoding: "utf8", windowsHide: true },
	);
	if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

/** A repo whose `main` branch has a README but NO e2e suite (no playwright.config.ts). */
async function makeRepoWithoutSuite(): Promise<string> {
	const repo = path.join(tmp, "repo");
	await mkdir(repo, { recursive: true });
	git(repo, "init", "-b", "main");
	await writeFile(path.join(repo, "README.md"), "stub\n", "utf8");
	git(repo, "add", ".");
	git(repo, "commit", "-m", "init");
	return repo;
}

/**
 * A repo whose `main` branch DOES carry the e2e suite at the ROOT
 * (playwright.config.ts), with node_modules committed at the root so the
 * provisioner fast-paths past npm install (keeps the test offline and fast).
 */
async function makeRepoWithSuite(): Promise<string> {
	const repo = path.join(tmp, "repo-suite");
	await mkdir(path.join(repo, "node_modules"), { recursive: true });
	await writeFile(path.join(repo, "playwright.config.ts"), "export default {};\n", "utf8");
	await writeFile(path.join(repo, "package.json"), '{"name":"e2e-suite"}\n', "utf8");
	await writeFile(path.join(repo, "node_modules", ".keep"), "", "utf8");
	git(repo, "init", "-b", "main");
	git(repo, "add", "-f", "."); // node_modules is normally ignored — force it in for the fixture
	git(repo, "commit", "-m", "init with suite");
	return repo;
}

/** A suite-root-shaped seed source holding one env file. */
async function makeSeedSource(): Promise<string> {
	const src = path.join(tmp, "source");
	await mkdir(src, { recursive: true });
	await writeFile(path.join(src, ".env.dev"), "APP_USERNAME=stub\n", "utf8");
	return src;
}

beforeEach(async () => {
	tmp = mkdtempSync(path.join(tmpdir(), "provision-test-"));
	savedXdg = process.env["XDG_CONFIG_HOME"];
	process.env["XDG_CONFIG_HOME"] = path.join(tmp, "xdg");
	await mkdir(path.join(tmp, "worktrees"), { recursive: true });
});

afterEach(() => {
	if (savedXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
	else process.env["XDG_CONFIG_HOME"] = savedXdg;
	rmSync(tmp, { recursive: true, force: true });
});

describe("Provisioner — base branch without the e2e suite", () => {
	it("fails fast with an actionable error naming the base branch, not a copyfile ENOENT", async () => {
		const repo = await makeRepoWithoutSuite();
		const lines: string[] = [];
		const provisioner = new Provisioner(
			{
				repoRoot: repo,
				worktreesRoot: path.join(tmp, "worktrees"),
				ticket: "ABC-99999",
				baseBranch: "main",
				e2eRootSource: await makeSeedSource(),
			},
			(l) => lines.push(l),
		);
		const err = await provisioner.run().then(
			() => null,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toMatch(/no e2e suite/);
		expect((err as Error).message).toContain('"main"');
	}, 20_000);

	it("rejects a reused leftover worktree that lacks the suite with the same actionable error", async () => {
		const repo = await makeRepoWithoutSuite();
		const wt = path.join(tmp, "worktrees", "ABC-99998");
		git(repo, "worktree", "add", wt, "-b", "feature/ABC-99998", "main");
		const lines: string[] = [];
		const provisioner = new Provisioner(
			{
				repoRoot: repo,
				worktreesRoot: path.join(tmp, "worktrees"),
				ticket: "ABC-99998",
				baseBranch: "main",
				e2eRootSource: await makeSeedSource(),
			},
			(l) => lines.push(l),
		);
		const err = await provisioner.run().then(
			() => null,
			(e: unknown) => e,
		);
		expect(lines.some((l) => l.includes("reusing"))).toBe(true);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toMatch(/no e2e suite/);
	}, 20_000);
});

describe("Provisioner — base branch that carries the e2e suite at the repo root", () => {
	it("provisions successfully and copies the stored env files into the worktree root", async () => {
		const repo = await makeRepoWithSuite();
		const lines: string[] = [];
		const provisioner = new Provisioner(
			{
				repoRoot: repo,
				worktreesRoot: path.join(tmp, "worktrees"),
				ticket: "ABC-77777",
				baseBranch: "main",
				e2eRootSource: await makeSeedSource(),
			},
			(l) => lines.push(l),
		);
		await expect(provisioner.run()).resolves.toBeUndefined();
		const copied = path.join(tmp, "worktrees", "ABC-77777", ".env.dev");
		expect(readFileSync(copied, "utf8")).toContain("APP_USERNAME=stub");
		expect(lines.some((l) => l.includes("dependencies already installed"))).toBe(true);
	}, 30_000);
});
