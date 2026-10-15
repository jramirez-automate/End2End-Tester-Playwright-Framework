import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { buildConfig } from "./config.js";
import { HistoryStore } from "./history/store.js";
import { actionsPlugin } from "./http/actions.js";
import { apiPlugin, ApiError, RunManager } from "./http/api.js";
import { artifactsPlugin } from "./http/artifacts.js";
import { credentialsPlugin } from "./http/credentials.js";
import { locksPlugin } from "./http/locks.js";
import { trackerPlugin } from "./http/tracker.js";
import { JiraStatusService } from "./jira.js";
import { LockService } from "./locks/semaphores.js";
import { Registry } from "./runs/registry.js";
import { EvidenceIndex } from "./tickets/index.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
	const config = buildConfig();
	await mkdir(path.join(config.dataDir, "runs"), { recursive: true });

	const registry = new Registry(config.dataDir);
	await registry.load();

	const manager = new RunManager(config, registry);
	await manager.orphanSweep();

	const locks = new LockService(config.envCaps);

	const app = Fastify({ logger: false });

	app.setErrorHandler((err: unknown, _request, reply) => {
		const withStatus = err as { statusCode?: unknown; message?: unknown };
		const statusCode =
			err instanceof ApiError
				? err.statusCode
				: typeof withStatus.statusCode === "number"
					? withStatus.statusCode
					: 500;
		const message = err instanceof Error ? err.message : String(err);
		void reply.code(statusCode).send({ error: message });
	});

	await app.register(apiPlugin, { manager, locks });
	await app.register(artifactsPlugin, { config, registry });
	await app.register(locksPlugin, { locks });
	await app.register(credentialsPlugin, { config });
	await app.register(actionsPlugin, { manager });
	await app.register(trackerPlugin, {
		evidence: new EvidenceIndex(config.evidenceDir, config.coveragePath),
		history: new HistoryStore(config.historyDir),
		jira: new JiraStatusService(),
		suiteDir: config.suiteDir,
	});

	const webDist = path.resolve(serverDir, "..", "web", "dist");
	const hasWebDist = existsSync(webDist);
	if (hasWebDist) {
		await app.register(fastifyStatic, { root: webDist });
	}
	app.setNotFoundHandler((request, reply) => {
		// SPA fallback: any non-API GET renders the web app.
		if (hasWebDist && request.method === "GET" && !request.url.startsWith("/api/")) {
			void reply.sendFile("index.html");
			return;
		}
		void reply.code(404).send({ error: "not found" });
	});

	await app.listen({ host: "127.0.0.1", port: config.port });
	// eslint-disable-next-line no-console -- boot banner for a local dev tool
	console.log(
		`E2E Control Room server: http://127.0.0.1:${config.port} (repo: ${config.repoRoot})`,
	);

	let shuttingDown = false;
	const shutdown = (signal: NodeJS.Signals): void => {
		if (shuttingDown) return;
		shuttingDown = true;
		void (async () => {
			// eslint-disable-next-line no-console
			console.log(`\n${signal} — stopping runs and saving state…`);
			locks.stop();
			await manager.shutdown();
			await app.close();
			process.exit(0);
		})();
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
	// eslint-disable-next-line no-console
	console.error(err);
	process.exit(1);
});
