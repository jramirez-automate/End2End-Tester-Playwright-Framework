#!/usr/bin/env node
/**
 * Mirror shared AI config between `.claude/` and `.cursor/` so both IDEs run
 * the same pipeline. One tree is the source, the other is a copy — there is no
 * merge, because two half-synced rule sets are worse than one stale one.
 *
 * Platform-only files are NOT mirrored:
 *   .claude/settings.json, .claude/settings.local.json
 *   .cursor/hooks.json, .cursor/mcp.json
 *
 * Skills are not copied either: each lives once in .agents/skills and is
 * symlinked into .claude/skills and .cursor/skills. --check verifies the links.
 *
 * Usage:
 *   node scripts/sync-ai-mirrors.mjs --from=claude
 *   node scripts/sync-ai-mirrors.mjs --from=cursor
 *   node scripts/sync-ai-mirrors.mjs --bootstrap   # first fill: rules from cursor, rest from claude
 *   node scripts/sync-ai-mirrors.mjs --check       # exit 2 if any pair differs or a skill link is wrong
 *   node scripts/sync-ai-mirrors.mjs --check --quiet   # same, silent when clean
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["agents", "commands", "rules", "hooks"];
const SHARED_SKILLS = path.join(ROOT, ".agents", "skills");
const EXTRA = ["README.md"];

function hasFlag(flag) {
	return process.argv.includes(flag);
}

function fromArg() {
	// Last wins. The `sync:ai` npm script already carries `--from=claude`, so
	// reading the first occurrence made `npm run sync:ai -- --from=cursor`
	// silently sync the other way and overwrite the .cursor edits it was meant
	// to publish.
	const eq = process.argv.filter((a) => a.startsWith("--from=")).pop();
	return eq ? eq.slice("--from=".length) : null;
}

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

function copyFile(src, dest) {
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(src, dest);
	if (src.endsWith(".sh") || src.endsWith(".py")) {
		fs.chmodSync(dest, 0o755);
	}
}

function copyTree(fromRoot, toRoot, subdir) {
	const srcDir = path.join(fromRoot, subdir);
	const destDir = path.join(toRoot, subdir);
	if (!fs.existsSync(srcDir)) {
		console.warn(`[sync-ai] skip missing ${path.relative(ROOT, srcDir)}`);
		return 0;
	}
	let n = 0;
	for (const file of listFiles(srcDir)) {
		const rel = relUnder(srcDir, file);
		copyFile(file, path.join(destDir, rel));
		n++;
	}
	return n;
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
			pairs.push({
				rel: `${sub}/${name}`,
				claude: path.join(a, name),
				cursor: path.join(b, name),
			});
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

function checkSkillLinks() {
	if (!fs.existsSync(SHARED_SKILLS)) return 0;
	let problems = 0;
	const shared = fs
		.readdirSync(SHARED_SKILLS)
		.filter((name) => fs.existsSync(path.join(SHARED_SKILLS, name, "SKILL.md")));
	for (const name of shared) {
		for (const tool of [".claude", ".cursor"]) {
			const link = path.join(ROOT, tool, "skills", name);
			const target = `../../.agents/skills/${name}`;
			let actual = null;
			try {
				actual = fs.readlinkSync(link);
			} catch {
				// missing, or a real directory instead of a link
			}
			if (actual !== target) {
				console.error(`[sync-ai] skills/${name}: ${tool} must be a symlink to ${target}`);
				problems++;
			} else if (!fs.existsSync(path.join(link, "SKILL.md"))) {
				console.error(`[sync-ai] skills/${name}: ${tool} link is broken`);
				problems++;
			}
		}
	}
	for (const tool of [".claude", ".cursor"]) {
		const dir = path.join(ROOT, tool, "skills");
		if (!fs.existsSync(dir)) continue;
		for (const name of fs.readdirSync(dir)) {
			if (!shared.includes(name)) {
				console.error(
					`[sync-ai] ${tool}/skills/${name}: not in .agents/skills — move it there and link it`,
				);
				problems++;
			}
		}
	}
	return problems;
}

function check() {
	let drift = 0;
	for (const { rel, claude, cursor } of pairedFiles()) {
		const aOk = fs.existsSync(claude);
		const bOk = fs.existsSync(cursor);
		if (!aOk && !bOk) continue;
		if (!aOk || !bOk) {
			console.error(`[sync-ai] missing pair: ${rel}`);
			drift++;
			continue;
		}
		if (fs.readFileSync(claude).toString() !== fs.readFileSync(cursor).toString()) {
			console.error(`[sync-ai] out of sync: ${rel}`);
			drift++;
		}
	}
	drift += checkSkillLinks();
	if (drift) {
		console.error(`[sync-ai] ${drift} file(s) differ. Run: npm run sync:ai -- --from=claude`);
		process.exitCode = 2;
		return;
	}
	if (!hasFlag("--quiet")) console.log("[sync-ai] All mirrored files match.");
}

function syncFrom(side) {
	if (side !== "claude" && side !== "cursor") {
		console.error("[sync-ai] --from=claude or --from=cursor");
		process.exit(1);
	}
	const fromRoot = path.join(ROOT, side === "claude" ? ".claude" : ".cursor");
	const toRoot = path.join(ROOT, side === "claude" ? ".cursor" : ".claude");
	let n = 0;
	for (const sub of DIRS) n += copyTree(fromRoot, toRoot, sub);
	for (const name of EXTRA) {
		const src = path.join(fromRoot, name);
		if (!fs.existsSync(src)) continue;
		copyFile(src, path.join(toRoot, name));
		n++;
	}
	console.log(
		`[sync-ai] Copied ${n} file(s) ${side} → ${side === "claude" ? "cursor" : "claude"}.`,
	);
}

function bootstrap() {
	const claude = path.join(ROOT, ".claude");
	const cursor = path.join(ROOT, ".cursor");
	let n = 0;
	for (const sub of ["agents", "commands", "hooks"]) {
		n += copyTree(claude, cursor, sub);
	}
	n += copyTree(cursor, claude, "rules");
	const readme = path.join(claude, "README.md");
	if (fs.existsSync(readme)) {
		copyFile(readme, path.join(cursor, "README.md"));
		n++;
	}
	console.log(`[sync-ai] Bootstrap copied ${n} file(s) (rules from cursor, rest from claude).`);
}

const from = fromArg();
if (hasFlag("--check")) check();
else if (hasFlag("--bootstrap")) bootstrap();
else if (from) syncFrom(from);
else {
	console.error(
		"Usage: node scripts/sync-ai-mirrors.mjs --from=claude|--from=cursor|--bootstrap|--check",
	);
	process.exit(1);
}
