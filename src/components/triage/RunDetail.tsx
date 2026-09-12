"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  ApiError,
  fetchExecutionPayload,
  fetchRunDetail,
  type ExecutionPayload,
  type RunDetail as RunDetailData,
  type RunPayloadState,
  type RunRow,
} from "@/app/lib/api";
import { CopyJsonButton, JsonBlock } from "@/components/shared/DetailPanelKit";
import { RUN_TONE } from "@/components/shared/RunsPanel";
import { CONNECTORS } from "@/lib/connectors";
import { RECORD_KIND_WORD, formatDuration, fullTime } from "@/lib/triage";
import { runReplayHref } from "@/lib/workflowMap/run";

/*
 * One run, in full. Sections, in order: Summary · Steps · Identifiers ·
 * Input · Raw JSON. `raw` is the execution row, the step rows and the
 * coverage rows exactly as stored, so the view is never a summary of a
 * summary.
 *
 * `RunDetailBody` is the one implementation of those sections. The log's
 * expanded row renders it as-is, where a step is a link to that step on the
 * map; the map's own run panel renders it with `onStepClick`, where a step
 * instead selects and centres the node without leaving the page, and
 * `selectedStepId` marks the one being looked at.
 *
 * Provider-agnostic: nothing here branches on a platform name. A run of any
 * platform whose runtime lands renders through this same component, with the
 * platform's own label coming from the connector registry.
 *
 * Read-only, like the rest of the layer: every call is a GET, the input is
 * fetched on demand and shown once, and nothing is ever written back.
 * Until the detail endpoint is deployed the body degrades to what the row
 * already holds plus one short line, rather than erroring.
 */

/** Columns the Summary already gives a label of its own; everything else in
 *  the execution row is listed after them, so a new column needs no edit. */
const NAMED = new Set([
  "executionId",
  "status",
  "startedAt",
  "durationMs",
  "operations",
  "errorName",
  "errorMessage",
  "causeModuleId",
  "causeModule",
  "causeSource",
  "runId",
  "meta",
]);

/** `fetchedAt` → "Fetched at". A column name is not copy, so it is only
 *  de-camelled, never renamed. */
function label(key: string): string {
  const words = key.replace(/([A-Z])/g, " $1").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

const STATE_TONE: Record<string, string> = {
  failed: "text-err-text",
  error: "text-err-text",
  warning: "text-warn-text",
  touched: "text-t1",
  reached: "text-t1",
  untouched: "text-t3",
  unknown: "text-t3",
};

function Head({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-3">
      <h4 className="m-0 text-[10px] font-semibold uppercase tracking-[0.04em] text-t3">{title}</h4>
      {action}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line2 py-[5px] last:border-b-0">
      <span className="flex-none text-[11.5px] text-t3">{k}</span>
      <span className="tabular min-w-0 text-right font-mono text-[11px] text-t2 [overflow-wrap:anywhere]">{v}</span>
    </div>
  );
}

export function RunDetailBody({
  row,
  onStepClick,
  selectedStepId = null,
}: {
  row: RunRow;
  /** Given: a step selects and centres its node instead of navigating. */
  onStepClick?: (nodeId: string) => void;
  selectedStepId?: string | null;
}) {
  const { provider, workflowExternalId, executionId } = row;
  const key = `${provider}:${workflowExternalId}:${executionId}`;
  // Keyed by the run it answers, so loading and failure are derived rather
  // than set from inside the effect.
  const [result, setResult] = useState<{ key: string; detail: RunDetailData | null } | null>(null);
  const fresh = result?.key === key ? result : null;
  const detail = fresh?.detail ?? null;
  const loading = !fresh;
  const failed = !!fresh && fresh.detail === null;

  useEffect(() => {
    let live = true;
    fetchRunDetail(provider, workflowExternalId, executionId)
      .then((d) => live && setResult({ key, detail: d }))
      .catch(() => live && setResult({ key, detail: null }));
    return () => {
      live = false;
    };
  }, [key, provider, workflowExternalId, executionId]);

  const platform = CONNECTORS[row.provider]?.shortLabel ?? row.provider;
  const run = detail?.run ?? null;
  const tone = RUN_TONE[run?.status ?? row.status] ?? RUN_TONE.unknown;
  // Every field falls back to the row, so the summary stands up on a 404 too.
  const startedAt = run?.startedAt ?? row.startedAt;
  const durationMs = run?.durationMs ?? row.durationMs;
  const operations = run?.operations ?? row.operations;
  const errorName = run?.errorName ?? row.errorName;
  const errorMessage = run?.errorMessage ?? row.errorMessage;
  const causeId = run?.causeModuleId ?? row.causeModuleId;
  const cause = causeId || run?.causeModule ? { nodeId: causeId ?? null, name: run?.causeModule?.name ?? null, app: run?.causeModule?.appName ?? null } : null;
  // The run's own log link; the top-level nativeUrl is the workflow's editor.
  const nativeUrl = detail?.links?.execution ?? detail?.nativeUrl ?? row.nativeUrl;
  // Columns the execution row grows later arrive in `run` and show up here
  // without an edit — the named rows above are only the ones worth a label.
  const extras = run ? Object.entries(run).filter(([k, v]) => !NAMED.has(k) && (v == null || typeof v !== "object")) : [];

  return (
      <div className="flex flex-col gap-4">
        <section>
          <Head title="Summary" />
          <Kv k="Status" v={<span style={{ color: tone.text }}>{tone.label}</span>} />
          <Kv k="Started" v={fullTime(startedAt) ?? "—"} />
          <Kv k="Duration" v={formatDuration(durationMs)} />
          <Kv k="Operations" v={operations ?? "—"} />
          {cause && <Kv k="Failing step" v={[cause.name, cause.app, cause.nodeId ? `#${cause.nodeId}` : null].filter(Boolean).join(" · ") || "—"} />}
          {(errorName || errorMessage) && <Kv k="Error" v={[errorName, errorMessage].filter(Boolean).join(" · ")} />}
          <Kv k="Run id" v={row.executionId} />
          {run?.runId && run.runId !== row.executionId && <Kv k={`${platform} id`} v={run.runId} />}
          <Kv k="Workflow" v={detail?.workflowName ?? row.workflowName ?? row.workflowExternalId} />
          {extras.map(([k, v]) => (
            <Kv key={k} k={label(k)} v={v == null ? "—" : String(v)} />
          ))}
          {nativeUrl && (
            <div className="pt-2">
              <a href={nativeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-t2 underline-offset-4 hover:text-t1 hover:underline">
                Open in {platform}
                <ArrowUpRight aria-hidden="true" className="size-3" />
              </a>
            </div>
          )}
        </section>

        {detail && detail.steps.length > 0 && (
          <section>
            <Head title="Steps" />
            <div className="flex flex-col">
              {detail.steps.map((s, i) => {
                const on = selectedStepId != null && s.nodeId != null && String(s.nodeId) === String(selectedStepId);
                // No label in the index is not "Unknown" — the node id names it.
                const stepName = s.name ?? s.nodeId ?? "—";
                const cls = `flex flex-col gap-[3px] border-b border-line2 px-1 py-[6px] text-left last:border-b-0 hover:bg-panel ${on ? "bg-panel" : ""}`;
                const inner = (
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-[2px]">
                    <span className="tabular flex-none font-mono text-[10px] text-t3">{s.nodeId ?? "—"}</span>
                    <span className="min-w-0 text-[12px] font-semibold text-t1 [overflow-wrap:anywhere]">{stepName}</span>
                    {s.app && <span className="flex-none text-[10.5px] text-t3">{s.app}</span>}
                    {s.kind && <span className="flex-none text-[10.5px] text-t3">{s.kind}</span>}
                    {s.status && <span className={`flex-none text-[10.5px] font-semibold ${STATE_TONE[s.status] ?? "text-t3"}`}>{s.status}</span>}
                    {s.bundles != null && <span className="tabular flex-none font-mono text-[10px] text-t3">{s.bundles} bundles</span>}
                    {s.size != null && <span className="tabular flex-none font-mono text-[10px] text-t3">{s.size} B</span>}
                  </span>
                );
                const body = (
                  <>
                    {inner}
                    {/* Never clamped: an error reads in full or not at all. */}
                    {s.warningMessage && <span className="text-[11.5px] leading-[1.45] text-warn-text [overflow-wrap:anywhere]">{s.warningMessage}</span>}
                    {s.errorMessage && <span className="text-[11.5px] leading-[1.45] text-err-text [overflow-wrap:anywhere]">{s.errorMessage}</span>}
                  </>
                );
                if (onStepClick && s.nodeId != null) {
                  return (
                    <button key={`${s.nodeId ?? i}`} type="button" onClick={() => onStepClick(String(s.nodeId))} aria-current={on ? "true" : undefined} className={`${cls} cursor-pointer bg-transparent`}>
                      {body}
                    </button>
                  );
                }
                return (
                  <Link key={`${s.nodeId ?? i}`} href={runReplayHref(row.provider, row.workflowExternalId, row.executionId, s.nodeId)} aria-current={on ? "true" : undefined} className={cls}>
                    {body}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {detail && detail.identifiers.length > 0 && (
          <section>
            <Head title="Identifiers" />
            {/* Kinds and sources only — never a value, never a hash. */}
            <p className="m-0 font-mono text-[11px] leading-[1.5] text-t2 [overflow-wrap:anywhere]">
              {detail.identifiers.map((i) => `${RECORD_KIND_WORD[i.kind] ?? i.kind} · ${i.source}`).join("  ·  ")}
            </p>
          </section>
        )}

        <PayloadSection row={row} platform={platform} state={detail?.payload ?? null} />

        <section>
          <details>
            <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.04em] text-t3 hover:text-t1">Raw JSON</summary>
            <div className="mt-1.5">
              {detail ? (
                <>
                  <div className="mb-1 flex justify-end">
                    <CopyJsonButton data={detail.raw} />
                  </div>
                  <JsonBlock data={detail.raw} />
                </>
              ) : (
                <p className="m-0 text-[11.5px] italic text-t3">{loading ? "Loading" : "Details unavailable"}</p>
              )}
            </div>
          </details>
        </section>

        {failed && <p className="m-0 text-[11.5px] italic text-t3">Details unavailable</p>}
      </div>
  );
}

/** The log's expanded row: the shared body in its own frame under the row. */
export function RunDetail({ row }: { row: RunRow }) {
  return (
    <div className="border-b border-line2 bg-hover px-3 py-3">
      <RunDetailBody row={row} />
    </div>
  );
}

/*
 * The run's input, fetched only when asked for: the platform is called at
 * that moment, the answer is shown once and never stored. When the platform
 * hands back nothing, its own reason is shown rather than an empty block.
 */
function PayloadSection({ row, platform, state }: { row: RunRow; platform: string; state: RunPayloadState | null }) {
  const [payload, setPayload] = useState<ExecutionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // The detail call already said whether this run's input can be fetched at
  // all. Its reason comes from the runtime, so it is shown verbatim rather
  // than replaced with wording of ours.
  const fetchable = state == null || state.available;

  const load = () => {
    setLoading(true);
    setError("");
    fetchExecutionPayload(row.provider, row.workflowExternalId, row.executionId)
      .then(setPayload)
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.status === 429 ? `${platform} is rate-limiting reads` : e instanceof Error && e.message ? e.message : `${platform} did not hand this back`)
      )
      .finally(() => setLoading(false));
  };

  const data = payload?.available ? (payload.request ?? payload.bundle ?? null) : null;

  return (
    <section>
      <Head title="Input" action={data != null ? <CopyJsonButton data={data} /> : undefined} />
      {!fetchable && state?.reason && <p className="m-0 text-[11.5px] italic leading-[1.45] text-t3 [overflow-wrap:anywhere]">{state.reason}</p>}
      {fetchable && !payload && !error && (
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex h-[26px] cursor-pointer items-center rounded-control border border-line px-2.5 text-[11.5px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1 disabled:cursor-default disabled:opacity-60"
        >
          {loading ? "Loading" : "Load input"}
        </button>
      )}
      {error && (
        <p role="alert" className="m-0 text-[11.5px] leading-[1.45] text-err-text [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      {payload && !payload.available && <p className="m-0 text-[11.5px] italic leading-[1.45] text-t3 [overflow-wrap:anywhere]">{payload.reason ?? `${platform} did not hand this back for this run`}</p>}
      {payload?.available && (
        <div className="flex flex-col gap-1.5">
          {payload.request && (
            <p className="m-0 font-mono text-[10.5px] leading-[1.5] text-t3 [overflow-wrap:anywhere]">
              {[payload.request.method, payload.request.url].filter(Boolean).join(" ")}
              {payload.capturedAt ? ` · ${fullTime(payload.capturedAt)}` : ""}
            </p>
          )}
          <JsonBlock data={data} />
          {payload.truncated && <p className="m-0 font-mono text-[10.5px] text-t3">Cut at {payload.bytes != null ? `${payload.bytes} bytes` : "the size cap"}</p>}
          {/* The one note that stays prose: what Rippit does with this. */}
          <p className="m-0 font-mono text-[10.5px] leading-[1.5] text-t3 [overflow-wrap:anywhere]">{payload.note ?? `From ${platform} · shown once, never stored`}</p>
        </div>
      )}
    </section>
  );
}
