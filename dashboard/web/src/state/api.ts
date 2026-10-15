import type {
	BugSummary,
	CoverageResponse,
	CreateRunRequest,
	DoctorReport,
	EnvFileSummary,
	ExternalPipeline,
	HistoryOverview,
	HistoryRun,
	JiraStatusResponse,
	LocksSnapshot,
	RunRecord,
	SendMessageRequest,
	TestResultsSummary,
	TicketDetail,
	TicketSummary,
	UiConfig,
} from "../../../shared/types";

export class ApiError extends Error {
	readonly status: number;
	/** Machine-readable error code, e.g. "onboarding_required". */
	readonly code?: string;

	constructor(status: number, message: string, code?: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init);
	if (!res.ok) {
		let message = res.statusText || `Request failed (${res.status})`;
		let code: string | undefined;
		try {
			const body = (await res.json()) as { error?: unknown; message?: unknown; code?: unknown };
			if (typeof body.error === "string") message = body.error;
			else if (typeof body.message === "string") message = body.message;
			if (typeof body.code === "string") code = body.code;
		} catch {
			// Non-JSON error body — keep the status text.
		}
		throw new ApiError(res.status, message, code);
	}
	const contentType = res.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		return (await res.json()) as T;
	}
	return undefined as T;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
	// A json content-type with an empty body makes Fastify reject the request —
	// only claim json when there is actually a payload.
	return request<T>(path, {
		method: "POST",
		...(body === undefined
			? {}
			: { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
	});
}

export function fetchRuns(): Promise<RunRecord[]> {
	return request<RunRecord[]>("/api/runs");
}

export function fetchRun(id: string): Promise<RunRecord> {
	return request<RunRecord>(`/api/runs/${encodeURIComponent(id)}`);
}

export function createRun(req: CreateRunRequest): Promise<RunRecord> {
	return postJson<RunRecord>("/api/runs", req);
}

export function sendMessage(id: string, text: string): Promise<void> {
	const body: SendMessageRequest = { text };
	return postJson<void>(`/api/runs/${encodeURIComponent(id)}/message`, body);
}

export function interruptRun(id: string): Promise<void> {
	return postJson<void>(`/api/runs/${encodeURIComponent(id)}/interrupt`);
}

export function abortRun(id: string): Promise<void> {
	return postJson<void>(`/api/runs/${encodeURIComponent(id)}/abort`);
}

export function resumeRun(id: string): Promise<void> {
	return postJson<void>(`/api/runs/${encodeURIComponent(id)}/resume`);
}

export function deleteRun(id: string): Promise<void> {
	return request<void>(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function runAction(
	id: string,
	action: string,
	body?: { dryRun?: boolean; commentId?: string },
): Promise<void> {
	return postJson<void>(
		`/api/runs/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
		body,
	);
}

export function abortRunAction(id: string): Promise<void> {
	return request<void>(`/api/runs/${encodeURIComponent(id)}/actions`, { method: "DELETE" });
}

export interface ThumbMeta {
	worker: number;
	url: string;
	title?: string;
	ts?: string;
}

export function fetchThumbs(id: string): Promise<{ workers: ThumbMeta[] }> {
	return request<{ workers: ThumbMeta[] }>(`/api/runs/${encodeURIComponent(id)}/thumbs`);
}

export function fetchResults(id: string): Promise<TestResultsSummary> {
	return request<TestResultsSummary>(`/api/runs/${encodeURIComponent(id)}/results`);
}

export function fetchLocks(): Promise<LocksSnapshot> {
	return request<LocksSnapshot>("/api/locks");
}

// ---------------------------------------------------------------------------
// Onboarding doctor
// ---------------------------------------------------------------------------

export function fetchDoctor(fresh = false): Promise<DoctorReport> {
	return request<DoctorReport>(`/api/doctor${fresh ? "?fresh=1" : ""}`);
}

export function probeLogin(): Promise<{ ok: boolean; detail: string }> {
	return postJson<{ ok: boolean; detail: string }>("/api/doctor/probe-login");
}

// ---------------------------------------------------------------------------
// Credentials manager
// ---------------------------------------------------------------------------

export interface CredentialsView {
	files: Array<EnvFileSummary & { exists: boolean }>;
	meta: { jiraTokenExpiresAt: string | null };
}

export interface ProbeResult {
	ok: boolean;
	detail: string;
}

export function fetchCredentials(): Promise<CredentialsView> {
	return request<CredentialsView>("/api/credentials");
}

export function setCredentialField(file: string, key: string, value: string): Promise<void> {
	return postJson<void>(`/api/credentials/${encodeURIComponent(file)}/field`, { key, value });
}

export function revealCredentialField(file: string, key: string): Promise<{ value: string }> {
	return postJson<{ value: string }>(`/api/credentials/${encodeURIComponent(file)}/reveal`, {
		key,
	});
}

export function scaffoldCredentialFile(file: string): Promise<void> {
	return postJson<void>("/api/credentials/scaffold", { file });
}

export function importCredentials(): Promise<{ files: string[] }> {
	return postJson<{ files: string[] }>("/api/credentials/import");
}

export function syncCredentials(): Promise<{ files: string[] }> {
	return postJson<{ files: string[] }>("/api/credentials/sync");
}

export function testCredentials(target: string): Promise<ProbeResult> {
	return postJson<ProbeResult>(`/api/credentials/test/${encodeURIComponent(target)}`);
}

export function fetchConfig(): Promise<UiConfig> {
	return request<UiConfig>("/api/config");
}

// ---------------------------------------------------------------------------
// Ticket tracker + test-results history (read-only)
// ---------------------------------------------------------------------------

export function fetchTickets(): Promise<{ dir: string; tickets: TicketSummary[] }> {
	return request<{ dir: string; tickets: TicketSummary[] }>("/api/tickets");
}

export function fetchTicket(key: string): Promise<TicketDetail> {
	return request<TicketDetail>(`/api/tickets/${encodeURIComponent(key)}`);
}

/** A file inside src/evidence/<key>/ — names come from results-<env>.json, so encode each segment. */
export function ticketFileUrl(key: string, name: string): string {
	return `/api/tickets/${encodeURIComponent(key)}/files/${name.split("/").map(encodeURIComponent).join("/")}`;
}

export function fetchHistory(): Promise<HistoryOverview> {
	return request<HistoryOverview>("/api/history");
}

export function fetchHistoryRun(id: string): Promise<HistoryRun> {
	return request<HistoryRun>(`/api/history/${encodeURIComponent(id)}`);
}

export function historyFileUrl(id: string, name: string): string {
	return `/api/history/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`;
}

export function fetchBugs(): Promise<BugSummary[]> {
	return request<BugSummary[]>("/api/bugs");
}

export function fetchCoverage(): Promise<CoverageResponse> {
	return request<CoverageResponse>("/api/coverage");
}

export function fetchExternalPipelines(): Promise<ExternalPipeline[]> {
	return request<ExternalPipeline[]>("/api/pipelines/external");
}

/** Jira status for every tracked ticket and bug — server-cached 5 min; fresh skips it. */
export function fetchJiraIssues(fresh = false): Promise<JiraStatusResponse> {
	return request<JiraStatusResponse>(`/api/jira/issues${fresh ? "?fresh=1" : ""}`);
}
