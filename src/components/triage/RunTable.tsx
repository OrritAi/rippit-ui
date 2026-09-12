"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { RunRow } from "@/app/lib/api";
import { RunDetail } from "@/components/triage/RunDetail";
import { RUN_TONE, relativeTime } from "@/components/shared/RunsPanel";
import { RowCard } from "@/components/views/ViewFrame";
import { MapTip } from "@/components/workflowMap/MapTip";
import { CONNECTORS } from "@/lib/connectors";
import { formatDuration, fullTime } from "@/lib/triage";
import { runReplayHref } from "@/lib/workflowMap/run";

/*
 * Every stored execution, newest first, one dense row each: when · workflow ·
 * status · duration · ops · error. The whole row is the replay link — it
 * opens the workflow map with `?run=`, which grays what the run did not
 * touch. Error text wraps in full and is never clamped.
 *
 * The record path feeds this same table: a record search returns the runs
 * that carried the identifier, mapped to the same row shape (its index holds
 * no duration, ops or error, so those cells read "—").
 *
 * The chevron at the end of a row expands it: the full record of that run —
 * every step, the identifier kinds it carried, its input on demand, and the
 * raw stored JSON — opens in place, one row at a time. It is a separate
 * control from the row itself, so the row's own click still replays the run
 * on the map.
 */

const GRID = "grid grid-cols-[74px_minmax(140px,1.25fr)_86px_74px_52px_minmax(0,2fr)_50px] items-start gap-x-3";

export function RunTable({
  runs,
  loading,
  error,
  emptyLabel,
  nextCursor,
  loadingMore,
  onLoadMore,
  onRetry,
  footer,
  hint,
}: {
  runs: RunRow[];
  loading: boolean;
  error: string;
  emptyLabel: string;
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  footer?: React.ReactNode;
  /** Optional per-row note ("7/9 steps"). Never fetches anything — it reads
   *  what the session already has, and returns null when there is nothing. */
  hint?: (r: RunRow) => string | null;
}) {
  // Only one run is expanded at a time — a log with several bodies open reads
  // as noise rather than as a list.
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <RowCard>
        {/* The scroll box sits inside the card, so the card keeps its own
            overflow-hidden and its rounded corners clip the header row. */}
        <div className="thin-scroll overflow-x-auto">
          <div className="min-w-[760px]">
            <div className={`${GRID} border-b border-line bg-hover px-3 py-[6px] text-[10px] font-semibold uppercase tracking-[0.04em] text-t3`}>
              <span>Time</span>
              <span>Workflow</span>
              <span>Status</span>
              <span>Duration</span>
              <span>Ops</span>
              <span>Error</span>
              <span className="sr-only">Details</span>
            </div>

            {error ? (
              <div role="alert" className="flex items-center gap-3 px-3 py-6 text-[12.5px] text-err-text">
                <span className="min-w-0 flex-1">{error}</span>
                <button type="button" onClick={onRetry} className="inline-flex h-[26px] flex-none cursor-pointer items-center rounded-control border border-line px-2.5 text-[11.5px] font-semibold text-t2 hover:border-line-strong hover:text-t1">
                  Retry
                </button>
              </div>
            ) : loading && runs.length === 0 ? (
              <div role="status" aria-label="Loading runs" className="flex flex-col gap-1.5 p-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} aria-hidden="true" className="h-[26px] animate-pulse rounded-row bg-hover motion-reduce:animate-none" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] italic text-t3">{emptyLabel}</p>
            ) : (
              runs.map((r) => {
                const rowId = `${r.provider}:${r.workflowExternalId}:${r.executionId}`;
                return (
                  <Row
                    key={rowId}
                    run={r}
                    hint={hint?.(r) ?? null}
                    open={openId === rowId}
                    onToggle={() => setOpenId((cur) => (cur === rowId ? null : rowId))}
                  />
                );
              })
            )}
          </div>
        </div>
      </RowCard>

      {footer}

      {nextCursor && !error && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex h-[28px] cursor-pointer items-center rounded-control border border-line px-3 text-[11.5px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1 disabled:cursor-default disabled:opacity-60"
          >
            {loadingMore ? "Loading" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}

function Row({ run: r, hint, open, onToggle }: { run: RunRow; hint: string | null; open: boolean; onToggle: () => void }) {
  const tone = RUN_TONE[r.status] ?? RUN_TONE.unknown;
  const connector = CONNECTORS[r.provider];
  const platform = connector?.shortLabel ?? r.provider;
  const name = r.workflowName || `${platform} ${r.workflowExternalId}`;
  const err = [r.errorName, r.errorMessage].filter(Boolean).join(" · ");
  const detailId = `run-detail-${r.provider}-${r.workflowExternalId}-${r.executionId}`;

  return (
    <>
      <div className={`${GRID} relative border-b border-line2 px-3 py-[7px] text-[12px] last:border-b-0 hover:bg-hover`}>
        {/* The row is the replay link; the platform link below sits above it. */}
        <Link
          href={runReplayHref(r.provider, r.workflowExternalId, r.executionId)}
          aria-label={`Replay run ${r.executionId} of ${name}`}
          className="absolute inset-0 rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ringc)]"
        />
        <span className="tabular truncate font-mono text-[11px] text-t3" title={fullTime(r.startedAt)}>
          {relativeTime(r.startedAt)}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold text-t1">{name}</span>
          <span className="tabular block truncate font-mono text-[9.5px] text-t3">
            {platform} · {r.executionId}
            {hint ? ` · ${hint}` : ""}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: tone.text }}>
          <span aria-hidden="true" className="size-[5px] flex-none rounded-full" style={{ background: tone.accent }} />
          {tone.label}
        </span>
        <span className="tabular font-mono text-[11px] text-t2">{formatDuration(r.durationMs)}</span>
        <span className="tabular font-mono text-[11px] text-t2">{r.operations ?? "—"}</span>
        {/* Never clamped: an error reads in full or not at all. */}
        <span className="min-w-0 text-[11.5px] leading-[1.45] text-t2 [overflow-wrap:anywhere]">{err || <span className="text-t3">—</span>}</span>
        <span className="flex justify-end gap-0.5">
          {r.nativeUrl && (
            <MapTip label={`Open in ${platform}`}>
              <a
                href={r.nativeUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${name} in ${platform}`}
                className="relative z-[1] inline-flex size-[18px] items-center justify-center rounded-[4px] text-t3 transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-t1"
              >
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </a>
            </MapTip>
          )}
          <MapTip label="Details">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={open ? detailId : undefined}
              aria-label={`Details of run ${r.executionId}`}
              className="relative z-[1] inline-flex size-[18px] cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent text-t3 transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-t1"
            >
              <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform duration-[var(--dur-fast)] ${open ? "rotate-180" : ""}`} />
            </button>
          </MapTip>
        </span>
      </div>
      {open && (
        <div id={detailId}>
          <RunDetail row={r} />
        </div>
      )}
    </>
  );
}
