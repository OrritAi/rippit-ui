"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { RunRow, RunStatus } from "@/app/lib/api";
import { RUN_TONE, relativeTime } from "@/components/shared/RunsPanel";
import { MapTip } from "@/components/workflowMap/MapTip";
import { formatDuration, fullTime, isRunStatus, runStepsRatio } from "@/lib/triage";
import { CHIP_STATUSES, type RunHistory } from "./useRunHistory";

/*
 * Level 1 of the history surface: one workflow's whole run history, filling
 * the body. A row per stored execution, newest first, numbered within
 * whatever the status chips have narrowed it to. Clicking a row navigates to
 * level 2 — that run on the canvas.
 *
 * It gets the entire screen on purpose. A permanent bottom split holding this
 * table was built and rejected: it halved the canvas and left both halves
 * hard to read. So did a horizontal strip of run cards and a vertical rail of
 * status ticks down the canvas edge. Two full-height levels beat any attempt
 * to show both at once, and the switcher at level 2 (`RunSwitcher.tsx`) is
 * what keeps the trip back cheap.
 *
 * Read-only throughout, like everything in the triage layer: it reports what
 * already ran and can neither start, retry nor stop anything.
 */

const SIZES = [20, 50, 100] as const;
const DEFAULT_SIZE = 20;
/** Verbatim from the design: #, when, status, duration, steps, ops, error,
 *  and the id + Walk cluster that closes the row. */
const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "46px 84px 96px 74px 66px 52px minmax(0,1.6fr) 108px",
  alignItems: "center",
  gap: "0 12px",
};
const CHIP = "cursor-pointer rounded-full border px-2.5 py-[3px] text-[11px] font-semibold transition-colors duration-[var(--dur-fast)]";
const CHIP_ON = "border-t1 bg-t1 text-bg";
const CHIP_OFF = "border-line text-t2 hover:border-line-strong hover:text-t1";
const PAGE_BTN = "cursor-pointer rounded-control px-[7px] py-[3px] font-mono text-[10.5px] transition-colors duration-[var(--dur-fast)]";
const STEP_BTN =
  "inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-control border border-line bg-transparent text-t2 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1 disabled:cursor-default disabled:opacity-40";

export function RunList({
  history,
  activeRunId,
  onPick,
  onWalk,
}: {
  /** Fetched once by the page and shared with the level-2 switcher, so the
   *  two agree on counts by construction rather than by running identical
   *  code twice — and switching level never re-hits the network. */
  history: RunHistory;
  /** The run open at level 2, when the reader came back from one. */
  activeRunId: string | null;
  /** Open this run on the canvas — level 2 (the host writes `?run=`). */
  onPick: (executionId: string) => void;
  /** Walk this run in first person. */
  onWalk?: (executionId: string) => void;
}) {
  const searchParams = useSearchParams();
  const { rows: all, counts, truncated, loading, error, unsupported, retry } = history;

  /* page / size / status live in the URL so a log view is a link, and in
     state so paging never re-runs the route. Same replaceState the canvas
     uses for `?step=` and `?run=`: a click through pages is not history. */
  const [status, setStatus] = useState<RunStatus | null>(() => (isRunStatus(searchParams.get("status")) ? (searchParams.get("status") as RunStatus) : null));
  const [size, setSize] = useState<number>(() => {
    const n = Number(searchParams.get("size"));
    return (SIZES as readonly number[]).includes(n) ? n : DEFAULT_SIZE;
  });
  const [page, setPage] = useState<number>(() => Math.max(1, Number(searchParams.get("page")) || 1));

  const writeParams = useCallback((next: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(next)) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  const pickStatus = useCallback(
    (s: RunStatus | null) => {
      setStatus(s);
      setPage(1);
      writeParams({ status: s, page: null });
    },
    [writeParams]
  );
  const pickSize = useCallback(
    (n: number) => {
      setSize(n);
      setPage(1);
      writeParams({ size: n === DEFAULT_SIZE ? null : String(n), page: null });
    },
    [writeParams]
  );
  const goPage = useCallback(
    (n: number) => {
      setPage(n);
      writeParams({ page: n === 1 ? null : String(n) });
    },
    [writeParams]
  );

  const rows = useMemo(() => (status ? all.filter((r) => r.status === status) : all), [all, status]);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  const numbers: number[] = [];
  for (let p = Math.max(1, current - 2); p <= Math.min(pages, current + 2); p++) numbers.push(p);

  const more = truncated ? "+" : "";
  const range = total ? `showing ${start + 1}–${Math.min(start + size, total)} of ${total}${more} runs` : loading ? "loading" : "no runs stored";

  return (
    <section aria-label="Run list" className="flex min-h-0 flex-1 flex-col bg-panel">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-6 py-3.5">
        <span className="text-[14px] font-bold">Runs</span>
        <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
          <Chip on={status === null} count={all.length} onClick={() => pickStatus(null)}>
            all
          </Chip>
          {CHIP_STATUSES.map((s) => (
            <Chip key={s} on={status === s} count={counts[s] ?? 0} onClick={() => pickStatus(status === s ? null : s)}>
              {RUN_TONE[s].label}
            </Chip>
          ))}
        </div>
        <div className="flex-1" />
        <span className="tabular font-mono text-[10px] text-t3">{range}</span>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-auto">
        <div className="min-w-[860px]">
          {/* Column heads are the one place uppercase stays (copy diet §3.10). */}
          <div style={GRID} className="sticky top-0 z-[1] border-b border-line bg-code px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-t3">
            <span>#</span>
            <span>When</span>
            <span>Status</span>
            <span>Duration</span>
            <span>Steps</span>
            <span>Ops</span>
            <span>Error</span>
            <span className="sr-only">Run</span>
          </div>

          {error ? (
            <div role="alert" className="flex items-center gap-3 px-4 py-6 text-[12.5px] text-err-text">
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                onClick={retry}
                className="inline-flex h-[26px] flex-none cursor-pointer items-center rounded-control border border-line px-2.5 text-[11.5px] font-semibold text-t2 hover:border-line-strong hover:text-t1"
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div role="status" aria-label="Loading runs" className="flex flex-col gap-1.5 p-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} aria-hidden="true" className="h-[26px] animate-pulse rounded-row bg-hover motion-reduce:animate-none" />
              ))}
            </div>
          ) : unsupported ? (
            <p className="m-0 px-4 py-7 text-center text-[12.5px] italic text-t3">{unsupported}</p>
          ) : total === 0 ? (
            <p className="m-0 px-4 py-7 text-center text-[12.5px] italic text-t3">{status ? "No runs match this filter." : "No runs stored yet."}</p>
          ) : (
            slice.map((r, i) => <Row key={r.executionId} run={r} num={start + i + 1} active={r.executionId === activeRunId} onPick={onPick} onWalk={onWalk} />)
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-[9px]">
        <span className="tabular font-mono text-[10px] text-t3">rows</span>
        {SIZES.map((n) => (
          <button key={n} type="button" onClick={() => pickSize(n)} aria-pressed={size === n} aria-label={`${n} rows per page`} className={`${CHIP} ${size === n ? CHIP_ON : CHIP_OFF}`}>
            {n}
          </button>
        ))}
        <div className="flex-1" />
        <span className="tabular font-mono text-[10px] text-t3">
          page {current} / {pages}
        </span>
        <button type="button" onClick={() => goPage(Math.max(1, current - 1))} disabled={current <= 1} aria-label="Previous page" className={STEP_BTN}>
          <ChevronLeft aria-hidden="true" className="size-3" />
        </button>
        {numbers.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => goPage(p)}
            aria-label={`Page ${p}`}
            aria-current={p === current ? "page" : undefined}
            className={`${PAGE_BTN} min-w-[26px] border ${p === current ? "border-t1 bg-t1 text-bg" : "border-line text-t2 hover:border-line-strong hover:text-t1"}`}
          >
            {p}
          </button>
        ))}
        <button type="button" onClick={() => goPage(Math.min(pages, current + 1))} disabled={current >= pages} aria-label="Next page" className={STEP_BTN}>
          <ChevronRight aria-hidden="true" className="size-3" />
        </button>
      </div>
    </section>
  );
}

function Chip({ on, count, onClick, children }: { on: boolean; count: number; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={`${children} — ${count} runs`} className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}>
      {children} <span className="tabular font-mono opacity-70">{count}</span>
    </button>
  );
}

function Row({ run: r, num, active, onPick, onWalk }: { run: RunRow; num: number; active: boolean; onPick: (id: string) => void; onWalk?: (id: string) => void }) {
  const tone = RUN_TONE[r.status] ?? RUN_TONE.unknown;
  const err = [r.errorName, r.errorMessage].filter(Boolean).join(" · ");
  const steps = runStepsRatio(r);

  return (
    <div
      style={{ ...GRID, borderLeftColor: active ? "var(--map-accent)" : "transparent" }}
      className={`relative border-b border-l-2 border-line2 px-3.5 py-[9px] text-[12px] ${active ? "bg-hover" : "hover:bg-hover"}`}
    >
      {/* The row is the control; the Walk button sits above it. */}
      <button
        type="button"
        onClick={() => onPick(r.executionId)}
        aria-label={`Light run ${r.executionId} on the map`}
        aria-pressed={active}
        className="absolute inset-0 cursor-pointer rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ringc)]"
      />
      <span className="tabular font-mono text-[10.5px] text-t3">{num}</span>
      <span className="tabular truncate font-mono text-[10.5px] text-t3" title={fullTime(r.startedAt)}>
        {relativeTime(r.startedAt)}
      </span>
      <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: tone.text }}>
        <span aria-hidden="true" className="size-[5px] flex-none rounded-full" style={{ background: tone.accent }} />
        {tone.label}
      </span>
      <span className="tabular font-mono text-[11px] text-t2">{formatDuration(r.durationMs)}</span>
      <span className="tabular font-mono text-[11px] text-t2">{steps ?? "—"}</span>
      <span className="tabular font-mono text-[11px] text-t2">{r.operations ?? "—"}</span>
      {/* One line here; the run panel on the canvas carries it in full. */}
      <span className={`min-w-0 truncate text-[11.5px] ${err ? "text-t2" : "text-t3"}`} title={err || undefined}>
        {err || "—"}
      </span>
      <span className="flex items-center justify-end gap-1.5">
        <span className="tabular min-w-0 truncate font-mono text-[9.5px] text-t3" title={r.executionId}>
          {r.executionId}
        </span>
        {/* TODO(phase 7): `onWalk` starts the first-person walk. Inert until then. */}
        <MapTip label="Walk this run in first person">
          <button
            type="button"
            onClick={() => onWalk?.(r.executionId)}
            aria-label={`Walk run ${r.executionId} in first person`}
            className="relative z-[1] inline-flex flex-none cursor-pointer items-center gap-1 rounded-full border border-line-strong px-[7px] py-px text-[10px] font-semibold text-t1 transition-colors duration-[var(--dur-fast)] hover:bg-hover"
          >
            <Play aria-hidden="true" className="size-[9px]" />
            Walk
          </button>
        </MapTip>
      </span>
    </div>
  );
}

/** Every retained run for one workflow, newest first. Three pages of 200 is
 *  the whole log at today's retention; a fourth would exist only if
 *  retention were raised past 600, and the caller says `N+` rather than
 *  quietly reporting a partial count as a complete one. */

