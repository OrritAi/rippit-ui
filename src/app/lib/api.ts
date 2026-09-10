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
const WORKSPACE_KEY = "rippit.workspace";

export function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(WORKSPACE_KEY);
}

export function setActiveWorkspaceId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(WORKSPACE_KEY, id);
  else window.localStorage.removeItem(WORKSPACE_KEY);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers(init?.headers);
  if (session) headers.set("Authorization", `Bearer ${session.access_token}`);
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) headers.set("X-Rippit-Workspace", workspaceId);

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

/** One runtime execution (Make) — status + timing + failing module, never payloads. */
export interface Execution {
  executionId: string;
  status: "success" | "warning" | "error" | "incomplete" | "unknown";
  startedAt: string | null;
  durationMs: number | null;
  operations: number | null;
  errorName: string | null;
  errorMessage: string | null;
  causeModuleId: string | null;
  meta: Record<string, unknown>;
}

export interface ExecutionsResponse {
  supported: boolean;
  reason?: string;
  executions: Execution[];
  fetchedAt: string | null;
  refreshing?: boolean;
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

/* ─── Workspaces ─────────────────────────────────────────────────────────── */

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "member";
  created_by?: string | null;
  joined_at?: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: "owner" | "member";
  display_name: string | null;
  email: string | null;
  joined_at: string;
}

export interface WorkspaceInvite {
  id: string;
  workspace_id: string;
  email: string;
  role: "owner" | "member";
  invited_at?: string;
}

export function fetchWorkspaces(): Promise<{ current: string; workspaces: Workspace[] }> {
  return apiFetch(`/workspaces`);
}

export function createWorkspace(name: string): Promise<Workspace> {
  return apiPost<Workspace>(`/workspaces`, { name });
}

export function renameWorkspace(id: string, name: string): Promise<Workspace> {
  return apiFetch(`/workspaces/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function fetchMembers(id: string): Promise<{ members: WorkspaceMember[]; invites: WorkspaceInvite[] }> {
  return apiFetch(`/workspaces/${encodeURIComponent(id)}/members`);
}

export type WorkspaceRole = "owner" | "member" | "viewer";

export function inviteMember(id: string, email: string, role: WorkspaceRole = "member"): Promise<WorkspaceInvite> {
  return apiPost<WorkspaceInvite>(`/workspaces/${encodeURIComponent(id)}/invites`, { email, role });
}

export function revokeInvite(id: string, inviteId: string): Promise<{ deleted: string }> {
  return apiFetch(`/workspaces/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

export function removeMember(id: string, userId: string): Promise<{ removed: string }> {
  return apiFetch(`/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export function updateMe(displayName: string): Promise<WorkspaceMember> {
  return apiFetch(`/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
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

/** `kind: "breakage"` excludes Rippit's own capture failures — the thing that
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
  /** What Rippit actually has for this workflow, and when it got it. */
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
 * or "not-captured" (Rippit has nothing for it). Never a runtime claim.
 */

/** What Rippit can honestly say about a node: captured from configuration,
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
