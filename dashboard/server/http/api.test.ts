import { describe, expect, it } from "vitest";
import { parseCreateRunRequest, resolveRunModelEffort } from "./api.js";

const base = { ticket: "ABC-123", env: "dev" };
const config = { envs: ["demo", "dev"], ticketPattern: /^[A-Z][A-Z0-9]*-\d+$/ };

describe("parseCreateRunRequest — ticket and env", () => {
	it("rejects a ticket that does not match TICKET_PATTERN", () => {
		expect(() => parseCreateRunRequest({ ...base, ticket: "abc-1" }, config)).toThrowError(
			/TICKET_PATTERN/,
		);
	});

	it("rejects an env the suite has no .env file for", () => {
		expect(() => parseCreateRunRequest({ ...base, env: "prod" }, config)).toThrowError(
			/env must be one of: demo, dev/,
		);
	});
});

describe("parseCreateRunRequest — model/effort", () => {
	it("accepts whitelisted model and effort and includes them in the parsed request", () => {
		const parsed = parseCreateRunRequest({ ...base, model: "opus", effort: "high" }, config);
		expect(parsed.model).toBe("opus");
		expect(parsed.effort).toBe("high");
	});

	it("leaves model and effort undefined when omitted", () => {
		const parsed = parseCreateRunRequest(base, config);
		expect(parsed.model).toBeUndefined();
		expect(parsed.effort).toBeUndefined();
	});

	it("rejects a model outside the whitelist with 400", () => {
		expect(() => parseCreateRunRequest({ ...base, model: "gpt-5" }, config)).toThrowError(
			/model must be one of/,
		);
		try {
			parseCreateRunRequest({ ...base, model: "gpt-5" }, config);
		} catch (err) {
			expect((err as { statusCode?: number }).statusCode).toBe(400);
		}
	});

	it("rejects an effort outside the whitelist with 400", () => {
		expect(() => parseCreateRunRequest({ ...base, effort: "xhigh" }, config)).toThrowError(
			/effort must be one of/,
		);
		try {
			parseCreateRunRequest({ ...base, effort: "xhigh" }, config);
		} catch (err) {
			expect((err as { statusCode?: number }).statusCode).toBe(400);
		}
	});
});

describe("resolveRunModelEffort", () => {
	it("prefers the request values over the server defaults", () => {
		expect(
			resolveRunModelEffort({ model: "opus", effort: "high" }, { model: "sonnet", effort: "low" }),
		).toEqual({
			model: "opus",
			effort: "high",
		});
	});

	it("falls back to the server defaults", () => {
		expect(resolveRunModelEffort({}, { model: "sonnet", effort: undefined })).toEqual({
			model: "sonnet",
		});
	});

	it("omits both keys when nothing resolves (empty model = inherit)", () => {
		expect(resolveRunModelEffort({}, { model: "", effort: undefined })).toEqual({});
	});
});
