import type { Execution, LinkMap, RecordKind, RecordRun, RunRow, RunStatus, RunWindow, WorkflowCard } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";

/*
 * Triage — the operator layer over the visualization: an explorer across
 * every stored execution (filter by status, workflow, window, or the record
 * that went through it) and replay of one recorded run on the map. These
 * helpers are shared by the /triage page, its table and the rail badge.
 * Everything in this layer reads what already ran; nothing starts, stops or
 * retries a run.
 */

export const RUN_WINDOWS: RunWindow[] = ["1h", "24h", "7d", "30d"];
export const DEFAULT_WINDOW: RunWindow = "24h";

export function isRunWindow(v: string | null | undefined): v is RunWindow {
  return !!v && (RUN_WINDOWS as string[]).includes(v);
}

/** Status filter chips, in the order they read: healthy → broken. */
export const RUN_STATUSES: { value: RunStatus; label: string }[] = [
  { value: "success", label: "OK" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Failed" },
  { value: "incomplete", label: "Incomplete" },
];

export function isRunStatus(v: string | null | undefined): v is RunStatus {
  return !!v && RUN_STATUSES.some((s) => s.value === v);
}

/** Short word for a record kind — the `record · …` chip. */
export const RECORD_KIND_WORD: Record<RecordKind, string> = {
  email: "email",
  phone: "phone",
  contact_id: "id",
  id: "id",
};

/** Workflows whose last run failed or stopped incomplete, newest first.
 *  Make only — the one platform with a runtime source today. Feeds the rail
 *  badge; the explorer itself lists every run, not only the failures. */
export function recentFailures(linkMap: LinkMap | null | undefined): WorkflowCard[] {
  if (!linkMap) return [];
  return linkMap.workflows
    .filter((w) => w.source === "make" && (w.lastRun?.status === "error" || w.lastRun?.status === "incomplete"))
    .sort((a, b) => (b.lastRun?.at ?? "").localeCompare(a.lastRun?.at ?? ""));
}

/** A record-index hit as a table row. The identifier index carries no
 *  duration, ops or error — those cells read "—" rather than a guess. */
export function recordRunToRow(r: RecordRun): RunRow {
  return {
    provider: r.provider,
    connectionId: r.connectionId,
    connectionLabel: r.connectionLabel ?? "",
    workflowExternalId: r.workflowExternalId,
    workflowName: r.workflowName,
    executionId: r.executionId,
    status: r.status,
    startedAt: r.startedAt,
    durationMs: null,
    operations: null,
    errorName: null,
    errorMessage: null,
    causeModuleId: null,
    nativeUrl: null,
  };
}

/** One workflow's own execution as a table row. `/runs` filtered to a
 *  workflow is the real source; this maps the older per-workflow endpoint so
 *  the history log works before that endpoint is up. */
export function executionToRow(
  e: Execution,
  ctx: { provider: ProviderId; workflowExternalId: string; workflowName: string | null; connectionId?: string; connectionLabel?: string; nativeUrl?: string | null }
): RunRow {
  return {
    provider: ctx.provider,
    connectionId: ctx.connectionId ?? "",
    connectionLabel: ctx.connectionLabel ?? "",
    workflowExternalId: ctx.workflowExternalId,
    workflowName: ctx.workflowName,
    executionId: e.executionId,
    status: e.status,
    startedAt: e.startedAt,
    durationMs: e.durationMs,
    operations: e.operations,
    errorName: e.errorName,
    errorMessage: e.errorMessage,
    causeModuleId: e.causeModuleId,
    nativeUrl: ctx.nativeUrl ?? null,
  };
}

/* ─── Step hints ─────────────────────────────────────────────────────────── */

/*
 * "7/9 steps" beside a run, but only for runs whose trace this session has
 * already fetched — replaying one on the map records its tally here, and the
 * log reads it back. Nothing fetches a trace to fill this in: a row without a
 * remembered trace simply shows nothing. Module-level and in memory only, so
 * it dies with the tab.
 */
const STEP_HINTS = new Map<string, string>();
const hintKey = (provider: string, workflowExternalId: string, executionId: string) => `${provider}:${workflowExternalId}:${executionId}`;

export function rememberRunSteps(provider: string, workflowExternalId: string, executionId: string, reached: number, total: number): void {
  if (total > 0) STEP_HINTS.set(hintKey(provider, workflowExternalId, executionId), `${reached}/${total}`);
}

/** "7/9" — the bare ratio, for a table cell that has its own column head. */
export function runStepsRatio(r: RunRow): string | null {
  return STEP_HINTS.get(hintKey(r.provider, r.workflowExternalId, r.executionId)) ?? null;
}

/** "7/9 steps" — the ratio where it stands on its own in a line of meta. */
export function runStepsHint(r: RunRow): string | null {
  const ratio = runStepsRatio(r);
  return ratio ? `${ratio} steps` : null;
}

/* ─── Number formatting ──────────────────────────────────────────────────── */

/** "842" · "12.9K" · "1.4M". Stat-tile values use the font's proportional
 *  figures, so they are never padded to a column width. */
export function compactCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1000) return String(Math.round(n));
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(Math.abs(n) < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "820 ms" · "4.2 s" · "1 m 12 s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : String(Math.round(s))} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return rest ? `${m} m ${rest} s` : `${m} m`;
}

/** "99.2%" · "100%". The API sends a fraction (0–1); a value above 1 is
 *  read as an already-scaled percentage rather than silently multiplied. */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  const pct = rate <= 1 ? rate * 100 : rate;
  if (pct >= 99.95) return "100%";
  return `${pct.toFixed(1)}%`;
}

/** Full timestamp for a cell's hover title. */
export function fullTime(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleString();
}
