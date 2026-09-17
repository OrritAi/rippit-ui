"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExecutionsResponse, ExecutionTrace, LinkMap, ScenarioSummary, WorkflowShapes } from "@/app/lib/api";
import type { WorkflowRef } from "@/lib/portals";
import type { SummaryEntry, WorkflowKey } from "@/lib/workflowMap/types";
import { COLLAPSE, COLLAPSE_SHAPES, PROTOTYPE, PROTOTYPE_NOW, PROTOTYPE_PAYLOAD, PROTOTYPE_RELATED_TRACE, PROTOTYPE_RUN, PROTOTYPE_TRACE, big, tall } from "@/lib/workflowMap/fixtures/prototype";
import type { SummaryStore } from "@/lib/workflowMap/summaryStore";
import { useShell } from "@/components/shell/shell-context";
import { WorkflowMapView } from "./WorkflowMap";

/*
 * Client half of /w/preview — the prototype fixture through the real map
 * with a stub store (everything preloaded, `ensure` is a no-op, so nothing
 * touches the network) and a stubbed node-detail loader. `big` renders 300
 * A snapshot uses its OWN shapes when it was exported with them and none
 * otherwise; the harness root carries `data-plan="served" | "graph"` so a
 * geometry checker can assert which fold plan it is actually looking at.
 * `big` renders 300
 * callers to exercise LITE and root windowing; `shapes` renders the 119-step
 * GoHighLevel workflow with its nine-outcome router, so the fold cards and
 * the ×4 group card can be looked at; `run` replays PROTOTYPE_TRACE
 * over PROTOTYPE_RUN (dimmed branch, failed ring, unchecked module, reached
 * pill) with a stubbed input loader, so geometry checks cover the overlay.
 * The related run of make:913 (PROTOTYPE_RELATED_TRACE) is handed over as
 * already fetched: unfold that pill to see its steps coloured too.
 */

const noop = () => undefined;
const RELATED: ReadonlyMap<string, ExecutionTrace> = new Map([[PROTOTYPE_RELATED_TRACE.execution!.executionId, PROTOTYPE_RELATED_TRACE]]);

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
  runtime: { trace: true, payload: "entry-only", identifiers: true },
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
  /** The viewed workflow's `GET …/shapes` body, if it was exported with one.
   *  Without it the canvas folds from the graph alone — a legitimate path to
   *  test, but NOT the one real data normally takes, so `data-plan` on the
   *  harness root says which is in force rather than leaving it to be
   *  guessed from the shape of the output. */
  shapes?: WorkflowShapes;
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

export function WorkflowMapPreview({ big: isBig, tall: tallN = 0, snapshot = null, run = false, shapes = false }: { big: boolean; tall?: number; snapshot?: MapSnapshot | null; run?: boolean; shapes?: boolean }) {
  const fixture = useMemo(
    () => (snapshot ? fromSnapshot(snapshot) : shapes ? COLLAPSE : isBig ? big(300) : tallN > 0 ? tall(tallN) : run ? PROTOTYPE_RUN : PROTOTYPE),
    [isBig, tallN, snapshot, run, shapes],
  );
  /* A snapshot brings its own, or none. Never the fixture's: that element
     tree is keyed to the fixture's workflow, so handing it to a snapshot
     silently drops to the graph fallback while looking like the real thing. */
  const shapeGroups: WorkflowShapes | null = snapshot ? (snapshot.shapes ?? null) : shapes ? COLLAPSE_SHAPES : null;
  /* Esc (with nothing else open) clears the replay, as the real page does;
     a change of `run` re-seeds it (state-from-props, no effect). */
  const [trace, setTrace] = useState<ExecutionTrace | null>(run ? PROTOTYPE_TRACE : null);
  const [traceFor, setTraceFor] = useState(run);
  if (traceFor !== run) {
    setTraceFor(run);
    setTrace(run ? PROTOTYPE_TRACE : null);
  }
  const store = useMemo<SummaryStore>(
    () => ({ summaries: fixture.summaries, version: 0, ensure: noop, reseed: noop, evictNeighbours: noop, invalidate: noop }),
    [fixture]
  );
  useEffect(() => {
    document.title = "Workflow Map preview — Orrit";
  }, []);
  return (
    <div className="flex h-full min-w-0 flex-col" data-plan={shapeGroups ? "served" : "graph"}>
      <EscapeBridge />
      <WorkflowMapView
        viewed={fixture.viewed}
        linkMap={fixture.linkMap}
        store={store}
        runs={RUNS}
        fetchDetail={() => Promise.resolve(null)}
        now={PROTOTYPE_NOW}
        shapes={shapeGroups}
        run={trace}
        onClearRun={() => setTrace(null)}
        onLoadPayload={() => new Promise((resolve) => setTimeout(() => resolve(PROTOTYPE_PAYLOAD), 300))}
        relatedTraces={trace ? RELATED : null}
      />
    </div>
  );
}
