#!/usr/bin/env node
/**
 * Push framework-owned files from this repo into a child repo that started as
 * a copy of it. The child has no shared git history with the framework, so
 * this copies files instead of merging.
 *
 * Source is the framework's committed HEAD, never the working tree, so the
 * commit recorded in the child is exactly what was copied.
 *
 * The child keeps `.framework-sync.json`:
 *   {
 *     "local": ["src/utils/env.ts", "scripts/lib/"],  // never touched; "/" = folder
 *     "commit": "<framework sha last synced>",
 *     "files": { "<path>": "<git blob sha last synced>" }
 *   }
 * Only `local` is hand-edited; --apply rewrites the rest.
 *
 * Each framework file is classified against the child:
 *   add       missing in the child
 *   update    child still holds what was last synced, so the change is purely upstream
 *   conflict  child differs and was edited since the last sync (or never synced)
 *   remove    framework deleted it and the child copy is unedited
 *   blocked   child has a directory where the framework has a file or link;
 *             never written, move it by hand
 *   local     listed in `local`
 * --apply writes add, update and remove. A conflict takes the framework's
 * version with --take=<path> (repeatable; "/" = folder) or --overwrite (all),
 * or keeps the child's with an entry in `local`.
 *
 * Usage:
 *   node scripts/sync-child.mjs ../End2EndTester              # dry run: the plan
 *   node scripts/sync-child.mjs ../End2EndTester --diff       # plan plus diffs
 *   node scripts/sync-child.mjs ../End2EndTester --apply      # write add/update/remove
 *   node scripts/sync-child.mjs ../End2EndTester --apply --take=src/utils/cleanup.ts
 *   node scripts/sync-child.mjs ../End2EndTester --apply --overwrite   # every conflict
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = ".framework-sync.json";

const INCLUDE = [
	".agents/skills/",
	".claude/agents/",
	".claude/commands/",
	".claude/hooks/",
	".claude/rules/",
	".claude/skills/",
	".claude/README.md",
	".cursor/agents/",
	".cursor/commands/",
	".cursor/hooks/",
	".cursor/rules/",
	".cursor/skills/",
	".cursor/README.md",
	".husky/",
	".prettierrc",
	".prettierignore",
	"eslint.config.mjs",
	"evals/",
	"evidence-reporter.ts",
	"scripts/",
	"skills-lock.json",
	"src/fixtures.ts",
	"src/types/",
	"src/utils/",
	"templates/",
	"tsconfig.json",
];
const EXCLUDE = ["scripts/sync-child.mjs"];

function hasFlag(flag) {
	return process.argv.includes(flag);
}

function git(cwd, args, opts = {}) {
	return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20, ...opts });
}

function matches(rel, entries) {
	return entries.some((e) => (e.endsWith("/") ? rel.startsWith(e) : rel === e));
}

function blobSha(buf) {
	return crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

function frameworkFiles() {
	const out = new Map();
	for (const line of git(ROOT, ["ls-tree", "-r", "HEAD"]).split("\n")) {
		if (!line) continue;
		const [meta, rel] = line.split("\t");
		const [mode, , sha] = meta.split(" ");
		if (!matches(rel, INCLUDE) || matches(rel, EXCLUDE)) continue;
		out.set(rel, { mode, sha });
	}
	return out;
}

/** Child file as git would hash it; symlinks hash their target. */
function childFile(childRoot, rel) {
	const p = path.join(childRoot, rel);
	let st;
	try {
		st = fs.lstatSync(p);
	} catch {
		return null;
	}
	if (st.isSymbolicLink()) return { link: true, sha: blobSha(Buffer.from(fs.readlinkSync(p))) };
	if (!st.isFile()) return { dir: st.isDirectory(), sha: null };
	return { link: false, sha: blobSha(fs.readFileSync(p)) };
}

function readManifest(childRoot) {
	const p = path.join(childRoot, MANIFEST);
	if (!fs.existsSync(p)) return { local: [], files: {} };
	const m = JSON.parse(fs.readFileSync(p, "utf8"));
	return { ...m, local: m.local ?? [], files: m.files ?? {} };
}

function plan(childRoot, manifest) {
	const fw = frameworkFiles();
	const rows = [];
	for (const [rel, { mode, sha }] of fw) {
		if (matches(rel, manifest.local)) {
			rows.push({ rel, kind: "local" });
			continue;
		}
		const child = childFile(childRoot, rel);
		if (child?.sha === sha) continue;
		const last = manifest.files[rel];
		let kind;
		if (!child) kind = "add";
		else if (child.sha === null) kind = "blocked";
		else if (last && child.sha === last) kind = "update";
		else kind = "conflict";
		rows.push({ rel, kind, mode, sha });
	}
	for (const [rel, last] of Object.entries(manifest.files)) {
		if (fw.has(rel) || matches(rel, manifest.local)) continue;
		const child = childFile(childRoot, rel);
		if (!child) continue;
		rows.push({ rel, kind: child.sha === last ? "remove" : "conflict", removed: true });
	}
	return { fw, rows };
}

function blob(sha) {
	return execFileSync("git", ["cat-file", "blob", sha], { cwd: ROOT, maxBuffer: 64 << 20 });
}

function showDiff(childRoot, row) {
	const childPath = path.join(childRoot, row.rel);
	let fwPath = "/dev/null";
	if (!row.removed) {
		fwPath = path.join(os.tmpdir(), `sync-child-${row.sha}`);
		fs.writeFileSync(fwPath, blob(row.sha));
	}
	const from = fs.existsSync(childPath) ? childPath : "/dev/null";
	spawnSync("git", ["--no-pager", "diff", "--no-index", "--color=auto", from, fwPath], {
		stdio: "inherit",
	});
	if (fwPath !== "/dev/null") fs.rmSync(fwPath, { force: true });
}

function write(childRoot, row) {
	const dest = path.join(childRoot, row.rel);
	if (row.removed) {
		fs.rmSync(dest, { force: true });
		return;
	}
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.rmSync(dest, { force: true });
	const body = blob(row.sha);
	if (row.mode === "120000") fs.symlinkSync(body.toString(), dest);
	else fs.writeFileSync(dest, body, { mode: row.mode === "100755" ? 0o755 : 0o644 });
}

function packageHints(childRoot) {
	const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
	const childPkg = path.join(childRoot, "package.json");
	if (!fs.existsSync(childPkg)) return [];
	const fw = read(path.join(ROOT, "package.json"));
	const child = read(childPkg);
	const hints = [];
	for (const [name, cmd] of Object.entries(fw.scripts ?? {})) {
		if (!(name in (child.scripts ?? {}))) hints.push(`script  ${name}: ${cmd}`);
	}
	for (const field of ["dependencies", "devDependencies"]) {
		const childDeps = { ...child.dependencies, ...child.devDependencies };
		for (const [name, ver] of Object.entries(fw[field] ?? {})) {
			if (childDeps[name] !== ver) {
				hints.push(`${field}  ${name}: ${childDeps[name] ?? "(missing)"} -> ${ver}`);
			}
		}
	}
	return hints;
}

function main() {
	const target = process.argv.slice(2).find((a) => !a.startsWith("--"));
	if (!target) {
		console.error(
			"Usage: node scripts/sync-child.mjs <child-repo> [--diff] [--apply [--overwrite]]",
		);
		process.exit(1);
	}
	const childRoot = path.resolve(target);
	if (!fs.existsSync(path.join(childRoot, ".git"))) {
		console.error(`[sync-child] ${childRoot} is not a git repository`);
		process.exit(1);
	}
	if (childRoot === ROOT) {
		console.error("[sync-child] the child must be a different repository");
		process.exit(1);
	}

	const apply = hasFlag("--apply");
	const overwrite = hasFlag("--overwrite");
	const branch = git(childRoot, ["branch", "--show-current"]).trim();
	if (apply && ["main", "master", ""].includes(branch)) {
		console.error(
			`[sync-child] child is on "${branch || "detached HEAD"}"; create a branch there first`,
		);
		process.exit(1);
	}
	const dirty = git(ROOT, ["status", "--porcelain", "--", ...INCLUDE]).trim();
	if (dirty) {
		console.warn("[sync-child] framework has uncommitted changes in synced paths; using HEAD only");
	}

	const commit = git(ROOT, ["rev-parse", "HEAD"]).trim();
	const manifest = readManifest(childRoot);
	const { fw, rows } = plan(childRoot, manifest);

	console.log(`[sync-child] framework ${commit.slice(0, 7)} -> ${childRoot} (${branch})`);
	if (manifest.commit) {
		console.log(`[sync-child] last synced from ${manifest.commit.slice(0, 7)}`);
	} else {
		console.log(`[sync-child] no ${MANIFEST} yet: every differing file is a conflict`);
	}
	const kinds = ["add", "update", "remove", "conflict", "blocked", "local"];
	for (const kind of kinds) {
		const group = rows.filter((r) => r.kind === kind);
		if (!group.length) continue;
		console.log(`\n${kind} (${group.length})`);
		for (const r of group) console.log(`  ${r.rel}${r.removed ? "  (deleted upstream)" : ""}`);
	}
	if (!rows.some((r) => r.kind !== "local")) console.log("\n[sync-child] child is up to date");

	if (hasFlag("--diff")) {
		for (const r of rows) if (r.kind !== "local") showDiff(childRoot, r);
	}

	const hints = packageHints(childRoot);
	if (hints.length) {
		console.log(
			"\npackage.json differences (not synced; merge by hand if a synced file needs them)",
		);
		for (const h of hints) console.log(`  ${h}`);
	}

	if (!apply) {
		console.log("\n[sync-child] dry run; nothing written. Re-run with --apply to write.");
		return;
	}

	const take = process.argv
		.filter((a) => a.startsWith("--take="))
		.map((a) => a.slice("--take=".length));
	const writable = rows.filter(
		(r) =>
			["add", "update", "remove"].includes(r.kind) ||
			(r.kind === "conflict" && (overwrite || matches(r.rel, take))),
	);
	for (const r of writable) write(childRoot, r);

	const files = {};
	for (const [rel, { sha }] of fw) {
		if (matches(rel, manifest.local)) continue;
		const child = childFile(childRoot, rel);
		if (child?.sha === sha) files[rel] = sha;
		else if (manifest.files[rel]) files[rel] = manifest.files[rel];
	}
	const next = { local: manifest.local, commit, files };
	fs.writeFileSync(path.join(childRoot, MANIFEST), `${JSON.stringify(next, null, "\t")}\n`);

	const skipped = rows.filter((r) => r.kind === "conflict" && !writable.includes(r)).length;
	console.log(`\n[sync-child] wrote ${writable.length} file(s) and ${MANIFEST}`);
	if (skipped) {
		console.log(
			`[sync-child] ${skipped} conflict(s) left as they are: add them to "local" or re-run with --overwrite`,
		);
	}
}

main();
