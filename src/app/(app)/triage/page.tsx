"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import {
  ApiError,
  fetchRunStats,
  fetchRuns,
  searchRecords,
  type RecordKind,
  type RecordRuns,
  type RunRow,
  type RunStats,
  type RunStatus,
  type RunWindow,
} from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { RunFilters } from "@/components/triage/RunFilters";
import { RunStatStrip } from "@/components/triage/RunStatStrip";
import { RunTable } from "@/components/triage/RunTable";
import { ViewBar, ViewBody } from "@/components/views/ViewFrame";
import { MapTip } from "@/components/workflowMap/MapTip";
import { recordKindOf } from "@/lib/records";
import { DEFAULT_WINDOW, isRunStatus, isRunWindow, recordRunToRow, runStepsHint } from "@/lib/triage";

/*
 * Triage — the run explorer. Every stored execution across every connection,
 * filtered by status, workflow, time window, or the record that went through
 * it, over a stat strip for the selected window. A row opens the workflow map
 * with `?run=`, which replays that execution. The layer only ever reads what
 * already ran; nothing here starts, stops or retries a run.
 *
 * Filters live in the URL, so a view is a link — and `?q=` is also how the
 * action hub deep-links a record here. A query that reads as a record
 * (email / phone / id) goes to the identifier index, which answers with the
 * runs that carried it plus the scenarios that cannot be searched that way;
 * anything else goes to the run index with the filters applied. Both land in
 * the same table.
 *
 * Both reads are keyed by the request they answer, so an answer in flight
 * when the filters change is never painted under the new ones, and the page
 * derives "loading" from that key rather than setting it inside an effect.
 */
const PAGE = 50;

interface RunResult {
  key: string;
  rows: RunRow[];
  next: string | null;
  recs: RecordRuns["recommendations"];
  kind: RecordKind | null;
  error: string;
}

export default function TriagePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { linkMap } = useConnections();

  const status: RunStatus | null = isRunStatus(searchParams.get("status")) ? (searchParams.get("status") as RunStatus) : null;
  const win: RunWindow = isRunWindow(searchParams.get("window")) ? (searchParams.get("window") as RunWindow) : DEFAULT_WINDOW;
  const wf = searchParams.get("wf");
  const q = (searchParams.get("q") ?? "").trim();
  const localKind = recordKindOf(q);
  const isRecord = localKind !== null;

  // Bumped by the refresh control: re-reads both queries, and asks the
  // identifier index to pull new runs from the platform first.
  const [attempt, setAttempt] = useState(0);
  const runKey = `${status ?? ""}|${wf ?? ""}|${win}|${q}|${attempt}`;
  const statsKey = `${win}|${attempt}`;

  const [result, setResult] = useState<RunResult | null>(null);
  const [statsResult, setStatsResult] = useState<{ key: string; stats: RunStats | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fresh = result?.key === runKey ? result : null;
  const rows = fresh?.rows ?? [];
  const error = fresh?.error ?? "";
  const loading = !fresh;
  const stats = statsResult?.key === statsKey ? statsResult.stats : null;
  const statsLoading = statsResult?.key !== statsKey;

  const [provider, workflow] = useMemo<[ProviderId | null, string | null]>(
    () => (wf && wf.includes(":") ? [wf.slice(0, wf.indexOf(":")) as ProviderId, wf.slice(wf.indexOf(":") + 1)] : [null, null]),
    [wf]
  );

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const s = p.toString();
      router.replace(s ? `/triage?${s}` : "/triage", { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    document.title = q ? `${q} — Triage — Rippit` : "Triage — Rippit";
  }, [q]);

  /* The window's numbers. A stats outage leaves the tiles at "—" rather than
     taking the table down with it. */
  useEffect(() => {
    let live = true;
    fetchRunStats(win)
      .then((d) => live && setStatsResult({ key: statsKey, stats: d }))
      .catch(() => live && setStatsResult({ key: statsKey, stats: null }));
    return () => {
      live = false;
    };
  }, [win, statsKey]);

  /* The rows. */
  useEffect(() => {
    let live = true;
    const load = isRecord
      ? searchRecords(q, attempt > 0).then((d) => ({
          rows: d.runs.map(recordRunToRow),
          next: null as string | null,
          recs: d.recommendations,
          kind: d.kinds?.[0] ?? null,
        }))
      : fetchRuns({ status, provider, workflow, q: q || null, window: win, limit: PAGE }).then((d) => ({
          rows: d.runs,
          next: d.nextCursor,
          recs: undefined,
          kind: d.record?.kind ?? null,
        }));

    load
      .then((r) => live && setResult({ key: runKey, ...r, error: "" }))
      .catch((e: unknown) => live && setResult({ key: runKey, rows: [], next: null, recs: undefined, kind: null, error: readError(e) }));
    return () => {
      live = false;
    };
  }, [runKey, isRecord, q, status, provider, workflow, win, attempt]);

  const loadMore = useCallback(() => {
    if (!fresh?.next || loadingMore) return;
    setLoadingMore(true);
    fetchRuns({ status, provider, workflow, q: q || null, window: win, limit: PAGE, cursor: fresh.next })
      .then((d) => setResult((prev) => (prev?.key === runKey ? { ...prev, rows: [...prev.rows, ...d.runs], next: d.nextCursor } : prev)))
      .catch((e: unknown) => setResult((prev) => (prev?.key === runKey ? { ...prev, error: readError(e) } : prev)))
      .finally(() => setLoadingMore(false));
  }, [fresh, loadingMore, runKey, status, provider, workflow, q, win]);

  const workflows = useMemo(() => [...(linkMap?.workflows ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [linkMap]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="Triage">
        <MapTip label="Refresh">
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            disabled={loading}
            aria-label="Refresh runs"
            className="inline-flex size-[26px] cursor-pointer items-center justify-center rounded-control border border-line text-t2 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1 disabled:cursor-default disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`size-3 ${loading ? "spin motion-reduce:animate-none" : ""}`} />
          </button>
        </MapTip>
      </ViewBar>
      <ViewBody>
        <RunStatStrip stats={stats} loading={statsLoading} />

        <RunFilters
          status={status}
          onStatus={(s) => setParams({ status: s })}
          workflow={wf}
          onWorkflow={(v) => setParams({ wf: v })}
          workflows={workflows}
          window={win}
          onWindow={(w) => setParams({ window: w === DEFAULT_WINDOW ? null : w })}
          q={q}
          onQuery={(v) => setParams({ q: v || null })}
          recordKind={fresh?.kind ?? localKind}
        />

        <RunTable
          runs={rows}
          loading={loading}
          error={error}
          emptyLabel={isRecord ? "No runs for that record" : "No runs in this window"}
          nextCursor={fresh?.next ?? null}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onRetry={() => setAttempt((a) => a + 1)}
          hint={runStepsHint}
          footer={<RunNameNudge recommendations={fresh?.recs} />}
        />
      </ViewBody>
    </div>
  );
}

function readError(e: unknown): string {
  if (e instanceof ApiError && e.status === 429) return "Rate limited — try again in a minute";
  if (e instanceof Error && e.message) return e.message;
  return "Could not load runs";
}

/*
 * Scenarios whose runs carry no identifier to match — no webhook payload and
 * no identifying run name. One line under the table; the fix (Make's
 * Customize Run Name module) sits in the tooltip, and it is the user's to
 * make: Rippit never edits a scenario.
 */
function RunNameNudge({ recommendations }: { recommendations: RecordRuns["recommendations"] }) {
  if (!recommendations || recommendations.length === 0) return null;
  return (
    <p className="m-0 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11.5px] text-t3">
      <MapTip label="Add Make's Customize Run Name module to these scenarios to make their runs searchable by record">
        <button type="button" className="cursor-help border-0 bg-transparent p-0 font-sans text-[11.5px] font-semibold text-t3">
          Not searchable by record
        </button>
      </MapTip>
      {recommendations.map((r) => (
        <Link key={`${r.provider}:${r.workflowExternalId}`} href={`/w/${r.provider}/${r.workflowExternalId}`} className="text-t2 underline-offset-4 [overflow-wrap:anywhere] hover:text-t1 hover:underline">
          {r.workflowName ?? r.workflowExternalId}
        </Link>
      ))}
    </p>
  );
}
