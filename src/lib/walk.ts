import type { ExecutionBundles, ExecutionTrace, ModuleInfo } from "@/app/lib/api";
import type { Stage, WalkState } from "@/components/walk/Cube";
import { nodeState, traceNodeFor } from "@/lib/workflowMap/run";

/*
 * The walk's stage list: which cubes stand in the world, in which order, and
 * what each one says about itself.
 *
 * Pure, so it can be checked the way `lib/workflowMap/run.ts` is.
 *
 * Two decisions worth keeping:
 *
 *  - **Every step stands, not only the ones that ran.** A world that hides
 *    the untaken path answers "what happened" but not "what didn't", and the
 *    second is most of why an operator is here. Steps the run missed are
 *    labelled NOT REACHED and stand in place.
 *  - **Execution order beats blueprint order when the run knows it.** The
 *    `events` stream says which module actually started when, which is the
 *    order a person walked through; the blueprint's ordinals are the order it
 *    is drawn. They differ whenever a router runs two routes.
 */

const STATE: Record<string, WalkState> = {
  touched: "cleared",
  warning: "cleared",
  failed: "failed",
  untouched: "skipped",
  unknown: "unknown",
  reached: "cleared",
};

export function stagesFor(
  modules: ModuleInfo[],
  trace: ExecutionTrace | null,
  bundles: ExecutionBundles | null,
): Stage[] {
  const byId = new Map(modules.map((m) => [String(m.id), m]));

  // `moduleStart` order, de-duplicated: a module that ran many times is one
  // stage, at the point it was first entered.
  const started: string[] = [];
  for (const e of bundles?.events ?? []) {
    if (e.kind === "moduleStart" && byId.has(e.nodeId) && !started.includes(e.nodeId)) {
      started.push(e.nodeId);
    }
  }

  const ordered = started.length
    ? [...started, ...modules.map((m) => String(m.id)).filter((id) => !started.includes(id))]
    : modules.map((m) => String(m.id));

  return ordered.flatMap((id, i) => {
    const step = byId.get(id);
    if (!step) return [];
    const tn = trace ? traceNodeFor(trace, id) : null;
    const state: WalkState = tn ? (STATE[nodeState(tn)] ?? "unknown") : trace ? "unknown" : "cleared";
    return [{
      nodeId: id,
      name: step.label || step.summary || `Step ${i + 1}`,
      app: step.app,
      // The blueprint's own ordinal where it has one, so a cube's number
      // matches the canvas; a two-digit fallback keeps the mono line even.
      ordinal: step.ordinal ?? String(i + 1).padStart(2, "0"),
      state,
    }];
  });
}

/** Where to stand when the walk opens: the failing step if there is one, else
 *  the first. Landing on the failure is the whole reason most people press
 *  Walk on a failed run. */
export function openingStage(stages: Stage[]): number {
  const failed = stages.findIndex((s) => s.state === "failed");
  return failed >= 0 ? failed : 0;
}
