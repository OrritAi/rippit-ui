"use client";

import { useEffect, useMemo } from "react";
import type { ExecutionsResponse, LinkMap, ScenarioSummary } from "@/app/lib/api";
import type { WorkflowRef } from "@/lib/portals";
import type { SummaryEntry, WorkflowKey } from "@/lib/workflowMap/types";
import { PROTOTYPE, PROTOTYPE_NOW, big, tall } from "@/lib/workflowMap/fixtures/prototype";
import type { SummaryStore } from "@/lib/workflowMap/summaryStore";
import { useShell } from "@/components/shell/shell-context";
import { WorkflowMapView } from "./WorkflowMap";

/*
 * Client half of /w/preview — the prototype fixture through the real map
 * with a stub store (everything preloaded, `ensure` is a no-op, so nothing
 * touches the network) and a stubbed node-detail loader. `big` renders 300
 * callers to exercise LITE and root windowing.
 */

const noop = () => undefined;

/* The app shell owns the Escape key; the harness has no shell, so it
   forwards Escape to the same stack (sidebar / edge selection close). */
function EscapeBridge() {
  const { fireEscape } = useShell();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fireEscape()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fireEscape]);
  return null;
}

const RUNS: ExecutionsResponse = {
  supported: true,
  fetchedAt: new Date(PROTOTYPE_NOW).toISOString(),
  executions: [
    { executionId: "e1", status: "success", startedAt: new Date(PROTOTYPE_NOW - 27 * 86_400_000).toISOString(), durationMs: 2376, operations: 6, errorName: null, errorMessage: null, causeModuleId: null, meta: {} },
    { executionId: "e2", status: "success", startedAt: new Date(PROTOTYPE_NOW - 28 * 86_400_000).toISOString(), durationMs: 2210, operations: 6, errorName: null, errorMessage: null, causeModuleId: null, meta: {} },
    { executionId: "e3", status: "success", startedAt: new Date(PROTOTYPE_NOW - 29 * 86_400_000).toISOString(), durationMs: 2504, operations: 6, errorName: null, errorMessage: null, causeModuleId: null, meta: {} },
    { executionId: "e4", status: "success", startedAt: new Date(PROTOTYPE_NOW - 30 * 86_400_000).toISOString(), durationMs: 2333, operations: 6, errorName: null, errorMessage: null, causeModuleId: null, meta: {} },
  ],
};

/** A real workflow neighbourhood exported from the API (`/links` + `/workflows/summaries`). */
export interface MapSnapshot {
  viewed: WorkflowRef;
  linkMap: LinkMap;
  summaries: Record<string, ScenarioSummary | { error: string; stepsUnavailable?: boolean }>;
}

function fromSnapshot(snap: MapSnapshot) {
  const summaries = new Map<WorkflowKey, SummaryEntry>();
  for (const [k, v] of Object.entries(snap.summaries)) {
    const key = k as WorkflowKey;
    if ("modules" in v) summaries.set(key, { state: "ok", summary: v });
    else summaries.set(key, { state: "error", error: v.error });
  }
  return { viewed: snap.viewed, linkMap: snap.linkMap, summaries };
}

export function WorkflowMapPreview({ big: isBig, tall: tallN = 0, snapshot = null }: { big: boolean; tall?: number; snapshot?: MapSnapshot | null }) {
  const fixture = useMemo(() => (snapshot ? fromSnapshot(snapshot) : isBig ? big(300) : tallN > 0 ? tall(tallN) : PROTOTYPE), [isBig, tallN, snapshot]);
  const store = useMemo<SummaryStore>(
    () => ({ summaries: fixture.summaries, version: 0, ensure: noop, reseed: noop, evictNeighbours: noop, invalidate: noop }),
    [fixture]
  );
  useEffect(() => {
    document.title = "Workflow Map preview — Rippit";
  }, []);
  return (
    <div className="flex h-full min-w-0 flex-col">
      <EscapeBridge />
      <WorkflowMapView
        viewed={fixture.viewed}
        linkMap={fixture.linkMap}
        store={store}
        runs={RUNS}
        fetchDetail={() => Promise.resolve(null)}
        now={PROTOTYPE_NOW}
      />
    </div>
  );
}
