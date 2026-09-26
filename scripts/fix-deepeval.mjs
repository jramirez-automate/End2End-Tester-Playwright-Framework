#!/usr/bin/env node
/**
 * postinstall: deepeval (npm, up to at least 0.9.20) ships a stale
 * dist/telemetry.js beside dist/telemetry/. Node resolves
 * require("../telemetry") to the stale file, so every metric throws
 * "inComponentScope is not a function". Remove it until upstream stops
 * publishing it. Never fails the install.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "node_modules/deepeval/dist");
const stale = path.join(dist, "telemetry.js");

try {
	if (fs.existsSync(stale) && fs.existsSync(path.join(dist, "telemetry/index.js"))) {
		for (const f of [stale, path.join(dist, "telemetry.d.ts")]) fs.rmSync(f, { force: true });
		console.log("[postinstall] removed deepeval's stale dist/telemetry.js");
	}
} catch (err) {
	console.warn(`[postinstall] could not patch deepeval (non-fatal): ${err.message}`);
}
