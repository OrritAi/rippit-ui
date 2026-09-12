"use client";

import { Activity, X } from "lucide-react";
import type { RunRow } from "@/app/lib/api";
import { RunDetailBody } from "@/components/triage/RunDetail";
import { MapTip } from "@/components/workflowMap/MapTip";

/*
 * The replayed run in the map's right slot — the same sections the log's
 * expanded row shows, rendered through the one `RunDetailBody`. Here a step
 * selects and centres its node on the canvas instead of navigating, and the
 * step being looked at is marked.
 *
 * It is the lowest-priority occupant of the slot: a selected node or a
 * selected connection replaces it, and closing that brings it back while
 * the run is still replayed. Closing the panel itself only closes the panel
 * — the run stays replayed, the map stays dimmed, and the banner's control
 * brings it back.
 */
export function RunPanel({
  row,
  shortId,
  selectedStepId,
  onStepClick,
  onClose,
}: {
  row: RunRow;
  shortId: string;
  selectedStepId: string | null;
  onStepClick: (nodeId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[46px] flex-none items-center gap-2 border-b border-line px-3">
        <Activity aria-hidden="true" className="size-3.5 flex-none text-triage" />
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold leading-tight">Run</span>
          <span className="tabular block font-mono text-[9.5px] text-t3 [overflow-wrap:anywhere]" title={row.executionId}>
            {shortId}
          </span>
        </span>
        <div className="flex-1" />
        <MapTip label="Close" side="left">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the run panel"
            className="inline-flex size-[22px] flex-none cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-t3 transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-t1"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </MapTip>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <RunDetailBody row={row} onStepClick={onStepClick} selectedStepId={selectedStepId} />
      </div>
    </div>
  );
}
