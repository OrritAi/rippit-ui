"use client";

import type { RunStats } from "@/app/lib/api";
import { compactCount, formatDuration, formatRate, fullTime } from "@/lib/triage";

/*
 * The window's four numbers plus a runs-over-time sparkline. Numbers only —
 * the label under each value carries the meaning, so the strip reads at a
 * glance and adds no prose to the page.
 *
 * The sparkline is one stacked mini-bar per bucket: the run count in the
 * de-emphasis ink, the failed share at the base in the error colour, with a
 * 2px surface gap between the two segments so they never blur into one mark.
 * Two segments means a legend, kept to two words. Exact values live in each
 * bar's hover title rather than on the chart.
 */

function Tile({ label, value, tone }: { label: string; value: string; tone?: "err" }) {
  return (
    <div className="rounded-card border border-line bg-panel px-3 py-2.5">
      {/* Proportional figures: a standalone value is never padded to a column. */}
      <p className={`m-0 text-[19px] font-semibold leading-none tracking-[-0.02em] ${tone === "err" ? "text-err-text" : "text-t1"}`}>{value}</p>
      <p className="m-0 mt-[7px] text-[10.5px] font-semibold leading-none text-t3">{label}</p>
    </div>
  );
}

function TileSkeleton() {
  return (
    <div className="rounded-card border border-line bg-panel px-3 py-2.5" aria-hidden="true">
      <div className="h-[19px] w-[52px] animate-pulse rounded-[4px] bg-hover motion-reduce:animate-none" />
      <div className="mt-[7px] h-[10px] w-[64px] animate-pulse rounded-[3px] bg-hover motion-reduce:animate-none" />
    </div>
  );
}

/** Two-word legend — identity is never colour alone. */
function Key({ swatch, children }: { swatch: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-t3">
      <span aria-hidden="true" className="size-[6px] rounded-[2px]" style={{ background: swatch }} />
      {children}
    </span>
  );
}

function Sparkline({ buckets }: { buckets: RunStats["buckets"] }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const last = buckets.length - 1;
  return (
    <div className="flex h-[34px] items-end gap-[2px]">
      {buckets.map((b, i) => {
        // Shares of the bar, floored so a single run is still a visible mark.
        const h = b.total > 0 ? Math.max(3, Math.round((b.total / max) * 34)) : 1;
        const failed = b.failed > 0 ? Math.max(2, Math.round((b.failed / Math.max(b.total, 1)) * h)) : 0;
        const ok = Math.max(0, h - failed - (failed > 0 ? 2 : 0));
        const when = fullTime(b.at) ?? b.at;
        return (
          <div
            key={`${b.at}-${i}`}
            className="flex min-w-[3px] flex-1 flex-col justify-end gap-[2px]"
            title={`${when} · ${b.total} run${b.total === 1 ? "" : "s"}${b.failed > 0 ? ` · ${b.failed} failed` : ""}`}
          >
            {ok > 0 && (
              <span
                aria-hidden="true"
                className="block rounded-t-[2px]"
                style={{ height: ok, background: i === last ? "var(--t2)" : "color-mix(in srgb, var(--t3) 60%, transparent)" }}
              />
            )}
            {failed > 0 && <span aria-hidden="true" className="block rounded-t-[2px]" style={{ height: failed, background: "var(--err)" }} />}
          </div>
        );
      })}
    </div>
  );
}

export function RunStatStrip({ stats, loading }: { stats: RunStats | null; loading: boolean }) {
  const failed = stats ? (stats.byStatus?.error ?? 0) + (stats.byStatus?.incomplete ?? 0) : 0;
  const buckets = stats?.buckets ?? [];
  return (
    <div className="mb-3 grid gap-2 lg:grid-cols-[repeat(4,minmax(96px,1fr))_minmax(180px,1.4fr)] sm:grid-cols-4">
      {loading && !stats ? (
        <>
          <TileSkeleton />
          <TileSkeleton />
          <TileSkeleton />
          <TileSkeleton />
        </>
      ) : (
        <>
          <Tile label="Runs" value={compactCount(stats?.total ?? null)} />
          <Tile label="Failed" value={compactCount(stats ? failed : null)} tone={failed > 0 ? "err" : undefined} />
          <Tile label="Success rate" value={formatRate(stats?.successRate)} />
          <Tile label="Median duration" value={formatDuration(stats?.medianDurationMs)} />
        </>
      )}
      <div className="rounded-card border border-line bg-panel px-3 py-2.5 sm:col-span-4 lg:col-span-1">
        {buckets.length > 0 ? (
          <>
            <Sparkline buckets={buckets} />
            <div className="mt-[7px] flex items-center gap-2.5 leading-none">
              <Key swatch="color-mix(in srgb, var(--t3) 60%, transparent)">runs</Key>
              <Key swatch="var(--err)">failed</Key>
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-[52px] items-end">
            <p className="m-0 text-[10.5px] font-semibold leading-none text-t3">Runs over time</p>
          </div>
        )}
      </div>
    </div>
  );
}
