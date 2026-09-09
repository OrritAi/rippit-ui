"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Radar } from "lucide-react";
import type { FunnelGraph } from "@/app/lib/api";
import { Button } from "@/components/ui/button";
import { deriveView } from "@/lib/martech/deriveView";
import { layoutMartech } from "@/lib/martech/layout";
import { ago } from "@/lib/time";
import { CoverageChips } from "./CoverageChips";
import { MartechCanvas } from "./MartechCanvas";
import { MartechInspector } from "./MartechInspector";
import { MartechLegend } from "./MartechLegend";

const DOCK_W = 340;

/*
 * MartechView — one funnel as a picture: the view bar (back, name, coverage,
 * native link, capture age), the canvas, the legend and the one dock. The
 * detail page fetches and hands the graph in; the dev preview hands in the
 * fixture. deriveView and layoutMartech are memoised on the graph, so a
 * selection never re-lays the diagram out.
 */
export function MartechView({
  graph,
  backHref = "/martech",
  onDetect,
  detecting = false,
}: {
  graph: FunnelGraph;
  backHref?: string;
  /** Shown on the empty state for manually mapped funnels. */
  onDetect?: () => void;
  detecting?: boolean;
}) {
  const model = useMemo(() => deriveView(graph), [graph]);
  const layout = useMemo(() => layoutMartech(model), [model]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes]);
  // Derived, not synced: a re-derived model (new graph) that no longer holds
  // the selected id simply renders no dock.
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  const close = useCallback(() => setSelectedId(null), []);
  const empty = graph.stages.length === 0;
  const captured = graph.lastCapturedAt ?? graph.funnel.lastCapturedAt ?? null;
  const nativeUrl = graph.funnel.sourceUrl ?? graph.source?.url ?? null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-[46px] flex-none items-center gap-2.5 border-b border-line px-3">
        <Link href={backHref} className="flex size-[26px] flex-none items-center justify-center rounded-control text-t3 transition-colors hover:bg-hover hover:text-t1" aria-label="Back to Martech">
          <ArrowLeft aria-hidden="true" className="size-3.5" />
        </Link>
        <h1 className="min-w-0 truncate text-[13.5px] font-semibold tracking-[-0.01em]" title={graph.funnel.name}>
          {graph.funnel.name}
        </h1>
        {graph.funnel.accountLabel && <span className="hidden truncate text-[11.5px] text-t3 md:inline">{graph.funnel.accountLabel}</span>}
        <div className="flex-1" />
        <CoverageChips coverage={graph.coverage} compact className="hidden lg:inline-flex" />
        <span className="tabular hidden font-mono text-[10.5px] text-t3 sm:inline" title={captured ?? undefined}>
          {captured ? `captured ${ago(captured)}` : "not captured yet"}
        </span>
        {nativeUrl && (
          <a
            href={nativeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-[26px] items-center gap-1 rounded-control border border-line px-2 text-[11px] font-semibold text-t2 transition-colors hover:border-t1 hover:text-t1"
          >
            Open in GHL <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {empty ? (
          <div className="flex h-full items-center justify-center p-4">
            <div className="anim-fade-up max-w-md rounded-card border border-line bg-panel p-6 text-center shadow-[var(--shadow-card)]">
              <h2 className="mb-1.5 text-[15px] font-semibold">Nothing mapped yet</h2>
              <p className="text-[13px] text-t2">
                This funnel has no steps yet. Detection reads the funnel directory and the workflows Rippit has already captured — it never touches GoHighLevel.
              </p>
              {graph.funnel.origin === "manual" && onDetect && (
                <Button onClick={onDetect} disabled={detecting} className="mt-4 h-8 cursor-pointer rounded-control text-[12.5px] font-semibold disabled:opacity-50">
                  <Radar aria-hidden="true" className="size-3.5" />
                  {detecting ? "Detecting…" : "Detect funnels"}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <MartechCanvas model={model} layout={layout} selectedId={selectedId} onSelect={setSelectedId} dockOpen={selected != null} dockWidth={DOCK_W} />
            <div className="absolute bottom-8 left-3 z-[2]">
              <MartechLegend />
            </div>
            {selected && <MartechInspector model={model} node={selected} graph={graph} onClose={close} onSelect={setSelectedId} />}
          </>
        )}
      </div>
    </div>
  );
}
