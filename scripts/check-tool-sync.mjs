#!/usr/bin/env node
/**
 * Keeps the .claude and .cursor trees saying the same thing.
 *
 * Agents and commands ship once per AI tool but must describe identical
 * conventions. Frontmatter legitimately differs (each tool has its own fields),
 * so only the body below the frontmatter is compared. Skills are shared through
 * symlinks into .agents/skills, so a name present on one side only is drift.
 *
 *   node scripts/check-tool-sync.mjs [--quiet]
 *
 * Exit code 1 when the trees disagree, so it can gate a commit.
 */
import fs from "node:fs";
import path from "node:path";

const quiet = process.argv.includes("--quiet");
const problems = [];

const body = (file) => {
	const text = fs.readFileSync(file, "utf8");
	const match = text.match(/^---\n[\s\S]*?\n---\n?/);
	return (match ? text.slice(match[0].length) : text).trim();
};

const listFiles = (dir) =>
	fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".md")).sort() : [];

for (const kind of ["agents", "commands"]) {
	const claudeDir = path.join(".claude", kind);
	const cursorDir = path.join(".cursor", kind);
	const names = new Set([...listFiles(claudeDir), ...listFiles(cursorDir)]);

	for (const name of [...names].sort()) {
		const claudeFile = path.join(claudeDir, name);
		const cursorFile = path.join(cursorDir, name);
		if (!fs.existsSync(claudeFile)) {
			problems.push(`${kind}/${name}: missing in .claude`);
			continue;
		}
		if (!fs.existsSync(cursorFile)) {
			problems.push(`${kind}/${name}: missing in .cursor`);
			continue;
		}
		if (body(claudeFile) !== body(cursorFile)) {
			problems.push(`${kind}/${name}: bodies differ (frontmatter may differ, the rest may not)`);
		}
	}
}

// Shared skills must be reachable from both tools.
const sharedDir = path.join(".agents", "skills");
const shared = fs.existsSync(sharedDir)
	? fs.readdirSync(sharedDir).filter((name) => fs.existsSync(path.join(sharedDir, name, "SKILL.md")))
	: [];

for (const name of shared) {
	for (const tool of [".claude", ".cursor"]) {
		const link = path.join(tool, "skills", name);
		if (!fs.existsSync(link)) {
			problems.push(`skills/${name}: not available to ${tool} (symlink it to ../../.agents/skills/${name})`);
			continue;
		}
		if (!fs.existsSync(path.join(link, "SKILL.md"))) {
			problems.push(`skills/${name}: ${tool} link is broken`);
		}
	}
}

if (problems.length) {
	console.error("AI tool trees are out of sync:");
	problems.forEach((problem) => console.error(`  - ${problem}`));
	console.error("\nEdit both copies in the same change, then re-run.");
	process.exit(1);
}

if (!quiet) {
	console.log(
		`AI tool trees in sync: ${listFiles(".claude/agents").length} agents, ` +
			`${listFiles(".claude/commands").length} commands, ${shared.length} shared skills.`,
	);
}
