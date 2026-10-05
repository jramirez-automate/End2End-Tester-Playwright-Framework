#!/usr/bin/env node
/**
 * scan-secrets.js — lightweight secret scanner (no third-party dependency).
 *
 * Scans a set of files for common credential/secret shapes: AWS keys,
 * Anthropic/OpenAI API keys, GitHub tokens, Slack tokens, Atlassian API
 * tokens, Slack/Teams webhook URLs, JWTs, private key blocks, and basic-auth
 * URLs. Intentionally narrow — it is a pre-commit/CI
 * tripwire against accidentally committed real credentials, not a general
 * security scanner. Never modifies files.
 *
 * Usage:
 *   node scripts/scan-secrets.js               # scan tracked + untracked-not-ignored files
 *   node scripts/scan-secrets.js --staged      # scan only staged files (pre-commit)
 *   node scripts/scan-secrets.js --self-test   # verify detection logic, then exit
 *
 * Exit codes: 0 = clean, 1 = secret(s) found, 2 = self-test failed.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

// Each pattern's regex must have a capture group at index 1 for the part to mask
// in output (keep enough context to identify the finding without printing the
// full secret to logs/terminal history).

const PATTERNS = [
	{ name: "AWS Access Key ID", regex: /\b(AKIA[0-9A-Z]{16})\b/g },
	{
		name: "AWS Secret Access Key",
		regex: /aws_secret_access_key\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
	},
	{ name: "Anthropic API Key", regex: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g },
	{ name: "OpenAI API Key", regex: /\b(sk-[A-Za-z0-9]{20,})\b/g },
	{ name: "GitHub Token", regex: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,})\b/g },
	{ name: "Slack Token", regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g },
	{ name: "Atlassian API Token", regex: /\b(ATATT3[A-Za-z0-9_\-=]{30,})/g },
	{
		name: "Chat Webhook URL",
		regex:
			/(https:\/\/(?:hooks\.slack\.com\/services|[a-z0-9-]+\.webhook\.office\.com|[a-z0-9-]+\.logic\.azure\.com)\/[^\s'"]+)/gi,
	},
	{
		name: "JWT",
		regex: /\b(eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,})\b/g,
	},
	{ name: "Private Key Block", regex: /(-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----)/g },
	{ name: "Basic-Auth URL", regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"/]+:[^\s'"@/]+@[^\s'"/]+/gi },
];

const IGNORED_PATH_SEGMENTS = [
	"node_modules/",
	".git/",
	"dist/",
	"src/test-results/",
	"playwright-report/",
	"src/evidence/",
	"allure-report/",
	".auth/",
	"package-lock.json",
	"scripts/scan-secrets.js", // contains the patterns themselves — would self-match
];

// Placeholder values used in .env.example — not real secrets.
const PLACEHOLDER_HINTS = [
	"xxxxx",
	"your-",
	"replace_me",
	"changeme",
	"example",
	"placeholder",
	"<",
	"***",
];

function isIgnoredPath(relPath) {
	const normalized = relPath.replace(/\\/g, "/");
	return IGNORED_PATH_SEGMENTS.some((seg) => normalized.includes(seg));
}

function isLikelyPlaceholder(matchText) {
	const lower = matchText.toLowerCase();
	return PLACEHOLDER_HINTS.some((hint) => lower.includes(hint));
}

function mask(value) {
	if (value.length <= 8) return "***";
	return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

// Tracked files plus untracked ones that are not gitignored — everything that could
// be committed next, so a new file is covered before its first `git add`.
function gitTrackedFiles() {
	try {
		return execSync("git ls-files --cached --others --exclude-standard", {
			cwd: ROOT,
			encoding: "utf-8",
		})
			.split(/\r?\n/)
			.filter(Boolean);
	} catch {
		return [];
	}
}

function gitStagedFiles() {
	try {
		return execSync("git diff --cached --name-only --diff-filter=ACM", {
			cwd: ROOT,
			encoding: "utf-8",
		})
			.split(/\r?\n/)
			.filter(Boolean);
	} catch {
		return [];
	}
}

function scanFile(relPath) {
	const fullPath = path.join(ROOT, relPath);
	if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return [];

	let content;
	try {
		content = fs.readFileSync(fullPath, "utf-8");
	} catch {
		return [];
	}

	const findings = [];
	const lines = content.split(/\r?\n/);

	for (const pattern of PATTERNS) {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			pattern.regex.lastIndex = 0;
			let m;
			while ((m = pattern.regex.exec(line)) !== null) {
				const matched = m[1] || m[0];
				if (isLikelyPlaceholder(matched)) continue;
				findings.push({
					file: relPath,
					line: i + 1,
					pattern: pattern.name,
					masked: mask(matched),
				});
			}
		}
	}
	return findings;
}

function scan(files) {
	const findings = [];
	for (const relPath of files) {
		if (isIgnoredPath(relPath)) continue;
		findings.push(...scanFile(relPath));
	}
	return findings;
}

function selfTest() {
	const badSamples = [
		{ name: "AWS Access Key ID", text: 'key = "' + "AKIA" + "ABCDEFGHIJKLMNOP" + '"' },
		{
			name: "AWS Secret Access Key",
			text: 'aws_secret_access_key = "' + "wJ4lrXUtnFEMI/K7MDENG/" + "bPxRfiCY0f2gT9qZ12" + '"',
		},
		{
			name: "Anthropic API Key",
			text: "ANTHROPIC_API_KEY=" + "sk-ant-api03-" + "abcdefghijklmnopqrstuvwx",
		},
		{ name: "OpenAI API Key", text: "OPENAI_API_KEY=" + "sk-" + "abcdefghijklmnopqrstuvwx1234" },
		{ name: "GitHub Token", text: "token: " + "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789" },
		{ name: "Slack Token", text: "SLACK_WEBHOOK=" + "xoxb-1234567890-" + "abcdefghijklmnop" },
		{
			name: "Atlassian API Token",
			text: "JIRA_API_TOKEN=" + "ATATT3xFfGF0" + "abcdefghijklmnopqrstuvwxyz0123456789",
		},
		{
			name: "Chat Webhook URL",
			text:
				"CHAT_WEBHOOK_URL=" + "https://hooks.slack.com/services/" + "T000/B000/abcdefghijklmnop",
		},
		{
			name: "JWT",
			text:
				"eyJhbGciOiJIUzI1NiJ9." +
				"eyJzdWIiOiIxMjM0NTY3ODkwIn0." +
				"dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
		},
		{ name: "Private Key Block", text: "-----BEGIN " + "RSA PRIVATE KEY" + "-----" },
		{
			name: "Basic-Auth URL",
			text: "DB_URL=postgres://admin:" + "SuperSecret1" + "@db.internal:5432/app",
		},
	];
	const safeSamples = [
		"ANTHROPIC_API_KEY=your-anthropic-api-key-here",
		"TEST_PASSWORD=<REPLACE_ME>",
		"BASE_URL=https://example.com",
		"JIRA_API_TOKEN=",
		"CHAT_WEBHOOK_URL=",
	];

	let ok = true;
	console.log("[scan-secrets] Self-test starting…\n");

	for (const sample of badSamples) {
		const tmp = path.join(
			ROOT,
			`.tmp-secret-selftest-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
		);
		fs.writeFileSync(tmp, sample.text, "utf-8");
		const relPath = path.relative(ROOT, tmp);
		const findings = scanFile(relPath);
		fs.unlinkSync(tmp);

		const detected = findings.some((f) => f.pattern === sample.name);
		console.log(
			`  ${detected ? "ok" : "MISS"} ${sample.name} — ${detected ? "detected" : "MISSED"}`,
		);
		if (!detected) ok = false;
	}

	const tmp = path.join(ROOT, `.tmp-secret-selftest-safe-${Date.now()}.txt`);
	fs.writeFileSync(tmp, safeSamples.join("\n"), "utf-8");
	const relPath = path.relative(ROOT, tmp);
	const falsePositives = scanFile(relPath);
	fs.unlinkSync(tmp);
	console.log(
		`  ${falsePositives.length === 0 ? "ok" : "FAIL"} Placeholder allow-list — ${
			falsePositives.length === 0
				? "no false positives"
				: `${falsePositives.length} false positive(s)`
		}`,
	);
	if (falsePositives.length > 0) ok = false;

	console.log(`\n[scan-secrets] Self-test ${ok ? "PASSED" : "FAILED"}.`);
	return ok;
}

function main() {
	const args = process.argv.slice(2);

	if (args.includes("--self-test")) {
		const ok = selfTest();
		process.exit(ok ? 0 : 2);
	}

	const files = args.includes("--staged") ? gitStagedFiles() : gitTrackedFiles();
	const findings = scan(files);

	if (findings.length === 0) {
		console.log(`[scan-secrets] Clean — ${files.length} file(s) scanned, no secrets found.`);
		process.exit(0);
	}

	console.error(`[scan-secrets] ${findings.length} potential secret(s) found:\n`);
	for (const f of findings) {
		console.error(`  ${f.file}:${f.line}  [${f.pattern}]  ${f.masked}`);
	}
	console.error(
		"\n[scan-secrets] If this is a false positive, adjust the pattern/allow-list in scripts/scan-secrets.js " +
			"— do not bypass the hook without review.",
	);
	process.exit(1);
}

main();
