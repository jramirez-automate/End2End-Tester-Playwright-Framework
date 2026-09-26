import { GrokModel, OllamaModel, type DeepEvalBaseLLM } from "deepeval/models";

/**
 * The LLM that scores the judgment checks. Chosen by `EVAL_JUDGE` in `.env.eval`:
 *
 *   (unset)  — no judge: only the pattern checks run
 *   ollama   — local and free; needs `ollama serve` and the model pulled.
 *              Small models (3B) are not reliable judges — use 7B or larger.
 *   grok     — xAI API; needs GROK_API_KEY (or XAI_API_KEY)
 *
 * `EVAL_JUDGE_MODEL` sets the model name for either provider.
 */
const provider = (process.env.EVAL_JUDGE ?? "").trim().toLowerCase();
const modelName = process.env.EVAL_JUDGE_MODEL?.trim() || undefined;
const ollamaURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b";

export function createJudge(): DeepEvalBaseLLM {
	switch (provider) {
		case "ollama":
			return new OllamaModel({
				model: modelName ?? DEFAULT_OLLAMA_MODEL,
				baseURL: ollamaURL,
				temperature: 0,
			});
		case "grok":
			return new GrokModel({ model: modelName, temperature: 0 });
		default:
			throw new Error(
				`No usable EVAL_JUDGE ("${provider}") — use "ollama" or "grok".`,
			);
	}
}

/**
 * Why the judge can't run, or `undefined` when it can. Judgment checks skip
 * with this reason instead of failing, so a fresh clone or a CI run without a
 * judge stays green.
 */
export async function judgeUnavailableReason(): Promise<string | undefined> {
	if (!provider) return "no judge configured (set EVAL_JUDGE in .env.eval)";
	if (provider === "grok") {
		return process.env.GROK_API_KEY || process.env.XAI_API_KEY
			? undefined
			: "EVAL_JUDGE=grok but GROK_API_KEY / XAI_API_KEY is not set";
	}
	if (provider !== "ollama") return `unknown EVAL_JUDGE "${provider}"`;

	const wanted = modelName ?? DEFAULT_OLLAMA_MODEL;
	try {
		const res = await fetch(`${ollamaURL}/api/tags`, {
			signal: AbortSignal.timeout(3000),
		});
		const { models = [] } = (await res.json()) as {
			models?: { name: string }[];
		};
		const pulled = models.some(
			(m) => m.name === wanted || m.name === `${wanted}:latest`,
		);
		return pulled
			? undefined
			: `Ollama is running but "${wanted}" is not pulled (ollama pull ${wanted})`;
	} catch {
		return `Ollama is not reachable at ${ollamaURL} (start it with: ollama serve)`;
	}
}
