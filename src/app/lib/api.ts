import type { ProviderId } from "@/lib/connectors/types";
import { supabase } from "@/lib/supabase";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  /** The raw `detail` from the API. Usually a string, but some errors carry a
   *  structured body the UI acts on — see `termsRequiredFrom`. */
  detail: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/*
 * Auth-failure hook: installed by AuthProvider (signOut + redirect to /login).
 * Kept as a registered callback so this module stays React-free. Only 401s
 * carrying `WWW-Authenticate: Bearer` trigger it — the backend also returns
 * 401 for bad *connector* credentials (e.g. an invalid Make token on
 * POST /connections), and those must surface as normal form errors.
 */
let authFailureHandler: (() => void) | null = null;

export function setAuthFailureHandler(fn: (() => void) | null) {
  authFailureHandler = fn;
}

/* Active workspace (collaboration scope). Persisted so a reload keeps the
   same workspace; the API resolves the user's default when unset. */
const WORKSPACE_KEY = "orrit.workspace";

export function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(WORKSPACE_KEY);
}

export function setActiveWorkspaceId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(WORKSPACE_KEY, id);
  else window.localStorage.removeItem(WORKSPACE_KEY);
}

/* Support context (platform staff viewing a customer organization read-only).
   While set, every request names that organization and carries the support
   header; the API answers with role "support" and no permissions. */
const SUPPORT_KEY = "orrit.support";

export interface SupportContext {
  workspaceId: string;
  name: string;
}

export function getSupport(): SupportContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SUPPORT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SupportContext>;
    return v && typeof v.workspaceId === "string" ? { workspaceId: v.workspaceId, name: v.name ?? "" } : null;
  } catch {
    return null;
  }
}

/** Open the app as this organization, read-only. Full reload: every provider restarts in support mode. */
export function enterSupport(org: { id: string; name: string }) {
  window.localStorage.setItem(SUPPORT_KEY, JSON.stringify({ workspaceId: org.id, name: org.name }));
  clearApiCaches();
  window.location.assign("/dashboard");
}

export function exitSupport() {
  window.localStorage.removeItem(SUPPORT_KEY);
  clearApiCaches();
  window.location.assign("/admin");
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers(init?.headers);
  if (session) headers.set("Authorization", `Bearer ${session.access_token}`);
  const support = getSupport();
  if (support) {
    headers.set("X-Orrit-Workspace", support.workspaceId);
    headers.set("X-Orrit-Support", "1");
  } else {
    const workspaceId = getActiveWorkspaceId();
    if (workspaceId) headers.set("X-Orrit-Workspace", workspaceId);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    if (
      res.status === 401 &&
      res.headers.get("WWW-Authenticate")?.includes("Bearer")
    ) {
      authFailureHandler?.();
    }
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    const message =
      typeof body.detail === "string"
        ? body.detail
        : body.detail?.message || `API error ${res.status}`;
    throw new ApiError(message, res.status, body.detail);
  }
  // Tolerate empty bodies (e.g. 204 from DELETE)
  return res.json().catch(() => undefined as T);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Reference to a stored connection. */
export interface ConnRef {
  id: string;
  externalId: string;
}

/* Node/edge ids: Make modules use numbers, GHL steps use UUID strings, and
   the unified graph namespaces both ("make:912:5", "ghl:<wf>:<step>"). */
export type NodeId = string | number;

export interface Scenario {
  id: number;
  name: string;
  isActive: boolean;
  isPaused: boolean;
  lastEdit: string | null;
  nextExec: string | null;
  usedPackages: string[];
  folderId: number | null;
}

export interface Folder {
  id: number;
  name: string;
  scenarios: Scenario[];
}

export interface Team {
  id: number;
  name: string;
  folders: Folder[];
  unfolderedScenarios: Scenario[];
}

export interface Hierarchy {
  organizationId: number;
  teams: Team[];
}

/** Wait/sleep duration as the API computed it (null when not a wait). */
export interface WaitFor {
  seconds: number | null;
  text: string;
}

/** One runtime execution (Make) — status, timing and which steps ran; run
 *  data (inputs, bundles) is fetched on demand at drill-in and never stored. */
export interface Execution {
  executionId: string;
  status: "success" | "warning" | "error" | "incomplete" | "unknown";
  startedAt: string | null;
  durationMs: number | null;
  operations: number | null;
  errorName: string | null;
  errorMessage: string | null;
  causeModuleId: string | null;
  /** The failing module as the platform names it (Make sends no id) —
   *  `causeModuleId` is resolved from it through module logs, or a unique
   *  name match; `causeSource` says which, null when unresolved. */
  causeModule?: { name: string | null; appName: string | null } | null;
  causeSource?: "module_logs" | "name_match" | null;
  meta: Record<string, unknown>;
}

/** What the provider's runtime exposes — declared by the API, never assumed
 *  from the provider id. `payload` says where run data can be read from:
 *  the entry node only (webhook request / failing bundle) or nowhere. */
export interface RuntimeCapabilities {
  trace: boolean;
  /** The trigger request / DLQ bundle of a single node. */
  payload: "entry-only" | "none";
  identifiers: boolean;
  /** Every module's real input and output for one run — a separate capability
   *  from `payload`, and a provider may have one without the other. */
  bundles?: boolean;
  simulate?: boolean;
}

export interface ExecutionsResponse {
  supported: boolean;
  reason?: string;
  executions: Execution[];
  fetchedAt: string | null;
  refreshing?: boolean;
  runtime?: RuntimeCapabilities;
  /** The page filled: retention holds more runs than this response carries.
   *  Depth belongs to `GET /runs`, which is keyset-paged for it. */
  hasMore?: boolean;
}

export function fetchExecutions(
  provider: ProviderId,
  externalId: string,
  refresh = false
): Promise<ExecutionsResponse> {
  return apiFetch<ExecutionsResponse>(
    `/workflows/${provider}/${encodeURIComponent(externalId)}/executions${refresh ? "?refresh=true" : ""}`
  );
}

export interface LastRun {
  status: Execution["status"];
  at: string | null;
  executionId?: string;
}

/* ─── Run trace · run data · records (monitoring) ────────────────────────── */

/** Per-node state of one execution as the API reports it. `touched` may
 *  arrive with a `status` of `error` / `warning` instead of the collapsed
 *  `failed` / `warning`; the map overlay (`lib/workflowMap/run.ts`)
 *  normalises both shapes. `unknown` = Orrit could not check that module
 *  (coverage cut-off / rate limit), never "did not run". */
export type RunNodeState = "touched" | "warning" | "failed" | "untouched" | "unknown";

export interface TraceNode {
  nodeId: string;
  state: RunNodeState;
  status: "success" | "warning" | "error" | null;
  /** Bundle count the module reported (Make); null when not exposed. */
  bundles: number | null;
  warning: string | null;
  error: string | null;
}

/** Another execution that carried the same record (hashed identifier)
 *  within a short window of this one. */
export interface RelatedRun {
  provider: ProviderId;
  workflowExternalId: string;
  workflowName: string | null;
  executionId: string;
  startedAt: string | null;
  status: Execution["status"];
  via: string | null;
}

export interface ExecutionTrace {
  supported: boolean;
  reason?: string;
  execution: Execution | null;
  /** Every module of the stored blueprint, each with a state. */
  nodes: TraceNode[];
  /** Some modules could not be checked (`unknown`) — the picture is incomplete. */
  partial: boolean;
  coverage: { checked: number; total: number; fetchedAt: string | null } | null;
  /** The node whose input the platform can hand back (webhook request or
   *  failing bundle), if any. */
  entry: {
    nodeId: string | null;
    kind: string | null;
    payloadAvailable: boolean;
    source: "hook_log" | "dlq_bundle" | null;
  } | null;
  related: RelatedRun[];
  links: { history: string | null; execution: string | null; editor: string | null };
  notes: string[];
  /** Live run name from the platform (never stored), when it has one. */
  runName?: string | null;
  /** The workflow was edited after this run — steps may have changed. */
  blueprintChangedSince?: boolean;
  removed?: { moduleId: string; status: string | null }[];
  refreshing?: boolean;
  rateLimited?: boolean;
  /** Seconds until the platform accepts reads again, when rate-limited. */
  retryAfter?: number | null;
}

/** Fetched through from the platform at drill-in and shown once — the API
 *  answers with `Cache-Control: no-store` and never persists it. */
export interface ExecutionPayload {
  supported: boolean;
  available: boolean;
  reason?: string;
  source?: "hook_log" | "dlq_bundle" | null;
  capturedAt?: string | null;
  request?: {
    method: string | null;
    /** Masked label, never the raw hook URL. */
    url: string | null;
    query: Record<string, unknown> | null;
    /** Sensitive headers arrive as "<redacted>". */
    headers: Record<string, unknown> | null;
    body: unknown;
  } | null;
  /** DLQ bundle of an incomplete run (untyped). */
  bundle?: unknown;
  bytes?: number | null;
  truncated?: boolean;
  note?: string | null;
  rateLimited?: boolean;
  retryAfter?: number | null;
}

/** Where a value came from — the four classes of truth. Colour is spoken for
 *  (status and app identity), so the register rides on the stroke style of a
 *  left rule plus a mono tag; see `components/projection/Provenance.tsx`.
 *  `resolved`/`constant` are Orrit's own arithmetic, `opaque` has known
 *  provenance but no computed value, `unresolved` names the step it needs. */
export type FieldProvenance =
  | "observed"
  | "supplied"
  | "resolved"
  | "constant"
  | "opaque"
  | "unresolved";

/** One run of one module. A module can legitimately run many times (iterators,
 *  fan-out), so the panel offers an operation picker rather than the first. */
export interface BundleOperation {
  cycle: number | null;
  operation: number | null;
  input: unknown;
  output: unknown;
  error: boolean;
  /** Make's own flag, kept distinct from Orrit's cap (`cappedBy`). */
  truncated: boolean;
  /** Set when Orrit dropped the value to stay inside its own ceiling. */
  cappedBy?: "orrit";
  /** The value would not parse as JSON and is shown as the platform sent it. */
  unparsed?: boolean;
}

export interface BundleFrame {
  operations: BundleOperation[];
  /** False for a module the run had but the current blueprint no longer does. */
  inBlueprint: boolean;
}

/** What every step of one run received and returned — fetched through at
 *  drill-in, never stored. `available: false` always carries a reason: past
 *  retention, nothing recorded, or a platform that exposes none. */
export interface ExecutionBundles {
  supported: boolean;
  available: boolean;
  frames: Record<string, BundleFrame>;
  events: { nodeId: string; kind: string; at: string | null }[];
  runBlueprint?: { id: number; name: string }[] | null;
  bytes?: number;
  truncated?: boolean;
  cappedNodes?: string[];
  note?: string | null;
  reason?: string | null;
  rateLimited?: boolean;
  retryAfter?: number | null;
}

/** One field of the derived input contract. `inGate` is what makes a field
 *  interesting — only a gated field can change the path — so the form sorts
 *  those first and shows the thresholds found in the blueprint. */
export interface ContractField {
  path: string;
  usedBy: string[];
  inGate: boolean;
  required: boolean;
  inferredType: "string" | "number" | "email" | "phone" | "date" | "boolean" | "list";
  operators: string[];
  comparedTo: string[];
  /** Proved to exist by a real trigger payload rather than inferred. */
  observed: boolean;
}

export interface InputContract {
  supported: boolean;
  reason?: string;
  fields: ContractField[];
  /** GHL reads a contact record, not a request body. */
  shape?: "contact";
}

export interface ProjectedField {
  key: string;
  state: FieldProvenance;
  value?: unknown;
  blockedBy?: string;
  usedBy?: string[];
}

/** How one node's projected path compares to the run that actually happened.
 *  `now-unevaluable` is deliberately not a divergence: a gate Orrit cannot
 *  evaluate is a gap, and reporting it as a change would cry wolf on every
 *  workflow containing an external call. */
export type DiffOutcome =
  | "same"
  | "newly-reached"
  | "no-longer-reached"
  | "now-unevaluable"
  | "new"
  | "gone";

/** The sentence at the top of a diff, grouped by cause rather than by step. */
export interface ProjectionVerdict {
  headline: string;
  detail: string | null;
  changed: string[];
  unevaluable: number;
}

export interface ProjectedGate {
  evaluated: boolean | null;
  label: string | null;
  reason: string | null;
  operands: { operator: string; left: unknown; right: unknown; verdict: boolean | null; field?: string }[];
  blockedBy?: string;
}

/** A projection is structurally an ExecutionTrace, so the run overlay renders
 *  it unchanged; `projection` is the only signal the UI needs to switch
 *  register. Nothing here is stored — a reload discards it. */
export interface Projection {
  supported: boolean;
  reason?: string;
  nodes: {
    nodeId: string;
    state: "touched" | "untouched" | "unknown" | null;
    gate: ProjectedGate | null;
    /** Present only for a projection against a recorded run. */
    outcome?: DiffOutcome;
  }[];
  /** Present only for a diff; null for a plain projection. */
  verdict?: ProjectionVerdict | null;
  fields: Record<string, ProjectedField[]>;
  frames: Record<string, { source: "observed" | "supplied" | "computed"; operations: BundleOperation[] }>;
  partial: boolean;
  notes: string[];
  projection: {
    source: "recorded" | "typed";
    /** Always null: a projection is not a run and never joins a record timeline. */
    inputHash: null;
    overrides: string[];
    runBlueprintAt: string | null;
    unresolvedCount: number;
    visitCap: number;
  };
}

export type RecordKind = "email" | "phone" | "contact_id" | "id";

export interface RecordRun {
  provider: ProviderId;
  connectionId: string;
  connectionLabel: string | null;
  workflowExternalId: string;
  workflowName: string | null;
  executionId: string;
  status: Execution["status"];
  startedAt: string | null;
  kind: RecordKind;
  /** Where the identifier was read from: the webhook payload or the run name. */
  source: "hook_log" | "run_name" | "run_name_live" | string;
}

export interface RecordRuns {
  query?: string;
  kinds: RecordKind[];
  supported: boolean;
  reason?: string;
  runs: RecordRun[];
  coverage: {
    scenarios: number;
    indexedTo: string | null;
    retentionDays: number;
    makeRetentionDays?: number | null;
  } | null;
  live?: { searched: number; skipped: number; rateLimited: boolean } | null;
  recommendations?: { provider: ProviderId; workflowExternalId: string; workflowName: string | null; code: string }[];
  refreshing?: boolean;
  rateLimited?: boolean;
  retryAfter?: number | null;
}

export function fetchExecutionTrace(
  provider: ProviderId,
  externalId: string,
  executionId: string,
  refresh = false
): Promise<ExecutionTrace> {
  return apiFetch<ExecutionTrace>(
    `/workflows/${provider}/${encodeURIComponent(externalId)}/executions/${encodeURIComponent(executionId)}/trace${refresh ? "?refresh=true" : ""}`
  );
}

export function fetchExecutionPayload(
  provider: ProviderId,
  externalId: string,
  executionId: string,
  node?: string
): Promise<ExecutionPayload> {
  const qs = node != null ? `?node=${encodeURIComponent(node)}` : "";
  return apiFetch<ExecutionPayload>(
    `/workflows/${provider}/${encodeURIComponent(externalId)}/executions/${encodeURIComponent(executionId)}/payload${qs}`
  );
}

/** Every step's real input and output for one run. One call per run — it also
 *  carries the per-module events trace. Never cached: a second look re-fetches,
 *  which is what "fetched through, never stored" means in practice. */
export function fetchBundles(
  provider: ProviderId,
  externalId: string,
  executionId: string
): Promise<ExecutionBundles> {
  return apiFetch<ExecutionBundles>(
    `/workflows/${provider}/${encodeURIComponent(externalId)}/executions/${encodeURIComponent(executionId)}/bundles`
  );
}

/** What this workflow expects as input, derived from its own blueprint. */
export function fetchInputContract(provider: ProviderId, externalId: string): Promise<InputContract> {
  return apiFetch<InputContract>(
    `/workflows/${provider}/${encodeURIComponent(externalId)}/input-contract`
  );
}

/** Where an input would go. A POST because the input is a body — nothing is
 *  written, and nothing is sent to the platform unless `runId` asks for a
 *  recorded run's real values as the starting point. */
export function projectWorkflow(
  provider: ProviderId,
  externalId: string,
  body: { runId?: string; input?: Record<string, unknown>; overrides?: Record<string, unknown> }
): Promise<Projection> {
  return apiPost<Projection>(
    `/workflows/${provider}/${encodeURIComponent(externalId)}/project`,
    body
  );
}

/** Exact-match search over hashed identifiers; the identifier itself only
 *  ever travels as a query parameter to the API, never in a path. */
export function searchRecords(q: string, refresh = false): Promise<RecordRuns> {
  const qs = new URLSearchParams({ q });
  if (refresh) qs.set("refresh", "true");
  return apiFetch<RecordRuns>(`/records/search?${qs.toString()}`);
}

export function fetchRecordRuns(kind: string, hash: string): Promise<RecordRuns> {
  return apiFetch<RecordRuns>(`/records/${encodeURIComponent(kind)}/${encodeURIComponent(hash)}/runs`);
}

/* ─── Run explorer (triage) ──────────────────────────────────────────────── */

/*
 * Every stored execution across every connection, queryable: status,
 * workflow, time window, or the record that went through it. Read-only —
 * these endpoints only report what already ran.
 */

export type RunWindow = "1h" | "24h" | "7d" | "30d";
export type RunStatus = Execution["status"];

/** One execution as the explorer lists it: the run plus the workflow and
 *  connection it belongs to, so a row stands on its own. */
export interface RunRow {
  provider: ProviderId;
  connectionId: string;
  connectionLabel: string;
  workflowExternalId: string;
  workflowName: string | null;
  executionId: string;
  status: RunStatus;
  startedAt: string | null;
  durationMs: number | null;
  operations: number | null;
  errorName: string | null;
  errorMessage: string | null;
  causeModuleId: string | null;
  nativeUrl: string | null;
}

/** How far back the index actually reaches — all fields optional, the page
 *  renders only what the API sends. */
export interface RunCoverage {
  scenarios?: number;
  indexedTo?: string | null;
  retentionDays?: number;
  makeRetentionDays?: number | null;
}

export interface RunsPage {
  runs: RunRow[];
  nextCursor: string | null;
  coverage?: RunCoverage | null;
  /** Set when `q` was read as a record identifier rather than free text. */
  record?: { kind: RecordKind } | null;
}

export interface RunsQuery {
  status?: RunStatus | null;
  provider?: ProviderId | null;
  workflow?: string | null;
  q?: string | null;
  /** `all` drops the lower bound — one workflow's whole retained log. */
  window?: RunWindow | "all";
  limit?: number;
  cursor?: string | null;
}

/** The most rows `/runs` will answer in one page. */
export const RUNS_MAX_LIMIT = 200;

/** The identifier (`q`) only ever travels as a query parameter, never a path. */
export function fetchRuns(query: RunsQuery = {}): Promise<RunsPage> {
  const qs = new URLSearchParams();
  if (query.status) qs.set("status", query.status);
  if (query.provider) qs.set("provider", query.provider);
  if (query.workflow) qs.set("workflow", query.workflow);
  if (query.q) qs.set("q", query.q);
  if (query.window) qs.set("window", query.window);
  if (query.limit) qs.set("limit", String(query.limit));
  if (query.cursor) qs.set("cursor", query.cursor);
  const s = qs.toString();
  return apiFetch<RunsPage>(`/runs${s ? `?${s}` : ""}`);
}

export interface RunStats {
  window: RunWindow;
  total: number;
  byStatus: Record<RunStatus, number>;
  successRate: number | null;
  medianDurationMs: number | null;
  /** Runs per time bucket, oldest first — the sparkline. */
  buckets: { at: string; total: number; failed: number }[];
  workflows: { provider: ProviderId; workflowExternalId: string; workflowName: string | null; total: number; failed: number }[];
}

export function fetchRunStats(window: RunWindow): Promise<RunStats> {
  return apiFetch<RunStats>(`/runs/stats?window=${encodeURIComponent(window)}`);
}

/*
 * One step of a run: a stored module row, named from the sync-time node
 * index. A module the index does not know still appears — `name` is null and
 * the node id stands in, because unnamed beats missing when the question is
 * "what did this run touch". `size` is bytes.
 */
export interface RunDetailStep {
  nodeId: string | null;
  name: string | null;
  app: string | null;
  kind: string | null;
  ordinal: string | null;
  status: string | null;
  bundles: number | null;
  size: number | null;
  warningMessage: string | null;
  errorMessage: string | null;
  fetchedAt: string | null;
}

/** What a run carried — kinds and provenance only. The hash column is never
 *  read server-side, so no record value can arrive here in any form. */
export interface RunIdentifier {
  kind: RecordKind;
  source: string;
  hookId?: string | null;
  hookLogId?: string | null;
}

/** Per-module coverage watermarks: how far back the index has checked. */
export interface RunModuleCoverage {
  moduleId: string | null;
  coveredFrom: string | null;
  fetchedAt: string | null;
}

/*
 * The stored execution row, camelCased. The server builds it from the row's
 * own keys, so a column added to the table later arrives here without an API
 * change — hence the index signature, and why the UI iterates the extras
 * rather than hard-coding a key list. `meta` is the full `raw_minimal`.
 */
export interface RunDetailRun {
  executionId: string;
  status: RunStatus;
  startedAt: string | null;
  durationMs: number | null;
  operations: number | null;
  errorName: string | null;
  errorMessage: string | null;
  causeModuleId: string | null;
  fetchedAt: string | null;
  /** Lifted out of `meta`: the failing module as the platform names it. */
  causeModule: { name: string | null; appName: string | null } | null;
  causeSource: string | null;
  /** The platform's own id for the run, lifted out of `meta`. */
  runId: string | null;
  meta: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** Whether the run's data can be fetched, and from where. Decided from
 *  stored evidence — this route never calls a platform. `reason` comes from
 *  the runtime itself, so it is rendered verbatim. */
export interface RunPayloadState {
  available: boolean;
  reason: string | null;
  source: "hook_log" | "dlq_bundle" | null;
  node: string | null;
}

/*
 * Everything Orrit stored about one run: every column of the execution row,
 * every module row, the coverage watermarks, what it carried, deep links,
 * and `raw` — the rows verbatim, so the panel is never a summary of a
 * summary. Provider-agnostic: any platform whose runtime lands answers here.
 */
export interface RunDetail {
  provider: ProviderId;
  connectionId: string;
  connectionLabel: string | null;
  workflowExternalId: string;
  workflowName: string | null;
  /** The workflow's editor link; `links.execution` is the run's own log. */
  nativeUrl: string | null;
  run: RunDetailRun;
  steps: RunDetailStep[];
  coverage: RunModuleCoverage[];
  identifiers: RunIdentifier[];
  raw: { execution: unknown; modules: unknown[]; coverage: unknown[] };
  links: { history: string | null; execution: string | null; editor: string | null };
  payload: RunPayloadState;
}

export function fetchRunDetail(provider: ProviderId, workflowExternalId: string, executionId: string): Promise<RunDetail> {
  return apiFetch<RunDetail>(`/runs/${provider}/${encodeURIComponent(workflowExternalId)}/${encodeURIComponent(executionId)}`);
}

/* ─── Change log ─────────────────────────────────────────────────────────── */

export type ChangeKind =
  | "node-added" | "node-removed" | "node-changed" | "node-reordered"
  | "edge-added" | "edge-removed" | "ref-added" | "ref-removed"
  | "renamed" | "status-changed";

export interface WorkflowChange {
  id: number;
  provider: ProviderId | null;
  connectionId: string;
  workflowExternalId: string;
  workflowName?: string | null;
  version: number;
  kind: ChangeKind;
  nodeId: string | null;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  authorHint: { name?: string | null; at?: string | null; source?: string } | null;
  detectedAt: string;
  unseen?: boolean;
}

export interface WorkflowChanges {
  changes: WorkflowChange[];
  versions: { version: number; syncedAt: string | null; authorHint: WorkflowChange["authorHint"]; acks?: { userId: string; name: string; ackedAt: string }[] }[];
  lastSeenAt: string | null;
  unseen: number;
}

export function fetchWorkflowChanges(provider: ProviderId, externalId: string, since?: string): Promise<WorkflowChanges> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  return apiFetch<WorkflowChanges>(`/workflows/${provider}/${encodeURIComponent(externalId)}/changes${qs}`);
}

export function markWorkflowSeen(provider: ProviderId, externalId: string): Promise<{ seenAt: string }> {
  return apiPost(`/workflows/${provider}/${encodeURIComponent(externalId)}/seen`);
}

export function fetchRecentChanges(days = 7): Promise<{ since: string; changes: WorkflowChange[] }> {
  return apiFetch(`/changes?days=${days}`);
}

/* ─── Comments ───────────────────────────────────────────────────────────── */

export type CommentTargetType = "workflow" | "node" | "issue" | "asset" | "change";

export interface Comment {
  id: string;
  targetType: CommentTargetType;
  targetKey: string;
  parentId: string | null;
  authorId: string;
  authorName: string | null;
  body: string;
  mentions: string[];
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  editedAt: string | null;
}

export interface CommentCounts {
  [targetKey: string]: { total: number; open: number };
}

export function fetchComments(q: { target?: string; prefix?: string }): Promise<{ comments: Comment[]; counts: CommentCounts }> {
  const qs = new URLSearchParams();
  if (q.target) qs.set("target", q.target);
  if (q.prefix) qs.set("prefix", q.prefix);
  return apiFetch(`/comments?${qs.toString()}`);
}

/** Open comment threads that @mention the signed-in user (for the rail badge + /mentions). */
export function fetchMentions(): Promise<{ comments: Comment[]; counts: CommentCounts }> {
  return apiFetch("/comments?mentionsMe=1&open=1");
}
export function fetchMentionCount(): Promise<number> {
  return fetchMentions().then((d) => d.comments.length);
}

export function createComment(input: { targetType: CommentTargetType; targetKey: string; body: string; parentId?: string | null }): Promise<Comment> {
  return apiPost<Comment>(`/comments`, input);
}

export function patchComment(id: string, patch: { body?: string; resolved?: boolean }): Promise<Comment> {
  return apiFetch<Comment>(`/comments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function deleteComment(id: string): Promise<{ deleted: string }> {
  return apiFetch(`/comments/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ─── Owners / notes / watch / ack ───────────────────────────────────────── */

export interface WorkflowMeta {
  ownerUserId: string | null;
  ownerName: string | null;
  notes: string | null;
  updatedAt: string | null;
  watching?: boolean;
}

export function fetchWorkflowMeta(provider: ProviderId, externalId: string): Promise<WorkflowMeta> {
  return apiFetch(`/workflows/${provider}/${encodeURIComponent(externalId)}/meta`);
}

export function putWorkflowMeta(
  provider: ProviderId,
  externalId: string,
  patch: { ownerUserId?: string | null; notes?: string; clearOwner?: boolean }
): Promise<WorkflowMeta> {
  return apiFetch(`/workflows/${provider}/${encodeURIComponent(externalId)}/meta`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function setWatch(targetKey: string, watching: boolean): Promise<{ targetKey: string; watching: boolean }> {
  return apiFetch(`/watches`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetKey, watching }) });
}

export function ackVersion(provider: ProviderId, externalId: string, version: number): Promise<{ version: number }> {
  return apiPost(`/workflows/${provider}/${encodeURIComponent(externalId)}/versions/${version}/ack`);
}

/* ─── Activity / notifications ───────────────────────────────────────────── */

export interface ActivityItem {
  id: number;
  kind: string;
  targetKey: string | null;
  payload: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface NotificationItem {
  id: number;
  readAt: string | null;
  createdAt: string;
  activity: ActivityItem;
}

export function fetchActivity(q: { since?: string; kinds?: string[]; target?: string; mine?: boolean; watched?: boolean; limit?: number } = {}): Promise<{ activity: ActivityItem[] }> {
  const qs = new URLSearchParams();
  if (q.since) qs.set("since", q.since);
  if (q.kinds?.length) qs.set("kinds", q.kinds.join(","));
  if (q.target) qs.set("target", q.target);
  if (q.mine) qs.set("mine", "true");
  if (q.watched) qs.set("watched", "true");
  if (q.limit) qs.set("limit", String(q.limit));
  return apiFetch(`/activity?${qs.toString()}`);
}

export function fetchNotifications(unread = false): Promise<{ unread: number; notifications: NotificationItem[] }> {
  return apiFetch(`/notifications${unread ? "?unread=true" : ""}`);
}

export function markNotificationsRead(ids?: number[]): Promise<{ unread: number }> {
  return apiPost(`/notifications/read`, ids ? { ids } : { all: true });
}

/* ─── Saved views ────────────────────────────────────────────────────────── */

export interface SavedView {
  id: string;
  name: string;
  kind: "dashboard" | "unified";
  filters: Record<string, unknown>;
  created_by: string | null;
  shared: boolean;
}

export function fetchViews(): Promise<{ views: SavedView[] }> {
  return apiFetch(`/views`);
}

export function createView(input: { name: string; kind: SavedView["kind"]; filters: Record<string, unknown>; shared?: boolean }): Promise<SavedView> {
  return apiPost<SavedView>(`/views`, input);
}

export function deleteView(id: string): Promise<{ deleted: string }> {
  return apiFetch(`/views/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ─── Organizations (API paths say /workspaces) ─────────────────────────── */

/** The three roles. Exactly one owner per organization; owner is transferred, never set. */
export type Role = "owner" | "admin" | "member";
export type WorkspaceRole = Role;

export type OrganizationStatus = "active" | "suspended";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: Role;
  status?: OrganizationStatus;
  created_by?: string | null;
  created_at?: string | null;
  joined_at?: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: Role;
  display_name: string | null;
  email: string | null;
  joined_at: string;
  /** Last sign-in, when the API could read it. */
  lastActiveAt?: string | null;
  permissions?: string[];
  permissions_source?: "role" | "custom";
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface WorkspaceInvite {
  id: string;
  workspace_id: string;
  email: string;
  role: Role;
  invited_by?: string | null;
  invited_at?: string | null;
  status?: InviteStatus;
  expiresAt?: string | null;
  lastSentAt?: string | null;
  sendCount?: number;
  /** Set when the email could not be handed off; the invite still works on sign-in. */
  sendError?: string | null;
}

/** GET /workspaces/current — the active organization plus the caller's standing in it. */
export interface CurrentWorkspace {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  createdAt: string | null;
  /** "support" = platform staff viewing read-only. */
  role: Role | "support";
  permissions: string[];
  access: string;
  isPlatformAdmin: boolean;
}

export function fetchWorkspaces(): Promise<{ current: string; workspaces: Workspace[] }> {
  return apiFetch(`/workspaces`);
}

export async function fetchCurrentWorkspace(): Promise<CurrentWorkspace> {
  const raw = await apiFetch<Record<string, unknown>>(`/workspaces/current`);
  // The organization row is spread into the response; tolerate a nested one too.
  const org = ((raw.organization as Record<string, unknown> | undefined) ?? raw) as Record<string, unknown>;
  return {
    id: String(org.id ?? ""),
    name: String(org.name ?? ""),
    slug: String(org.slug ?? ""),
    status: (org.status as OrganizationStatus) || "active",
    createdAt: (org.createdAt as string | undefined) ?? (org.created_at as string | undefined) ?? null,
    role: (raw.role as CurrentWorkspace["role"]) || "member",
    permissions: (raw.permissions as string[]) ?? [],
    access: (raw.access as string) ?? "member",
    isPlatformAdmin: raw.isPlatformAdmin === true,
  };
}

export function createWorkspace(name: string): Promise<Workspace> {
  return apiPost<Workspace>(`/workspaces`, { name });
}

function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function renameWorkspace(id: string, name: string): Promise<Workspace> {
  return apiPatch(`/workspaces/${encodeURIComponent(id)}`, { name });
}

export function fetchMembers(id: string): Promise<{ members: WorkspaceMember[]; invites: WorkspaceInvite[] }> {
  return apiFetch(`/workspaces/${encodeURIComponent(id)}/members`);
}

export function updateMemberRole(id: string, userId: string, role: "admin" | "member"): Promise<WorkspaceMember> {
  return apiPatch(`/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { role });
}

/** The target becomes owner; every previous owner becomes an admin. */
export function transferOwnership(
  id: string,
  userId: string
): Promise<{ workspace_id: string; owner: string; previousOwners: string[]; yourRole: "admin" | null }> {
  return apiPost(`/workspaces/${encodeURIComponent(id)}/transfer-ownership`, { userId });
}

export function removeMember(id: string, userId: string): Promise<{ removed: string }> {
  return apiFetch(`/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export function inviteMember(id: string, email: string, role: Role = "member"): Promise<WorkspaceInvite> {
  return apiPost<WorkspaceInvite>(`/workspaces/${encodeURIComponent(id)}/invites`, { email, role });
}

export function resendInvite(id: string, inviteId: string): Promise<WorkspaceInvite> {
  return apiPost(`/workspaces/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}/resend`);
}

export function revokeInvite(id: string, inviteId: string): Promise<{ revoked: string }> {
  return apiFetch(`/workspaces/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

/** Display name in every organization, and Supabase `user_metadata.full_name`. */
export function updateMe(
  displayName: string
): Promise<{ workspace_id: string; user_id: string; memberships: number; display_name: string | null }> {
  return apiPatch(`/me`, { displayName });
}

/* ─── Invites addressed to me / the public invite link ──────────────────── */

/** What an invite link may show before anyone signs in. */
export interface PublicInvite {
  id: string;
  organizationName: string | null;
  inviterName: string | null;
  role: Role;
  emailMasked: string;
  expiresAt: string | null;
  status: InviteStatus;
  source?: "org" | "platform";
  /** Token lookup only: whether the invited address already has an account; null when unknown. */
  accountExists?: boolean | null;
}

export interface AcceptedInvite {
  workspaceId: string;
  role: Role;
  organizationName: string | null;
}

export function fetchMyInvites(): Promise<{ invites: PublicInvite[] }> {
  return apiFetch(`/me/invites`);
}

export function acceptMyInvite(inviteId: string): Promise<AcceptedInvite> {
  return apiPost(`/me/invites/${encodeURIComponent(inviteId)}/accept`);
}

/** Unauthenticated lookup — 404 unknown, 410 used / revoked / expired (code `invite_{status}`). */
export function fetchInviteByToken(token: string): Promise<PublicInvite> {
  return apiFetch(`/invites/${encodeURIComponent(token)}`);
}

/**
 * Creates a confirmed account for the invited address and returns that
 * address to sign in with. 409 `account_exists` → sign in instead;
 * 422 `weak_password`. Does not accept the invite.
 */
export function createInviteAccount(
  token: string,
  body: { password: string; displayName?: string },
): Promise<{ email: string }> {
  return apiPost(`/invites/${encodeURIComponent(token)}/account`, body);
}

/** Bearer; 403 `invite_email_mismatch` when the signed-in address differs. */
export function acceptInviteByToken(token: string): Promise<AcceptedInvite> {
  return apiPost(`/invites/${encodeURIComponent(token)}/accept`);
}

/** The `code` of a structured API error, if any. */
export function errorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const d = error.detail as { code?: string } | undefined;
  return typeof d?.code === "string" ? d.code : null;
}

/* ─── Admin portal (platform staff; everyone else gets 404) ─────────────── */

export type AdminOrgStatus = "active" | "suspended" | "incident";
export type Health = "ok" | "warn" | "err";

export interface AdminStats {
  organizations: number;
  seats: number;
  connections: number;
  openIncidents: number;
}

export interface AdminOrgRow {
  id: string;
  name: string;
  slug?: string;
  status: AdminOrgStatus;
  createdAt: string | null;
  memberCount: number;
  connectionCount: number;
  workflowCount?: number;
  runs30d?: number;
  platforms?: string[];
  health?: Health;
  ownerEmail?: string | null;
  owners?: { userId: string; name: string | null }[];
  lastSyncAt: string | null;
  lastActivityAt?: string | null;
  suspendedAt?: string | null;
  suspensionReason?: string | null;
}

export interface AdminOrgConnection {
  id: string;
  provider: string;
  label: string | null;
  status: string | null;
  health?: Health;
  lastSyncAt?: string | null;
  lastSyncedAt?: string | null;
  lastSyncOutcome?: "ok" | "partial" | "failed" | null;
}

export interface AdminOrgDetail {
  organization: {
    id: string;
    name: string;
    slug?: string;
    status?: AdminOrgStatus;
    created_at?: string | null;
    createdAt?: string | null;
    suspended_at?: string | null;
    suspension_reason?: string | null;
  };
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  connections: AdminOrgConnection[];
  audit: { action: string; authMethod: string | null; userId: string | null; detail: Record<string, unknown>; at: string }[];
}

export function fetchAdminStats(): Promise<AdminStats> {
  return apiFetch(`/admin/stats`);
}

export function fetchAdminOrganizations(q?: string, status?: AdminOrgStatus): Promise<{ organizations: AdminOrgRow[] }> {
  const qs = new URLSearchParams({ limit: "500" });
  if (q) qs.set("q", q);
  if (status) qs.set("status", status);
  return apiFetch(`/admin/organizations?${qs.toString()}`);
}

export function fetchAdminOrganization(id: string): Promise<AdminOrgDetail> {
  return apiFetch(`/admin/organizations/${encodeURIComponent(id)}`);
}

export function suspendOrganization(id: string, reason?: string): Promise<unknown> {
  return apiPost(`/admin/organizations/${encodeURIComponent(id)}/suspend`, { reason: reason ?? null });
}

export function unsuspendOrganization(id: string): Promise<unknown> {
  return apiPost(`/admin/organizations/${encodeURIComponent(id)}/unsuspend`);
}

/** Manual tag (per workspace). */
export interface Tag {
  id: string;
  name: string;
  color: string | null;
  source?: "manual" | "auto";
  workflows?: number;
}

export function fetchTags(): Promise<Tag[]> {
  return apiFetch<Tag[]>(`/tags`);
}

export function createTag(name: string, color?: string | null): Promise<Tag> {
  return apiPost<Tag>(`/tags`, { name, color: color ?? null });
}

export function deleteTag(id: string): Promise<{ deleted: string }> {
  return apiFetch(`/tags/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function setWorkflowTags(
  provider: ProviderId,
  externalId: string,
  tagIds: string[]
): Promise<{ tags: Tag[] }> {
  return apiFetch(`/workflows/${provider}/${encodeURIComponent(externalId)}/tags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tagIds }),
  });
}

/** Structural issue from the link map (see pipeline/errors.md). */
export interface Issue {
  code: string;
  severity: "error" | "warn" | "info";
  provider: ProviderId;
  workflowExternalId: string | null;
  nodeId: string | null;
  message: string;
  data: Record<string, unknown>;
}

export interface IssueCounts {
  error: number;
  warn: number;
  info: number;
}

export interface ModuleInfo {
  id: NodeId;
  module: string;
  app: string;
  label: string;
  /** Humanized "what it does" (API-generated; names only, never ids/URLs). */
  summary?: string;
  /** Execution-order label ("1", "2.1.3", "4.A.2"); null for triggers/orphans. */
  ordinal?: string | null;
  waitFor?: WaitFor | null;
  /** Structural issues on this node (summary responses). */
  issues?: Issue[];
  /** Client-side: changed since the viewer last looked (amber ring). */
  changed?: boolean;
  /** Client-side: open comment threads on this node (count bubble). */
  commentCount?: number;
  depth: number;
  x: number | null;
  y: number | null;
  hasFilter: boolean;
  filterName: string | null;
  hasErrorHandler: boolean;
  source?: ProviderId;
  kind?: string;
  badge?: string;
  hookId?: number | null;
}

export interface Connection {
  from: NodeId;
  to: NodeId;
  label?: string;
  kind?: string;
  status?: "ok" | "dead" | "unmatched";
}

export interface ModuleDetail {
  id: number;
  module: string;
  app: string;
  label: string;
  mapper: Record<string, unknown> | null;
  filter: Record<string, unknown> | null;
  onerror: unknown[] | null;
  parameters: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  version: number | null;
  flags: Record<string, unknown> | null;
  /** Canvas enrichment merged in by the API (same as ModuleInfo). */
  summary?: string;
  ordinal?: string | null;
  waitFor?: WaitFor | null;
  kind?: string;
  assets?: AssetRef[];
}

export interface ScenarioSummary {
  historyWarning?: string;
  name: string;
  totalModules: number;
  appsUsed: string[];
  modules: ModuleInfo[];
  connections: Connection[];
  /** Deep link into the platform's own editor (server-built, zone/team aware). */
  nativeUrl?: string | null;
  /** Structural issues for the whole workflow (node-level ones repeat on modules). */
  issues?: Issue[];
  /** True when the connection path exposes no step content (GHL OAuth list-only). */
  stepsUnavailable?: boolean;
  reason?: string;
  /** When this workflow's content was last written (its own capture). */
  syncedAt?: string | null;
  /** When it was last confirmed current — the later of its own capture and
   *  the connection's last successful sync (unchanged workflows are skipped
   *  by a sync, so their own syncedAt stays put). Drives "synced X ago". */
  checkedAt?: string | null;
}

/** One asset / value a node references (from the reference index). */
export interface AssetRef {
  kind: string;
  value: string;
  label: string | null;
  url: string | null;
  dynamic: boolean;
  node_id?: string | null;
  provider?: ProviderId;
  meta?: Record<string, unknown>;
  /** Captured survey builder structure, when this asset is a GHL survey. */
  structure?: SurveyStructure;
}

/** A GHL survey's internal structure: slides → questions → options, with the
 * per-option conditional logic (disqualify / skip) that decides who advances. */
export interface SurveyStructure {
  surveyId: string | null;
  name: string | null;
  slides: SurveySlide[];
  questionCount: number;
  hasLogic: boolean;
  parsed: boolean;
  raw?: unknown;
}
export interface SurveySlide {
  id: string;
  order: number;
  title: string;
  questions: SurveyQuestion[];
}
export interface SurveyQuestion {
  id: string;
  type: string;
  label: string;
  required: boolean;
  hidden: boolean;
  options: SurveyOption[];
  hasLogic: boolean;
  disqualifies: boolean;
}
export interface SurveyOption {
  label: string;
  logic?: { action: string; target?: string };
}

/** One row of the assets registry (GET /assets). */
export interface AssetIndexEntry {
  kind: string;
  value: string;
  label: string | null;
  url: string | null;
  workflows: number;
  uses: number;
  providers: ProviderId[];
}

export function fetchAssets(q: { kind?: string; q?: string; limit?: number } = {}): Promise<{ assets: AssetIndexEntry[]; kinds: Record<string, number>; total: number }> {
  const p = new URLSearchParams();
  if (q.kind) p.set("kind", q.kind);
  if (q.q) p.set("q", q.q);
  if (q.limit) p.set("limit", String(q.limit));
  const qs = p.toString();
  return apiFetch(`/assets${qs ? `?${qs}` : ""}`);
}

/** Rail badge counts (GET /me/badges). */
export function fetchBadges(): Promise<{ unread: number; mentions: number }> {
  return apiFetch("/me/badges");
}

export interface RefUse {
  provider: ProviderId;
  connectionId: string;
  connectionLabel: string | null;
  workflowExternalId: string;
  workflowName: string | null;
  workflowStatus: string | null;
  isActive: boolean | null;
  nodeId: string | null;
  dynamic: boolean;  /** Enrichment from the node index (when available). */
  nodeLabel?: string | null;
  ordinal?: string | null;
  app?: string | null;
}

export interface RefUses {
  kind: string;
  value: string;
  label: string | null;
  url: string | null;
  workflows: number;
  uses: RefUse[];
}

export type SearchHitType = "workflow" | "node" | "asset" | "tag";

export interface SearchHit {
  type: SearchHitType;
  provider: ProviderId | null;
  connectionId: string | null;
  connectionLabel: string | null;
  workflowExternalId: string | null;
  workflowName: string | null;
  label: string | null;
  secondary?: string | null;
  nodeId?: string | null;
  kind?: string | null;
  app?: string | null;
  ordinal?: string | null;
  value?: string;
  url?: string | null;
  dynamic?: boolean;
  status?: string | null;
  isActive?: boolean | null;
  /** tag hits */
  tagId?: string;
  color?: string | null;
  workflows?: number;
}

/** Typed server search (workflows · nodes · assets) over the user's estate. */
export function searchEstate(q: string, limit = 20): Promise<{ query: string; results: SearchHit[] }> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch<{ query: string; results: SearchHit[] }>(`/search?${qs.toString()}`);
}

export function fetchRefUses(kind: string, value: string): Promise<RefUses> {
  const qs = new URLSearchParams({ kind, value });
  return apiFetch<RefUses>(`/refs/uses?${qs.toString()}`);
}

export function fetchWorkflowRefs(
  provider: ProviderId,
  externalId: string
): Promise<{ refs: AssetRef[] }> {
  return apiFetch<{ refs: AssetRef[] }>(
    `/workflows/${provider}/${encodeURIComponent(externalId)}/refs`
  );
}

export interface ScenarioDetail {
  id: number;
  name: string;
  teamId: number;
  folderId: number | null;
  isActive: boolean;
  isPaused: boolean;
  islinked: boolean;
  scheduling: Record<string, unknown>;
  lastEdit: string | null;
  nextExec: string | null;
  usedPackages: string[];
  created: string;
}

/* Deduped across the sidebar tree and the dashboard (same shell mount).
   Cleared on auth changes via clearApiCaches(). */
const hierarchyCache = new Map<string, Promise<Hierarchy>>();

export function clearApiCaches() {
  hierarchyCache.clear();
}

export function fetchHierarchy(
  conn: ConnRef,
  fresh = false
): Promise<Hierarchy> {
  if (fresh || !hierarchyCache.has(conn.id)) {
    const p = apiFetch<Hierarchy>(`/connections/${conn.id}/hierarchy`);
    p.catch(() => hierarchyCache.delete(conn.id));
    hierarchyCache.set(conn.id, p);
  }
  return hierarchyCache.get(conn.id)!;
}

export async function fetchScenarioDetail(
  scenarioId: number
): Promise<ScenarioDetail> {
  const raw = await apiFetch<{ scenario: ScenarioDetail }>(
    `/workflows/make/${scenarioId}/raw`
  );
  return raw.scenario;
}

export function fetchScenarioSummary(
  scenarioId: number,
  fresh = false
): Promise<ScenarioSummary> {
  return apiFetch(`/workflows/make/${scenarioId}/summary${fresh ? "?fresh=true" : ""}`);
}

export function fetchModuleDetail(
  scenarioId: number,
  moduleId: number
): Promise<ModuleDetail> {
  return apiFetch(`/workflows/make/${scenarioId}/nodes/${moduleId}`);
}

/* ─── GHL ──────────────────────────────────────────────────────────────── */

/** GHL summaries share the ScenarioSummary canvas contract. */
export interface GhlWorkflowSummary extends ScenarioSummary {
  source?: ProviderId;
  status?: string | null;
}

export function fetchGhlWorkflowSummary(
  workflowId: string,
  fresh = false
): Promise<GhlWorkflowSummary> {
  return apiFetch(`/workflows/ghl/${workflowId}/summary${fresh ? "?fresh=true" : ""}`);
}

export function fetchGhlStepDetail(
  workflowId: string,
  stepId: string
): Promise<Record<string, unknown>> {
  return apiFetch(`/workflows/ghl/${workflowId}/nodes/${stepId}`);
}

/* ─── Any provider ─────────────────────────────────────────────────────── */

/** Canvas summary for any registered provider (the GHL/Make helpers above
 * predate the generic route shape; new connectors use these). */
export function fetchWorkflowSummary(
  provider: ProviderId,
  workflowId: string,
  fresh = false
): Promise<GhlWorkflowSummary> {
  return apiFetch(`/workflows/${provider}/${encodeURIComponent(workflowId)}/summary${fresh ? "?fresh=true" : ""}`);
}

export function fetchNodeDetail(
  provider: ProviderId,
  workflowId: string,
  nodeId: string
): Promise<Record<string, unknown>> {
  return apiFetch(`/workflows/${provider}/${encodeURIComponent(workflowId)}/nodes/${encodeURIComponent(nodeId)}`);
}

/** One entry of the batch summaries response: the same Summary shape as the
 *  single route, or why there is none ("not-synced" | "not-captured"). */
export type WorkflowSummaryResult =
  | ScenarioSummary
  | { error: string; stepsUnavailable?: boolean };

export interface WorkflowSummariesResponse {
  summaries: Record<string, WorkflowSummaryResult>;
}

/** Batch size for `/workflows/summaries` — under the route's 50-id cap. */
export const SUMMARIES_CHUNK = 40;

/**
 * Canvas summaries for many workflows at once ("{source}:{refId}" keys).
 * Chunked so the workflow map can request a whole unfold wave in one call
 * per 40 ids; results are merged into one map. Unknown or cross-workspace
 * ids come back as `{error: "not-synced"}` — never as an exception.
 */
export async function fetchWorkflowSummaries(keys: string[]): Promise<WorkflowSummariesResponse> {
  const unique = [...new Set(keys)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += SUMMARIES_CHUNK) chunks.push(unique.slice(i, i + SUMMARIES_CHUNK));
  const parts = await Promise.all(
    chunks.map((ids) =>
      apiFetch<WorkflowSummariesResponse>(`/workflows/summaries?ids=${encodeURIComponent(ids.join(","))}`)
    )
  );
  const summaries: Record<string, WorkflowSummaryResult> = {};
  for (const p of parts) Object.assign(summaries, p?.summaries ?? {});
  return { summaries };
}

/* ─── Connections ──────────────────────────────────────────────────────── */

export interface BackendConnectionRow {
  id: string;
  provider: string;
  external_id: string;
  label: string | null;
  status: string;
  last_synced_at: string | null;
  auth_type?: string;
  /** Provider account name (Make organization / GHL location), when resolved. */
  account_name?: string | null;
  /** label ?? account_name ?? external_id — what to call this connection. */
  display_name?: string;
  /** Last sync *attempt* — moves even when the sync failed, unlike
   *  last_synced_at which only moves on success. */
  last_sync_attempt_at?: string | null;
  last_sync_outcome?: "ok" | "partial" | "failed" | null;
  /** Whose credential backs this connection. In a shared workspace a GHL
   *  connection runs on one person's session token. */
  connectedBy?: { userId: string | null; name: string | null; unclaimed: boolean };
  /** "account" holds one credential spanning several containers the user picks
   *  from; "location" is a single synced container. */
  kind?: "account" | "location";
  /** The account connection this container's credential comes from. */
  parent_id?: string | null;
  /** Non-secret connection settings. Carries `capturedVia` and `accountName`. */
  config?: Record<string, unknown>;
}

/** GET /connectors — provider catalog incl. alternative connect paths. */
export interface ConnectorCatalogEntry {
  provider: ProviderId;
  displayName: string;
  connectMethod: string;
  connectFields: { name: string; label: string; secret?: boolean }[];
  oauthAvailable?: boolean;
  authTypes?: string[];
}

export function fetchConnectorCatalog(): Promise<ConnectorCatalogEntry[]> {
  return apiFetch<ConnectorCatalogEntry[]>(`/connectors`);
}

/** Begin an OAuth connect: the API returns the provider's authorize URL
 * carrying a signed state; the browser is sent there. */
export function startOAuth(provider: ProviderId): Promise<{ url: string; expiresIn: number }> {
  return apiFetch(`/oauth/${provider}/start`);
}

export interface ConnectionWorkflowRow {
  connection_id: string;
  provider: ProviderId;
  external_id: string;
  name: string;
  status: string | null;
  is_active: boolean | null;
  synced_at: string;
  /** Platform folder/directory the workflow lives in, when the provider has them. */
  folder?: string | null;
  folder_id?: string | null;
  tags?: Tag[];
}

export function fetchConnectionWorkflows(
  connectionId: string
): Promise<ConnectionWorkflowRow[]> {
  return apiFetch(`/connections/${connectionId}/workflows`);
}

/* ─── Account connections & containers ─────────────────────────────────── */

/**
 * Connect a whole GoHighLevel account with one captured session token.
 *
 * The token is scoped to the GHL *user*, not a sub-account, so this stores it
 * once and the sub-accounts to read are chosen next — rather than capturing the
 * same credential once per sub-account.
 */
export function connectGhlAccount(
  refreshToken: string,
  label?: string | null
): Promise<BackendConnectionRow & { containerNoun?: string }> {
  return apiPost(`/connections`, {
    provider: "ghl",
    kind: "account",
    label: label ?? null,
    credentials: { refreshToken },
    // auth_type will be "extension" either way — it means "a browser session
    // token". Record which vehicle actually produced it so the UI can say so.
    config: { capturedVia: "bookmarklet" },
  });
}

export interface ContainerRow {
  externalId: string;
  name: string | null;
  connected: boolean;
  connectionId?: string | null;
}

export interface ContainerList {
  /** False means the provider gives us no way to list — ask the user for ids.
   *  It does NOT mean the account has none. */
  canEnumerate: boolean;
  /** False when the ids came from the session token rather than HighLevel's
   *  listing: a subset, so never present it as the whole account. */
  complete?: boolean;
  containerNoun: string;
  containers: ContainerRow[];
}

export function fetchContainers(connectionId: string): Promise<ContainerList> {
  return apiFetch(`/connections/${connectionId}/containers`);
}

export function connectContainers(
  connectionId: string,
  containers: { external_id: string; name?: string | null }[]
): Promise<{ count: number; syncing: boolean; connected: BackendConnectionRow[] }> {
  return apiPost(`/connections/${connectionId}/containers`, { containers });
}

/* ─── Extension pairing ────────────────────────────────────────────────── */

export interface PairingCode {
  code: string;
  expires_at: string;
  ttl_seconds: number;
}

export function mintPairingCode(): Promise<PairingCode> {
  return apiPost(`/pairing-codes`);
}

/* ─── Capture manifest ─────────────────────────────────────────────────── */

export interface SyncRun {
  id: string;
  trigger: "manual" | "connect" | "first" | "stale" | "scheduled";
  startedAt: string;
  finishedAt: string | null;
  outcome: "ok" | "partial" | "failed" | null;
  listed: number;
  captured: number;
  skipped: number;
  failed: number;
  /** "none" = this provider gives us nothing to diff against, so every sync
   *  must re-read the whole estate. */
  revisionSource: string | null;
  errors: { workflowId?: string; stage?: string; error?: string }[];
}

export interface SyncRuns {
  connectionId: string;
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  lastOutcome: "ok" | "partial" | "failed" | null;
  runs: SyncRun[];
}

export function fetchSyncRuns(connectionId: string, limit = 20): Promise<SyncRuns> {
  return apiFetch(`/connections/${connectionId}/sync-runs?limit=${limit}`);
}

/* ─── Health signals ───────────────────────────────────────────────────── */

export interface HealthIssue {
  code: string;
  severity: "error" | "warn" | "info";
  provider: ProviderId;
  workflowExternalId: string | null;
  nodeId: string | null;
  message: string;
  data: Record<string, unknown> & { capture?: boolean };
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface HealthSummary {
  bySeverity: { error: number; warn: number; info: number };
  byCode: Record<string, number>;
  workflowsAffected: number;
  total: number;
}

/** `kind: "breakage"` excludes Orrit's own capture failures — the thing that
 *  must never be mistaken for the estate being broken. */
export function fetchIssues(
  kind: "all" | "breakage" | "capture" = "all"
): Promise<{ issues: HealthIssue[]; summary: HealthSummary }> {
  return apiFetch(`/issues?kind=${kind}`);
}

export interface IssueEvent {
  event: "opened" | "closed";
  code: string;
  severity: "error" | "warn" | "info";
  provider: ProviderId;
  workflowExternalId: string | null;
  at: string;
  capture: boolean;
}

export function fetchIssueEvents(days = 30): Promise<{ days: number; events: IssueEvent[] }> {
  return apiFetch(`/issues/events?days=${days}`);
}

/* ─── Consent & beta terms ─────────────────────────────────────────────── */

export interface LegalDocumentMeta {
  slug: string;
  version: string;
  title: string;
  summary: string;
  /** "elevated" = the document describes a risk the user takes on, not just
   *  terms they agree to. The UI leads with it rather than folding it away. */
  risk: "standard" | "elevated";
}

export interface LegalDocument extends LegalDocumentMeta {
  body: string;
}

export interface LegalCatalog {
  documents: LegalDocumentMeta[];
  /** Which documents each connect path requires, straight from the server —
   *  so the gate the UI shows can never drift from the gate the API enforces. */
  gates: { connect: string[]; extension: string[] };
}

export interface Acceptance {
  slug: string;
  version: string;
  title: string;
  acceptedAt: string;
  /** False once a newer version supersedes the one they accepted. */
  current: boolean;
}

export function fetchLegalCatalog(): Promise<LegalCatalog> {
  return apiFetch(`/legal`);
}

export function fetchLegalDocument(slug: string): Promise<LegalDocument> {
  return apiFetch(`/legal/${slug}`);
}

export function acceptLegalDocument(slug: string): Promise<{ slug: string; version: string }> {
  return apiPost(`/legal/${slug}/accept`);
}

export function fetchMyAcceptances(): Promise<{ acceptances: Acceptance[] }> {
  return apiFetch(`/me/acceptances`);
}

/**
 * Documents an API call refused on, or null if it failed for another reason.
 * The connect gates return 403 with the outstanding documents inline, so a
 * caller can render the consent step without a second round trip.
 */
export function termsRequiredFrom(error: unknown): LegalDocumentMeta[] | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  const detail = error.detail as { error?: string; documents?: LegalDocumentMeta[] } | undefined;
  if (detail?.error !== "terms_not_accepted") return null;
  return detail.documents ?? [];
}

/* ─── Workflow-level link map ──────────────────────────────────────────── */

export interface LinkEnd {
  source: ProviderId;
  refId: string;
  stepId?: string;
  stepName?: string;
  hookId?: number;
  udid?: string;
}

export interface WorkflowLink {
  from: LinkEnd;
  to: LinkEnd;
  kind: "webhook-call" | "subflow";
  status: "ok" | "dead";
}

export interface WorkflowCard {
  source: ProviderId;
  refId: string;
  name: string;
  status?: string | null;
  stepCount?: number;
  /** Editor deep link on the platform (null when none is derivable). */
  nativeUrl?: string | null;
  isActive?: boolean;
  talksToGhl?: boolean;
  issueCounts?: IssueCounts;
  tags?: Tag[];
  lastRun?: LastRun;
  /** Changes newer than this viewer's last visit (last 30 days). */
  changedSince?: { count: number; at: string | null };
  ownerUserId?: string;
  watching?: boolean;
  /** What Orrit actually has for this workflow, and when it got it. */
  capture?: CaptureState;
}

export type CaptureStateName = "current" | "changed" | "never-captured" | "failed";

export interface CaptureState {
  state: CaptureStateName;
  /** When the content shown was last captured successfully. */
  at: string | null;
  attemptedAt: string | null;
  error: string | null;
  /** Set when the workflow no longer exists in the platform. */
  deletedUpstreamAt: string | null;
}

/** An asset referenced by more than one workflow ("both touch Sheet X"). */
export interface AssetLink {
  kind: string;
  value: string;
  label: string | null;
  url: string | null;
  workflows: { source: ProviderId; refId: string; nodes: string[] }[];
}

export interface LinkMap {
  workflows: WorkflowCard[];
  links: WorkflowLink[];
  unmatched: (LinkEnd & { udid: string })[];
  assetLinks?: AssetLink[];
  issues?: Issue[];
  stats: {
    workflows: number;
    links: number;
    deadLinks: number;
    sharedAssets?: number;
    issues?: number;
    issueErrors?: number;
  };
}

export function fetchLinks(): Promise<LinkMap> {
  return apiFetch(`/links`);
}

/** Node-level composed graph across workflows (GET /graph). Node ids are
 * "{provider}:{workflowId}:{nodeId}"; groups prefix their members. */
export interface GraphData {
  groups: { id: string; source: ProviderId; name: string; refId: string }[];
  nodes: ModuleInfo[];
  connections: Connection[];
  stats: { groups: number; crossLinks: number; deadLinks: number };
}

export function fetchGraph(keys: { source: ProviderId; refId: string }[] = []): Promise<GraphData> {
  const qs = keys.length
    ? `?workflows=${encodeURIComponent(keys.map((k) => `${k.source}:${k.refId}`).join(","))}`
    : "";
  return apiFetch<GraphData>(`/graph${qs}`);
}

/* ─── Funnels / Martech ────────────────────────────────────────────────
 * API paths stay `/funnels`; the UI calls the feature Martech. The graph is
 * schemaVersion 2: the classic stages/attachments/relationships/evidence
 * arrays plus flat top-level `pages`, `automations`, `decisions`,
 * `conversions`, `tracking`, `adPlatform`, `unplaced`, `source`. Everything
 * is evidence-labelled: "configured" (captured from the platform's config)
 * or "not-captured" (Orrit has nothing for it). Never a runtime claim.
 */

/** What Orrit can honestly say about a node: captured from configuration,
 * or not captured at all. There is no third state. */
export type Evidence = "configured" | "not-captured";

export type FunnelStageRole = "optin" | "application" | "booking" | "confirmation" | "disqualified" | "other";

export interface FunnelSummary {
  id: string;
  name: string;
  description?: string | null;
  primaryConnectionId?: string | null;
  accountLabel?: string | null;
  reviewState: "draft" | "needs_review" | "reviewed";
  revision: number;
  reviewedAt?: string | null;
  updatedAt?: string | null;
  /** "detected" = built from the platform (GHL funnel directory / workflow
   *  cluster); "manual" = mapped by an operator. */
  origin: "detected" | "manual";
  detectionSource?: "ghl_funnel" | "workflow_cluster" | null;
  /** Native URL of the funnel in the platform, when known. */
  sourceUrl?: string | null;
  pageCount: number;
  workflowCount: number;
  /** List-level coverage facets — same vocabulary as the graph's coverage. */
  coverage: {
    pages: CoverageState;
    screenshots: CoverageState;
    automations: CoverageState;
  };
  lastCapturedAt?: string | null;
  lastDetectedAt?: string | null;
}

export interface FunnelStage {
  id: string;
  kind: "entry" | "page" | "decision" | "outcome" | "milestone";
  displayName: string;
  purpose?: string | null;
  displayOrder: number;
  origin: "captured" | "manual" | "suggested";
  meta: Record<string, unknown>;
  /** Public URL of the stage's default page, when it is a page. */
  url?: string | null;
  role?: FunnelStageRole | null;
  /** GHL funnel step id (stable across re-detects). */
  sourceExternalId?: string | null;
}

export interface FunnelAttachment {
  id: string;
  stageId?: string | null;
  targetKind: "workflow" | "step" | "asset";
  connectionId?: string | null;
  workflowExternalId?: string | null;
  nodeId?: string | null;
  assetKind?: string | null;
  assetValue?: string | null;
  relationship: string;
  origin: string;
  label?: string | null;
  meta: Record<string, unknown>;
}

export interface FunnelRelationship {
  id: string;
  fromStageId?: string | null;
  toStageId?: string | null;
  /** "next" | "branches_to" | "redirects_to" | … */
  kind: string;
  label?: string | null;
  conditionText?: string | null;
  origin: string;
  validity: "current" | "stale" | "unresolved" | "source_deleted";
}

export interface FunnelWorkflowSummary {
  connectionId: string;
  workflowExternalId: string;
  name?: string | null;
  status?: string | null;
  isActive?: boolean | null;
  captureState?: string | null;
}

export type CoverageState = { state: "captured" | "partial" | "not-captured"; reason?: string };

/** A form / survey / calendar embedded on a page (or referenced by a
 * workflow trigger placed on that page). */
export interface FunnelPageAsset {
  kind: "form" | "survey" | "calendar";
  externalId: string;
  name: string | null;
  /** Deep link to the asset in the platform (opens in a new tab). */
  nativeUrl: string | null;
  /** Registry kind, for the Dependencies link (`assetHref`). Surveys share
   *  the form registry. */
  assetKind: "ghl_form" | "ghl_calendar";
  /** Surveys only: slides / questions / disqualify logic. */
  surveyStructure?: SurveyStructure | null;
}

export interface FunnelPageScreenshot {
  status: "captured" | "pending" | "failed" | "unavailable";
  /** Signed URL (1h) when `status === "captured"`. */
  url: string | null;
  capturedAt: string | null;
  /** Why there is no image, for failed / unavailable. */
  reason: string | null;
}

export interface FunnelPageVariant {
  pageExternalId: string;
  name: string;
  path: string | null;
  url: string | null;
  isDefault: boolean;
}

export interface FunnelPage {
  id: string;
  stageId: string;
  /** Position within the stage's step; the lowest one is the primary page. */
  stepIndex: number;
  name: string;
  /** Public URL (what the screenshot worker fetched). */
  url: string | null;
  /** Page in the GHL builder. */
  nativeUrl: string | null;
  screenshot: FunnelPageScreenshot | null;
  /** A/B variants of this page, primary included. */
  variants: FunnelPageVariant[];
  embeddedAssets: FunnelPageAsset[];
  origin: "captured" | "manual" | "suggested";
  hasTrackingCode?: boolean | null;
}

export type FunnelActionKind = "crm" | "pipeline" | "message" | "conversion" | "enroll" | "wait" | "other";

export interface FunnelAutomationAction {
  id: string;
  /** Platform action type (e.g. "add_contact_tag", "send_sms"). */
  type: string;
  kind: FunnelActionKind;
  label: string;
  /** Software the action writes to (app key: "ghl", "meta", …). */
  destinationSoftware: string | null;
  /** Server-side conversion (Meta CAPI etc.) — `kind === "conversion"`. */
  conversion: { platform: string; eventName: string } | null;
}

export interface FunnelAutomationTrigger {
  /** Platform trigger type (e.g. "form_submission", "survey_submission", "appointment"). */
  type: string;
  label: string;
  /** The asset the trigger listens on, when it has one. */
  asset: { assetKind: string; assetValue: string; label: string | null } | null;
  conditionText: string | null;
  /** Survey outcome the trigger filters on, when it does. */
  qualification: "qualified" | "disqualified" | null;
}

export interface FunnelAutomation {
  id: string;
  /** Stage the trigger was placed on; null = unplaced (listed, never guessed). */
  stageId: string | null;
  connectionId: string;
  workflowExternalId: string;
  name: string;
  /** Platform status ("published" | "draft" | …). */
  status: string | null;
  captureState: CaptureState | null;
  nativeUrl: string | null;
  trigger: FunnelAutomationTrigger;
  /** First actions in order; the API caps this list (8). */
  actions: FunnelAutomationAction[];
  actionsTruncated: boolean;
}

export interface FunnelDecisionBranch {
  outcome: "qualified" | "disqualified";
  toStageId: string | null;
  conditionText: string | null;
  evidence: Evidence;
}

/** A qualification split, derived from a survey's disqualify logic and the
 * `branches_to` relationship off its stage. */
export interface FunnelDecision {
  id: string;
  stageId: string;
  /** The survey that decides. */
  assetExternalId: string | null;
  label: string;
  branches: FunnelDecisionBranch[];
}

/** A configured server-side conversion report (workflow action → ad platform). */
export interface FunnelConversion {
  id: string;
  stageId: string | null;
  automationId: string;
  actionId: string;
  /** "meta" | "google" | … */
  platform: string;
  eventName: string;
  evidence: Evidence;
}

/** Browser-side tracking per stage. Pixel / tracking-code capture is out of
 * scope, so the state is always "not-captured" with a reason. */
export interface FunnelTracking {
  stageId: string;
  pixel: { state: "not-captured"; reason: string };
}

export interface FunnelAdPlatform {
  /** Inferred from UTM / conversion targets; never from the ad account. */
  destination: "meta" | "google" | "tiktok" | "unknown" | null;
  evidence: Evidence;
  reason?: string | null;
}

export interface FunnelUnplacedAutomation {
  automationId: string;
  reason: string | null;
}

export interface FunnelSource {
  kind: "ghl_funnel" | "workflow_cluster" | "manual";
  externalId: string | null;
  url: string | null;
  /** Native URL guessed from the id until the probe confirms it. */
  urlVerified?: boolean;
  updatedAt: string | null;
}

export interface FunnelEvidence {
  id: string;
  stageId?: string | null;
  method: string;
  coverage: string;
  reasonText?: string | null;
}

export interface FunnelGraph {
  schemaVersion: 2;
  funnel: FunnelSummary;
  stages: FunnelStage[];
  relationships: FunnelRelationship[];
  attachments: FunnelAttachment[];
  workflowSummaries: FunnelWorkflowSummary[];
  evidence: FunnelEvidence[];
  coverage: Record<string, CoverageState>;
  pages: FunnelPage[];
  automations: FunnelAutomation[];
  decisions: FunnelDecision[];
  conversions: FunnelConversion[];
  tracking: FunnelTracking[];
  adPlatform: FunnelAdPlatform | null;
  unplaced: FunnelUnplacedAutomation[];
  source: FunnelSource | null;
  lastCapturedAt: string | null;
}

export function fetchFunnels(q?: string): Promise<{ funnels: FunnelSummary[] }> {
  return apiFetch(`/funnels${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export function createFunnel(name: string, primaryConnectionId?: string): Promise<FunnelSummary> {
  return apiPost(`/funnels`, { name, primaryConnectionId });
}

export function fetchFunnelGraph(id: string): Promise<FunnelGraph> {
  return apiFetch(`/funnels/${id}/graph`);
}

export function addFunnelStage(id: string, stage: {
  kind?: string; displayName: string; purpose?: string; displayOrder?: number;
}): Promise<FunnelStage> {
  return apiPost(`/funnels/${id}/stages`, stage);
}

export function reviewFunnel(id: string, expectedRevision: number): Promise<FunnelSummary> {
  return apiPost(`/funnels/${id}/review`, { expectedRevision });
}

/** Re-run funnel detection for one connection (reads captured artifacts
 * only — never touches the platform). */
export function detectFunnels(connectionId: string): Promise<{ funnels: FunnelSummary[] }> {
  return apiPost(`/funnels/detect?connectionId=${encodeURIComponent(connectionId)}`);
}
