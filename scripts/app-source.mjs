#!/usr/bin/env node
/**
 * Report which application checkout APP_SOURCE_DIR points at, so a selector map
 * traced from source says which build it describes.
 *
 *   npm run -s app-source
 *
 * APP_SOURCE_DIR comes from the shell, else from .env.<TEST_ENV>. Only that one
 * key is read from the file; nothing else in it is printed.
 *
 * Exit 0 with "none" when unset: the explorer falls back to the running app.
 * Exit 1 when it is set but not a readable directory.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const testEnv = process.env.TEST_ENV ?? "demo";
const envFile = path.resolve(`.env.${testEnv}`);
const fromFile = fs.existsSync(envFile)
	? dotenv.parse(fs.readFileSync(envFile)).APP_SOURCE_DIR
	: undefined;
const raw = (process.env.APP_SOURCE_DIR ?? fromFile ?? "").trim();

if (!raw) {
	console.log("APP_SOURCE_DIR: none (trace selectors from the running app)");
	process.exit(0);
}

const dir = path.resolve(raw.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
	console.error(
		`APP_SOURCE_DIR: ${dir} is not a directory — fix it in .env.${testEnv} or unset it`,
	);
	process.exit(1);
}

const git = (...args) => {
	try {
		return execFileSync("git", ["-C", dir, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "";
	}
};

if (!git("rev-parse", "--is-inside-work-tree")) {
	console.log(`APP_SOURCE_DIR: ${dir} (not a git checkout, version unknown)`);
	process.exit(0);
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const commit = git("log", "-1", "--format=%h %cs");
const dirty = git("status", "--porcelain") ? ", uncommitted changes" : "";
const behind = git("rev-list", "--count", "HEAD..@{upstream}");
const upstream =
	behind && behind !== "0" ? `, ${behind} commit(s) behind its upstream as of the last fetch` : "";

console.log(`APP_SOURCE_DIR: ${dir} (${branch} @ ${commit}${dirty}${upstream})`);
