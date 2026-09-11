"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { ApiError, fetchExecutions, fetchRuns, type RunRow, type RunStatus, type RunWindow } from "@/app/lib/api";
import { useConnections, useWorkflowIndex } from "@/components/app/ConnectionsProvider";
import { AppPuck } from "@/components/shared/AppPuck";
import { RunFilters } from "@/components/triage/RunFilters";
import { RunTable } from "@/components/triage/RunTable";
import { ViewBar, ViewBody } from "@/components/views/ViewFrame";
import { MapTip } from "@/components/workflowMap/MapTip";
import { getConnector, isProviderId } from "@/lib/connectors";
import { DEFAULT_WINDOW, executionToRow, isRunStatus, isRunWindow, runStepsHint, withinWindow } from "@/lib/triage";

/*
 * One workflow's run log — the same runs /triage aggregates, scoped to this
 * workflow and reached from the History icon in its header. Same table, same
 * columns, same chips; no record search, because there is only one workflow
 * to search within. A row opens the map with `?run=`, which is what highlights
 * the path the run took and grays the rest. Read-only throughout: the log
 * reports what already ran and can neither start nor retry anything.
 *
 * Rows come from `/runs` filtered to this workflow. Where that endpoint is not
 * up yet it falls back to the per-workflow executions endpoint, which answers
 * the same runs without a cursor.
 */
const PAGE = 50;

interface LogResult {
  key: string;
  rows: RunRow[];
  next: string | null;
  error: string;
  unsupported: string | null;
}

export default function WorkflowHistoryPage({ params }: { params: Promise<{ provider: string; id: string }> }) {
  const { provider, id } = use(params);
  if (!isProviderId(provider)) notFound();
  const connector = getConnector(provider);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { linkMap } = useConnections();
  const index = useWorkflowIndex();

  const status: RunStatus | null = isRunStatus(searchParams.get("status")) ? (searchParams.get("status") as RunStatus) : null;
  const win: RunWindow = isRunWindow(searchParams.get("window")) ? (searchParams.get("window") as RunWindow) : DEFAULT_WINDOW;

  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LogResult | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const runKey = `${status ?? ""}|${win}|${attempt}`;
  const fresh = result?.key === runKey ? result : null;
  const loading = !fresh;

  const card = useMemo(() => linkMap?.workflows.find((w) => w.source === provider && w.refId === id) ?? null, [linkMap, provider, id]);
  const entry = useMemo(() => index.find((w) => w.provider === provider && w.refId === id) ?? null, [index, provider, id]);
  const name = card?.name ?? entry?.name ?? `${connector.shortLabel} ${id}`;
  const nativeUrl = card?.nativeUrl ?? null;
  const workflowHref = `/w/${provider}/${encodeURIComponent(id)}`;

  const ctx = useMemo(() => ({ provider, workflowExternalId: id, workflowName: card?.name ?? entry?.name ?? null, nativeUrl }), [provider, id, card, entry, nativeUrl]);

  useEffect(() => {
    document.title = `${name} — History — Rippit`;
  }, [name]);

  useEffect(() => {
    let live = true;
    fetchRuns({ provider, workflow: id, status, window: win, limit: PAGE })
      .then((d) => live && setResult({ key: runKey, rows: d.runs, next: d.nextCursor, error: "", unsupported: null }))
      .catch(() =>
        // `/runs` is not up yet (or refused this query): the per-workflow
        // endpoint answers the same runs, unwindowed and unpaged.
        fetchExecutions(provider, id)
          .then((d) => {
            if (!live) return;
            // The fallback endpoint takes neither a status nor a window, so
            // both chips are applied here — they never read as inert.
            const rows = d.supported
              ? d.executions.filter((e) => (!status || e.status === status) && withinWindow(e.startedAt, win)).map((e) => executionToRow(e, ctx))
              : [];
            setResult({ key: runKey, rows, next: null, error: "", unsupported: d.supported ? null : (d.reason ?? `${connector.shortLabel} exposes no run history`) });
          })
          .catch((e: unknown) => live && setResult({ key: runKey, rows: [], next: null, error: readError(e), unsupported: null }))
      );
    return () => {
      live = false;
    };
  }, [runKey, provider, id, status, win, ctx, connector.shortLabel]);

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const s = p.toString();
      router.replace(s ? `${workflowHref}/history?${s}` : `${workflowHref}/history`, { scroll: false });
    },
    [router, searchParams, workflowHref]
  );

  const loadMore = useCallback(() => {
    if (!fresh?.next || loadingMore) return;
    setLoadingMore(true);
    fetchRuns({ provider, workflow: id, status, window: win, limit: PAGE, cursor: fresh.next })
      .then((d) => setResult((prev) => (prev?.key === runKey ? { ...prev, rows: [...prev.rows, ...d.runs], next: d.nextCursor } : prev)))
      .catch((e: unknown) => setResult((prev) => (prev?.key === runKey ? { ...prev, error: readError(e) } : prev)))
      .finally(() => setLoadingMore(false));
  }, [fresh, loadingMore, runKey, provider, id, status, win]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="History">
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
        {/* Which workflow this log belongs to, and the way back to its map. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Link
            href={workflowHref}
            aria-label={`Back to ${name}`}
            className="inline-flex size-[26px] flex-none items-center justify-center rounded-control border border-line text-t3 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1"
          >
            <ArrowLeft aria-hidden="true" className="size-[13px]" />
          </Link>
          <AppPuck app={provider} size={24} />
          <Link href={workflowHref} className="min-w-0 text-[15px] font-bold tracking-[-0.01em] text-t1 underline-offset-4 [overflow-wrap:anywhere] hover:underline">
            {name}
          </Link>
        </div>

        <RunFilters status={status} onStatus={(s) => setParams({ status: s })} window={win} onWindow={(w) => setParams({ window: w === DEFAULT_WINDOW ? null : w })} />

        <RunTable
          runs={fresh?.rows ?? []}
          loading={loading}
          error={fresh?.error ?? ""}
          emptyLabel={fresh?.unsupported ?? "No runs in this window"}
          nextCursor={fresh?.next ?? null}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onRetry={() => setAttempt((a) => a + 1)}
          hint={runStepsHint}
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
