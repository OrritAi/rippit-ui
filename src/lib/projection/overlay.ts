import type { ExecutionTrace, Projection } from "@/app/lib/api";

/*
 * A projection, in the shape the run overlay already speaks.
 *
 * The engine's output was designed to be structurally an `ExecutionTrace` for
 * exactly this reason: `runStates`, `dimNodeIds`, `failedNodeIds` and every
 * `data-run` rule in the canvas keep working, so a projected path lights up
 * through the same code that lights a recorded one. Nothing in
 * `lib/workflowMap/run.ts` had to change to support it, and nothing should.
 *
 * The adapter is deliberately thin, and what it *drops* is the point:
 *
 *  - `status` is null on every node. A projection has no success or failure —
 *    those words mean a run happened. Only the recorded overlay ever rings a
 *    node in `--err`.
 *  - `entry.payloadAvailable` is false. There is no recorded request behind a
 *    projected path, so "Load input" must not offer one.
 *  - `related` is empty. A projection cannot claim another workflow's run
 *    happened; only an observed identifier match can.
 */

export function projectionAsTrace(projection: Projection): ExecutionTrace {
  return {
    supported: projection.supported,
    execution: null,
    nodes: projection.nodes
      // A node the diff reports as `gone` has no place on a canvas that no
      // longer draws it; the verdict names it instead.
      .filter((n) => n.state !== null)
      .map((n) => ({
        nodeId: n.nodeId,
        state: n.state as "touched" | "untouched" | "unknown",
        status: null,
        bundles: null,
        warning: null,
        error: null,
      })),
    partial: projection.partial,
    coverage: null,
    entry: null,
    related: [],
    links: { history: null, execution: null, editor: null },
    notes: projection.notes,
  };
}
