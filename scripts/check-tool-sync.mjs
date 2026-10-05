#!/usr/bin/env node
/**
 * Fail when `.claude/` and `.cursor/` stop saying the same thing, so both IDEs
 * run the same pipeline. This only checks: fix drift by editing both copies in
 * the same change.
 *
 * Platform-only files are not compared:
 *   .claude/settings.json, .claude/settings.local.json
 *   .cursor/hooks.json, .cursor/mcp.json
 *
 * Skills live once in .agents/skills and must be symlinked into .claude/skills
 * and .cursor/skills.
 *
 * Usage:
 *   node scripts/check-tool-sync.mjs           # exit 2 on drift or a bad skill link
 *   node scripts/check-tool-sync.mjs --quiet   # same, silent when clean
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["agents", "commands", "rules", "hooks"];
const EXTRA = ["README.md"];
const TOOLS = [".claude", ".cursor"];
const SHARED_SKILLS = path.join(ROOT, ".agents", "skills");

function listFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFiles(p));
		else out.push(p);
	}
	return out;
}

function relUnder(root, file) {
	return path.relative(root, file).split(path.sep).join("/");
}

function pairedFiles() {
	const pairs = [];
	for (const sub of DIRS) {
		const a = path.join(ROOT, ".claude", sub);
		const b = path.join(ROOT, ".cursor", sub);
		const names = new Set([
			...listFiles(a).map((f) => relUnder(a, f)),
			...listFiles(b).map((f) => relUnder(b, f)),
		]);
		for (const name of names) {
			pairs.push({ rel: `${sub}/${name}`, claude: path.join(a, name), cursor: path.join(b, name) });
		}
	}
	for (const name of EXTRA) {
		pairs.push({
			rel: name,
			claude: path.join(ROOT, ".claude", name),
			cursor: path.join(ROOT, ".cursor", name),
		});
	}
	return pairs;
}

function checkPairs() {
	let problems = 0;
	for (const { rel, claude, cursor } of pairedFiles()) {
		const aOk = fs.existsSync(claude);
		const bOk = fs.existsSync(cursor);
		if (!aOk && !bOk) continue;
		if (!aOk || !bOk) {
			console.error(`[tool-sync] ${rel}: only in ${aOk ? ".claude" : ".cursor"}`);
			problems++;
			continue;
		}
		if (!fs.readFileSync(claude).equals(fs.readFileSync(cursor))) {
			console.error(`[tool-sync] ${rel}: .claude and .cursor differ`);
			problems++;
		}
	}
	return problems;
}

function checkSkillLinks() {
	if (!fs.existsSync(SHARED_SKILLS)) return 0;
	let problems = 0;
	const shared = fs
		.readdirSync(SHARED_SKILLS)
		.filter((name) => fs.existsSync(path.join(SHARED_SKILLS, name, "SKILL.md")));
	for (const name of shared) {
		const target = `../../.agents/skills/${name}`;
		for (const tool of TOOLS) {
			const link = path.join(ROOT, tool, "skills", name);
			let actual = null;
			try {
				actual = fs.readlinkSync(link);
			} catch {
				// missing, or a real directory instead of a link
			}
			if (actual !== target) {
				console.error(`[tool-sync] skills/${name}: ${tool} must be a symlink to ${target}`);
				problems++;
			} else if (!fs.existsSync(path.join(link, "SKILL.md"))) {
				console.error(`[tool-sync] skills/${name}: ${tool} link is broken`);
				problems++;
			}
		}
	}
	for (const tool of TOOLS) {
		const dir = path.join(ROOT, tool, "skills");
		if (!fs.existsSync(dir)) continue;
		for (const name of fs.readdirSync(dir)) {
			if (!shared.includes(name)) {
				console.error(
					`[tool-sync] ${tool}/skills/${name}: not in .agents/skills — move it there and link it`,
				);
				problems++;
			}
		}
	}
	return problems;
}

const problems = checkPairs() + checkSkillLinks();
if (problems) {
	console.error(
		`[tool-sync] ${problems} problem(s). Edit both .claude and .cursor copies in the same change.`,
	);
	process.exitCode = 2;
} else if (!process.argv.includes("--quiet")) {
	console.log("[tool-sync] .claude and .cursor match.");
}
