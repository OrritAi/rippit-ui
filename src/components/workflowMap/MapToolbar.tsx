"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/shared/Segmented";
import type { Layer } from "@/lib/workflowMap/types";
import { MapTip } from "./MapTip";

/*
 * Floating glass toolbar (top-left of the canvas): the filter input, the
 * Overview / Structure / Steps rung control, the Expand all / Collapse all
 * ghost buttons, and the zoom cluster
 * (− · percentage (click = 100 %) · + · Fit). The input is controlled by
 * the shell, which debounces it into the model query. The × at its end
 * folds it to one small icon button in the same corner (the shell persists
 * the choice); while folded with a filter active, the button shows the
 * match count so a hidden filter is never a mystery.
 */
export function MapToolbar({
  query,
  onQuery,
  onExpandAll,
  onCollapseAll,
  layer,
  onLayer,
  withheld,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFit,
  matches,
  collapsed,
  onToggle,
}: {
  query: string;
  onQuery: (q: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  /** Which rung of the ladder is drawn. Independent of zoom, always. */
  layer: Layer;
  onLayer: (l: Layer) => void;
  /** Steps the fold cards are standing for right now. */
  withheld: number;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFit: () => void;
  /** Matching workflows while a filter is typed; null when not filtering. */
  matches: number | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    const filtering = query.trim().length > 0;
    return (
      <MapTip
        label={
          filtering
            ? `Show map tools · filter "${query}" active`
            : "Show map tools"
        }
        side="right"
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            filtering
              ? `Show map tools — filter "${query}" active, ${matches ?? 0} matching`
              : "Show map tools"
          }
          className="wm-rise absolute left-4 top-3 z-[4] inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-card border bg-glass px-2.5 text-t2 shadow-[var(--shadow-float)] backdrop-blur-[14px] transition-colors duration-200 hover:text-t1"
          style={{
            borderColor: filtering
              ? "color-mix(in srgb, var(--map-accent) 45%, transparent)"
              : "var(--line)",
          }}
        >
          <SlidersHorizontal aria-hidden="true" className="size-[14px]" />
          {filtering && (
            <span className="tabular font-mono text-[10.5px] text-map-accent-text">
              {matches ?? 0}
            </span>
          )}
        </button>
      </MapTip>
    );
  }
  return (
    <div className="wm-rise absolute left-4 top-3 z-[4] flex items-center gap-2 rounded-card border border-line bg-glass px-2 py-[7px] shadow-[var(--shadow-float)] backdrop-blur-[14px]">
      <div className="relative">
        <Input
          type="search"
          className={`h-[34px] w-[230px] ${matches != null ? "pr-16" : ""}`}
          placeholder="Filter the map"
          aria-label="Filter the map"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        {matches != null && (
          <span
            aria-live="polite"
            className="tabular pointer-events-none absolute inset-y-0 right-2.5 flex items-center font-mono text-[10.5px] text-t3"
          >
            {matches} match{matches === 1 ? "" : "es"}
          </span>
        )}
      </div>
      <MapTip
        label={
          layer === "macro"
            ? `What this workflow is — ${withheld} steps stand behind these cards`
            : layer === "structure"
              ? withheld > 0
                ? `Every distinct branch drawn once — ${withheld} steps stand behind their patterns`
                : "Every distinct branch drawn once; this workflow repeats nothing"
              : "Every step drawn, however much it repeats"
        }
      >
        <span>
          <Segmented<Layer>
            value={layer}
            onChange={onLayer}
            label="How much of the workflow to draw"
            options={[
              { value: "macro", label: "Overview" },
              { value: "structure", label: "Structure" },
              { value: "steps", label: "Steps" },
            ]}
          />
        </span>
      </MapTip>
      <Button variant="ghost" size="sm" onClick={onExpandAll}>
        Expand all
      </Button>
      <Button variant="ghost" size="sm" onClick={onCollapseAll}>
        Collapse all
      </Button>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
      <MapTip label="Zoom out · −">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onZoomOut}
          aria-label="Zoom out (−)"
        >
          −
        </Button>
      </MapTip>
      <MapTip label="Reset zoom to 100% · 0">
        <button
          type="button"
          onClick={onZoomReset}
          aria-label={`Zoom ${Math.round(zoom * 100)} percent — reset to 100 percent (0)`}
          className="tabular w-[38px] cursor-pointer rounded-control py-1 text-center font-mono text-[10.5px] text-t2 transition-colors hover:bg-hover hover:text-t1"
        >
          {Math.round(zoom * 100)}%
        </button>
      </MapTip>
      <MapTip label="Zoom in · +">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onZoomIn}
          aria-label="Zoom in (+)"
        >
          +
        </Button>
      </MapTip>
      <MapTip label="Fit the whole map in view · F">
        <Button variant="ghost" size="sm" onClick={onFit}>
          Fit
        </Button>
      </MapTip>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-line" />
      <MapTip label="Hide map tools">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          aria-label="Hide map tools"
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </MapTip>
    </div>
  );
}
