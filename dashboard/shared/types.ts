/**
 * Shared contracts between the dashboard server and web UI.
 * This file is the single source of truth — both tsconfigs include it.
 */

/** A TEST_ENV name: `demo`, or any `.env.<name>` in the suite root. */
export type TestEnv = string;

/**
 * What the web UI needs from the server config (GET /api/config). `envs` is the
 * promotion order — the Board's columns, left to right — and the envs the New Run
 * form offers.
 */
export interface UiConfig {
	envs: TestEnv[];
	envCaps: Record<string, number>;
	/** TICKET_PATTERN from .env.publish, as a RegExp source. */
	ticketPattern: string;
	baseBranch: string;
	/** "<JIRA_BASE_URL>/browse/" from .env.publish, when a Jira tracker is set up. */
	trackerBrowseUrl?: string;
}

/** Model aliases the New Run form offers for the spawned claude session. */
export const RUN_MODELS = ["sonnet", "opus", "haiku", "fable"] as const;
export type RunModel = (typeof RUN_MODELS)[number];

/** Effort levels the New Run form offers (higher tiers stay session-only). */
export const RUN_EFFORTS = ["low", "medium", "high"] as const;
export type RunEffort = (typeof RUN_EFFORTS)[number];

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export type RunState =
	| "queued"
	| "provisioning"
	| "starting"
	| "running"
	| "waiting_gate"
	| "completed"
	| "failed"
	| "aborted"
	| "interrupted";

export const ACTIVE_STATES: RunState[] = [
	"queued",
	"provisioning",
	"starting",
	"running",
	"waiting_gate",
];

/** How many times the server auto-resumes a crashed session before handing back the Resume button. */
export const AUTO_RESUME_MAX = 3;

export type StepStatus = "pending" | "active" | "done" | "skipped" | "blocked";

/** Which signal set a step's status (telemetry file beats stream inference beats artifacts). */
export type StepSource = "telemetry" | "inference" | "artifact";

export interface StepState {
	/** 0 = workspace provisioning, 1..7 = pipeline steps (see pipeline.ts). */
	step: number;
	status: StepStatus;
	source?: StepSource;
	startedAt?: string;
	endedAt?: string;
	/** Live context, e.g. the subagent or npm script currently running. */
	detail?: string;
}

export interface GateInfo {
	/** The assistant text shown when the session went idle awaiting input. */
	question: string;
	/** Best-known pipeline step the gate belongs to. */
	step: number;
	quickReplies: string[];
	raisedAt: string;
}

export interface RunRecord {
	id: string;
	ticket: string;
	env: TestEnv;
	extraContext?: string;
	state: RunState;
	steps: StepState[];
	/** Claude session id, once known (from the system:init stream event). */
	sessionId?: string;
	childPid?: number;
	/** Absolute path of the worktree the session runs in (cwd of the claude child). */
	worktreePath: string;
	/** Absolute path of the e2e suite root — the worktree root in this standalone repo. */
	e2eRoot: string;
	createdAt: string;
	updatedAt: string;
	endedAt?: string;
	/**
	 * Model/effort passed to the claude child via --model/--effort. Resolved once at
	 * creation (request value else server default) so resume and partial actions reuse
	 * the exact same session settings. Absent = inherit the CLI user's default.
	 * String (not RunModel) — server defaults may carry full model IDs.
	 */
	model?: string;
	effort?: string;
	/** Accumulated across turn result events. */
	costUsd: number;
	turns: number;
	lastAssistantText?: string;
	gate: GateInfo | null;
	error?: string;
	/** True when pipeline-status.ndjson never appeared (step tracking is inference-only). */
	reducedTelemetry?: boolean;
	/**
	 * Set while the server is auto-resuming a crashed session (1-based attempt).
	 * Cleared on a completed turn, a manual resume, or when retries are exhausted.
	 */
	autoResumeAttempt?: number;
}

// ---------------------------------------------------------------------------
// Event stream (persisted to events.ndjson, replayed over SSE)
// ---------------------------------------------------------------------------

export type RunEventKind =
	| "claude" // raw claude stream-json message (payload: ClaudeStreamMessage)
	| "state" // run state transition (payload: { state, previous, run })
	| "step" // step status change (payload: StepState)
	| "artifact" // evidence file appeared (payload: ArtifactRef)
	| "provision" // provisioning log line (payload: { line })
	| "action" // partial-action output line (payload: { action, line })
	| "gate" // gate raised/cleared (payload: GateInfo | null)
	| "error"; // supervisor-level error (payload: { message })

export interface RunEvent {
	seq: number;
	ts: string;
	kind: RunEventKind;
	payload: unknown;
}

export interface ArtifactRef {
	/** Path relative to src/evidence/<TICKET>/, e.g. "add-item-dev.webm" or "SUMMARY.md". */
	relPath: string;
	kind: "screenshot" | "video" | "trace" | "summary" | "report" | "json" | "other";
	/** URL path the web UI can fetch it from. */
	url: string;
	size: number;
	mtime: string;
}

/**
 * Minimal typing of the claude CLI stream-json NDJSON messages we consume.
 * Kept intentionally loose — the CLI adds fields between versions.
 */
export interface ClaudeStreamMessage {
	type: "system" | "assistant" | "user" | "result" | "stream_event" | string;
	subtype?: string;
	session_id?: string;
	message?: {
		role?: string;
		content?: Array<Record<string, unknown>>;
		[k: string]: unknown;
	};
	event?: Record<string, unknown>;
	total_cost_usd?: number;
	usage?: Record<string, unknown>;
	is_error?: boolean;
	result?: string;
	[k: string]: unknown;
}

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

export interface CreateRunRequest {
	ticket: string;
	env: TestEnv;
	extraContext?: string;
	/** Reuse the repo checkout the dashboard itself runs from (API default: true). */
	reuseCurrentWorktree?: boolean;
	/** Base branch for a fresh worktree (default: the server's DASHBOARD_BASE_BRANCH, else main). */
	baseBranch?: string;
	/** Model for the spawned claude session (default: the server's DASHBOARD_MODEL). */
	model?: RunModel;
	/** Effort for the spawned claude session (default: the server's DASHBOARD_EFFORT). */
	effort?: RunEffort;
}

export interface SendMessageRequest {
	text: string;
}

export type PartialAction =
	"rerun-failing" | "recapture-evidence" | "attach" | "post-comment" | "mark-pass" | "plan";

export interface RunActionRequest {
	dryRun?: boolean;
}

export interface LockLease {
	leaseId: string;
	env: string;
	pid: number;
	runId?: string;
	grantedAt: string;
}

export interface LocksSnapshot {
	caps: Record<string, number>;
	held: LockLease[];
	waiting: number;
}

export interface AcquireLockRequest {
	env: string;
	pid: number;
	runId?: string;
}

export interface EnvFileField {
	key: string;
	/** e.g. "sk-…3fk". Empty string when unset. */
	masked: string;
	isSet: boolean;
}

export interface EnvFileSummary {
	/** File name, e.g. ".env.dev" or ".env.publish". */
	file: string;
	fields: EnvFileField[];
}

export interface TestResultsSummary {
	status: "passed" | "failed" | "interrupted" | "unknown";
	failedTests: string[];
	/** Parsed from the Playwright json reporter when available. */
	tests?: Array<{ title: string; outcome: string; durationMs: number }>;
}

// ---------------------------------------------------------------------------
// Onboarding doctor (GET /api/doctor)
// ---------------------------------------------------------------------------

export interface DoctorCheck {
	id: string;
	label: string;
	ok: boolean;
	/** Failing required checks block new runs (409 onboarding_required). */
	required: boolean;
	/** True when the check has not been exercised yet (login before its explicit probe). */
	unknown?: boolean;
	hint: string;
	detail?: string;
}

export interface DoctorReport {
	checks: DoctorCheck[];
	requiredOk: boolean;
	ranAt: string;
}

// ---------------------------------------------------------------------------
// Server config
// ---------------------------------------------------------------------------

export interface DashboardConfig {
	port: number;
	/** Absolute path to the repo checkout the dashboard runs from. */
	repoRoot: string;
	/** Absolute path where per-ticket worktrees live (P2). */
	worktreesRoot: string;
	claudeBin: string;
	/** Max concurrent Playwright executions per env. */
	envCaps: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Integration status (read-only GET /api/status)
// ---------------------------------------------------------------------------

/** Read-only integration health report. Secret values are always masked. */
export interface StatusReport {
	claude: { bin: string; version: string | null; ok: boolean };
	envFiles: Array<{
		/** ".env.publish" and any other .env.* found (never the *.example files). */
		file: string;
		exists: boolean;
		/** masked = first 2 + "…" + last 2 chars for values >6 chars, else "•••"; never more. */
		keys: Array<{ key: string; masked: string }>;
	}>;
	/** Parsed best-effort from `claude mcp list`. */
	mcp: Array<{ name: string; transport: string; status: string }>;
	/** Human-readable advisories, e.g. token expiry or missing CLI. */
	notes: string[];
}

// ---------------------------------------------------------------------------
// Ticket tracker (GET /api/tickets) — read-only view over src/evidence/<TICKET>/
// ---------------------------------------------------------------------------

/** The env of one results-<env>.json in a ticket's evidence bundle. */
export type EvidenceEnv = string;

/** A result reduced to a verdict. */
export type CaseVerdict = "pass" | "fail" | "skipped" | "not-run" | "unknown";

/** Roll-up of one env column: none = no cell has a result. */
export type EnvVerdict = "pass" | "fail" | "partial" | "none";

export interface EnvTally {
	pass: number;
	fail: number;
	/** Cells with a result that is neither pass nor fail (skipped, not run, manual notes). */
	other: number;
	verdict: EnvVerdict;
}

export interface PipelineProgress {
	/** Furthest step with any telemetry line, as the command labels it ("4", "1b"). */
	step: string;
	status: StepStatus;
	complete: boolean;
	updatedAt?: string;
	/** The furthest step's note/reason, e.g. why it is blocked. */
	note?: string;
}

/** One COVERAGE.md row: | Ticket | Area | Specs | Environments | Notes | */
export interface CoverageEntry {
	ticket: string;
	area: string;
	specs: string;
	envs: string;
	notes: string;
}

export interface TicketSummary {
	key: string;
	/** "bug" when another ticket's findings or cases name this key as its bug. */
	kind: "ticket" | "bug";
	/** Tickets that raised this one as a bug (kind "bug" only). */
	raisedFrom?: string[];
	/** COVERAGE.md feature cell, else the first test group (markdown). */
	title?: string;
	envs: Partial<Record<EvidenceEnv, EnvTally>>;
	caseCount: number;
	findingCount: number;
	pipeline?: PipelineProgress;
	hasSummary: boolean;
	inCoverage: boolean;
	/** Newest mtime of the ticket's top-level evidence files (ISO). */
	updatedAt: string;
}

export interface CaseCell {
	result?: string;
	verdict: CaseVerdict;
	note?: string;
	media: string[];
}

export interface TicketCase {
	tc: string;
	case: string;
	by?: string;
	steps: string[];
	expectedResult?: string;
	layer?: string;
	note?: string;
	/** Bug key the case was raised under, when set. */
	ticket?: string;
	cells: Partial<Record<EvidenceEnv, CaseCell>>;
}

export interface TicketFinding {
	title: string;
	description?: string;
	replicate: string[];
	ticket?: string;
	media: string[];
}

export interface TicketStepLine {
	/** Step label as written ("4", "1b"). */
	step: string;
	status: StepStatus;
	ts?: string;
	note?: string;
}

export interface EvidenceFile {
	name: string;
	size: number;
	kind: "image" | "video" | "trace" | "json" | "doc" | "other";
}

export interface TicketDetail extends TicketSummary {
	intro?: string;
	cases: TicketCase[];
	findings: TicketFinding[];
	links: Array<{ label: string; url: string }>;
	coverage?: CoverageEntry;
	summaryMd?: string;
	/** Latest status per pipeline step, in step order. */
	steps: TicketStepLine[];
	files: EvidenceFile[];
}

// ---------------------------------------------------------------------------
// Test-results history (GET /api/history) — written by history-reporter.ts
// ---------------------------------------------------------------------------

/** Final outcome of one test across its retries. */
export type HistoryOutcome = "passed" | "failed" | "flaky" | "skipped";

export interface HistoryTest {
	/** Stable across runs: file + title path. */
	key: string;
	title: string;
	file: string;
	tags: string[];
	outcome: HistoryOutcome;
	/** Final attempt's Playwright status (passed / failed / timedOut / interrupted / skipped). */
	status: string;
	attempts: number;
	durationMs: number;
	error?: string;
	/** Screenshot copied next to the run file, relative to <historyDir>/<runId>/. */
	screenshot?: string;
}

export interface HistoryRun {
	version: 1;
	id: string;
	startedAt: string;
	durationMs: number;
	env: string;
	ticket?: string;
	/** CLI args after `playwright test` (files, -g, --project…). */
	args: string[];
	evidence: boolean;
	ci: boolean;
	/** Playwright's overall result status. */
	status: string;
	tests: HistoryTest[];
}

export interface HistoryCounts {
	passed: number;
	failed: number;
	flaky: number;
	skipped: number;
	total: number;
}

export type HistoryRunSummary = Omit<HistoryRun, "tests" | "version"> & { counts: HistoryCounts };

export interface HistoryTestStat {
	key: string;
	title: string;
	file: string;
	runs: number;
	failed: number;
	flaky: number;
	avgDurationMs: number;
	maxDurationMs: number;
	lastOutcome: HistoryOutcome;
	lastRunAt: string;
}

export interface HistoryFailure {
	runId: string;
	runAt: string;
	env: string;
	test: HistoryTest;
}

export interface HistoryOverview {
	/** Absolute history dir, so an empty page can say where it looked. */
	dir: string;
	runs: HistoryRunSummary[];
	/** Per env: the latest run's counts plus the pass rate over its last N runs. */
	envs: Array<{ env: string; lastRun: HistoryRunSummary; recentRuns: number; passRate: number }>;
	/** Tests that were flaky, or both passed and failed, within the window. */
	flaky: HistoryTestStat[];
	slowest: HistoryTestStat[];
	recentFailures: HistoryFailure[];
}

// ---------------------------------------------------------------------------
// Bugs board (GET /api/bugs) — bugs raised from findings / cases
// ---------------------------------------------------------------------------

export interface BugSummary {
	key: string;
	/** The finding's title (what broke), else the bug folder's title. */
	title?: string;
	raisedFrom: Array<{ ticket: string; tc?: string }>;
	description?: string;
	replicate: string[];
	/** Failure media as filed with the parent ticket (files in src/evidence/<ticket>/). */
	media: Array<{ ticket: string; name: string }>;
	/** src/evidence/<bug>/ exists — the bug has its own bundle (publish.mjs bug / retests). */
	hasFolder: boolean;
	/** Retest roll-up from the bug's own bundle: pass = fixed and re-verified. */
	retest?: EnvVerdict;
	updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Jira status (GET /api/jira/issues) — read-only, cached, optional
// ---------------------------------------------------------------------------

export interface JiraIssueInfo {
	key: string;
	summary: string;
	status: string;
	/** Jira's statusCategory key. */
	category: "new" | "indeterminate" | "done" | "unknown";
	assignee?: string;
	updated?: string;
}

export interface JiraStatusResponse {
	ok: boolean;
	/** Why statuses are missing (no credentials, Jira unreachable…). */
	error?: string;
	fetchedAt?: string;
	issues: Record<string, JiraIssueInfo>;
}

// ---------------------------------------------------------------------------
// Coverage map (GET /api/coverage) — the suite by feature folder
// ---------------------------------------------------------------------------

export interface SpecCoverage {
	/** Repo-relative, e.g. src/tests/checkout/cart-checkout.spec.ts */
	file: string;
	kind: "ui" | "api";
	tests: number;
	/** Ticket keys from @ABC-123 style tags. */
	tickets: string[];
	smoke: boolean;
	seed: boolean;
	/** Latest history run that included this file. */
	last?: { at: string; runId: string; env: string; counts: HistoryCounts };
}

export interface FeatureCoverage {
	app: string;
	/** Feature folder under the app; "(root)" for specs directly in the app dir. */
	feature: string;
	specs: SpecCoverage[];
	tests: number;
	tickets: string[];
	last?: SpecCoverage["last"];
}

export interface CoverageResponse {
	dir: string;
	features: FeatureCoverage[];
}

// ---------------------------------------------------------------------------
// Pipelines running outside the dashboard (GET /api/pipelines/external)
// ---------------------------------------------------------------------------

/** A ticket whose pipeline-status.ndjson moved recently, read from disk only. */
export interface ExternalPipeline {
	key: string;
	title?: string;
	progress: PipelineProgress;
}
