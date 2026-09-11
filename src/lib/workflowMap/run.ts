import type { Execution, ExecutionTrace, Issue, TraceNode } from "@/app/lib/api";
import type { MapModel, MapNode, WorkflowKey } from "./types";
import { ZOOM_MIN } from "./tokens.ts";

/*
 * Run replay overlay — one execution's trace projected onto the rendered
 * map. Pure: no React, no fetch, no DOM, `import type` only, so it runs
 * under `node --experimental-strip-types` (see model.check.ts).
 *
 * `runStates` gives every rendered node of the VIEWED workflow a state:
 *   touched    the module ran (status success)
 *   warning    ran with a warning
 *   failed     ran and errored — the cause module
 *   untouched  inside coverage and no module row: the run did not reach it
 *   unknown    Rippit could not check it (coverage cut-off / rate limit) —
 *              honest "not checked", never "did not run"
 *   reached    a workflow pill attached under a touched calling step (the
 *              platform cannot tie the callee's execution to this one)
 * A step is resolved by `${WorkflowKey}:${stepId}` through `model.byStep`
 * and then EVERY rendered copy of that step in `model.flat`, so copies
 * share their state. A route inherits `touched` when any step below it is
 * touched, `unknown` when any is unknown, else `untouched`. Steps of other
 * workflows carry no state (rendered normally): `unknown` is reserved for
 * modules Rippit tried to check.
 *
 * Related runs: the trace's `related[]` names other executions that carried
 * the same record around the same time. When the host has fetched such a
 * run's trace and its workflow is on the map, `runStates` takes it as
 * `related` (keyed by that workflow) and overlays it the same way: that
 * workflow's rendered steps and routes get their own states, and its pill —
 * when attached under a step of a traced workflow — reads `reached` (the
 * run demonstrably happened, whatever the calling step's state). A related
 * trace for a workflow that is not rendered changes nothing, and with no
 * related traces the output is exactly the single-trace overlay.
 */

export type RunState = "touched" | "warning" | "failed" | "untouched" | "unknown" | "reached";

/** Traces of related runs, keyed by the workflow each one belongs to. */
export type RelatedTraces = ReadonlyMap<WorkflowKey, ExecutionTrace>;

/** A state the run actually reached (the module ran, whatever happened next). */
export function ran(state: RunState | null | undefined): boolean {
  return state === "touched" || state === "warning" || state === "failed";
}

/** Collapse the API's `state` + `status` pair to one map state: the API may
 *  send `touched` with `status: "error"` or the already-collapsed `failed`. */
export function nodeState(n: TraceNode): Exclude<RunState, "reached"> {
  if (n.state === "failed" || (n.state === "touched" && n.status === "error")) return "failed";
  if (n.state === "warning" || (n.state === "touched" && n.status === "warning")) return "warning";
  if (n.state === "touched") return "touched";
  if (n.state === "untouched") return "untouched";
  return "unknown";
}

export function traceNodeFor(trace: ExecutionTrace | null | undefined, stepId: string): TraceNode | null {
  if (!trace) return null;
  return trace.nodes.find((n) => String(n.nodeId) === String(stepId)) ?? null;
}

/** The node whose input the platform can hand back (webhook request /
 *  failing bundle) — the "Load input" affordance lives on it. */
export function isEntryNode(trace: ExecutionTrace | null | undefined, stepId: string): boolean {
  return !!trace?.entry?.nodeId && String(trace.entry.nodeId) === String(stepId);
}

/** "{source}:{refId}" of a pill's workflow — the key `related` is indexed by. */
function pillKey(node: MapNode): WorkflowKey | null {
  return node.ref ? (`${node.ref.source}:${node.ref.refId}` as WorkflowKey) : null;
}

function stepStatesBelow(node: MapNode, key: WorkflowKey, states: Map<string, RunState>, out: RunState[]): void {
  for (const c of node.children) {
    if (c.kind === "step" && c.stepRef?.key === key) {
      const s = states.get(c.id);
      if (s) out.push(s);
    }
    /* Attached pills belong to other workflows: nothing below them counts. */
    if (!c.pill) stepStatesBelow(c, key, states, out);
  }
  for (const j of node.joins) {
    if (j.kind === "step" && j.stepRef?.key === key) {
      const s = states.get(j.id);
      if (s) out.push(s);
    }
    stepStatesBelow(j, key, states, out);
  }
}

/** One workflow's trace over its rendered steps and routes (steps 1 + 2). */
function overlayWorkflow(model: MapModel, key: WorkflowKey, trace: ExecutionTrace, out: Map<string, RunState>): void {
  const byStepId = new Map<string, RunState>();
  for (const n of trace.nodes) byStepId.set(String(n.nodeId), nodeState(n));

  /* 1. Every rendered copy of the workflow's steps. A step the trace does
        not list was not checked — `unknown`, never `untouched`. */
  for (const node of model.flat) {
    if (node.kind !== "step" || !node.stepRef || node.stepRef.key !== key) continue;
    out.set(node.id, byStepId.get(String(node.stepRef.stepId)) ?? "unknown");
  }

  /* 2. Routes inherit from the steps below them. */
  for (const node of model.flat) {
    if (node.kind !== "route" || !node.stepRef || node.stepRef.key !== key) continue;
    const below: RunState[] = [];
    stepStatesBelow(node, key, out, below);
    if (below.length === 0) continue;
    if (below.some(ran)) out.set(node.id, "touched");
    else if (below.some((s) => s === "unknown")) out.set(node.id, "unknown");
    else out.set(node.id, "untouched");
  }
}

export function runStates(
  model: MapModel,
  viewedKey: WorkflowKey,
  trace: ExecutionTrace | null | undefined,
  related?: RelatedTraces | null
): ReadonlyMap<string, RunState> {
  const out = new Map<string, RunState>();
  if (!trace || !trace.supported) return out;

  overlayWorkflow(model, viewedKey, trace, out);

  /* Related runs: the same overlay for each other workflow whose trace the
     host handed over. A workflow that is not rendered gets nothing to
     colour; the viewed workflow's own key is the primary trace's job. */
  const traced = new Map<WorkflowKey, ExecutionTrace>();
  if (related) {
    for (const [key, t] of related) {
      if (key === viewedKey || !t || !t.supported) continue;
      traced.set(key, t);
      overlayWorkflow(model, key, t, out);
    }
  }

  /* 3. Pills attached under a traced step (one that carries a state):
        reached when the calling step ran, untouched when the run never got
        there; a failed or unchecked calling step says nothing about the
        callee — no state. A pill whose own run is traced is `reached`
        whatever the calling step's state: that run happened. A pill under
        an untraced step (another workflow's) stays stateless. */
  for (const node of model.flat) {
    if (!node.pill || node.isViewed || !node.parentId) continue;
    const parent = model.byId.get(node.parentId);
    if (!parent || parent.kind !== "step") continue;
    const ps = out.get(parent.id);
    if (!ps) continue;
    const key = pillKey(node);
    if (key && traced.has(key)) out.set(node.id, "reached");
    else if (ps === "touched" || ps === "warning") out.set(node.id, "reached");
    else if (ps === "untouched") out.set(node.id, "untouched");
  }
  return out;
}

/** Nodes the run did not reach or Rippit could not check — grayed, never hidden. */
export function dimNodeIds(states: ReadonlyMap<string, RunState>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [id, s] of states) if (s === "untouched" || s === "unknown") out.add(id);
  return out;
}

export function failedNodeIds(states: ReadonlyMap<string, RunState>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [id, s] of states) if (s === "failed") out.add(id);
  return out;
}

/** "7 of 9 steps reached · 1 failed" — the primary trace only; related
 *  runs never fold into the viewed workflow's counts. */
/** The same tally `runSummary` words, as numbers — the terse replay banner
 *  reads "7/9 steps" straight off it. */
export function runCounts(trace: ExecutionTrace): { total: number; reached: number; failed: number; warned: number } {
  const states = trace.nodes.map(nodeState);
  return {
    total: states.length,
    reached: states.filter(ran).length,
    failed: states.filter((s) => s === "failed").length,
    warned: states.filter((s) => s === "warning").length,
  };
}

export function runSummary(trace: ExecutionTrace): string {
  const { total, reached, failed, warned } = runCounts(trace);
  const parts = [`${reached} of ${total} step${total === 1 ? "" : "s"} reached`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (warned > 0) parts.push(warned === 1 ? "1 with a warning" : `${warned} with warnings`);
  return parts.join(" · ");
}

/** Modules Rippit could not check for this run (a partial trace). */
export function runUnchecked(trace: ExecutionTrace): number {
  return trace.nodes.filter((n) => nodeState(n) === "unknown").length;
}

/** An execution's status as a past-tense word: "failed 2 h ago". */
export function runStatusWord(status: Execution["status"] | null | undefined): string {
  switch (status) {
    case "success":
      return "succeeded";
    case "warning":
      return "finished with warnings";
    case "error":
      return "failed";
    case "incomplete":
      return "incomplete";
    default:
      return "status unknown";
  }
}

/** The execution a `last-run-failed` issue points at (`data.executionId` as
 *  the API sends it) on a platform whose runs the map can replay — Make is
 *  the only runtime source today, so /health and the inbox link into
 *  `?run=` for Make issues only. */
export function issueRunId(issue: Pick<Issue, "code" | "provider" | "data">): string | null {
  if (issue.code !== "last-run-failed" || issue.provider !== "make") return null;
  const id = issue.data?.executionId;
  if (typeof id === "string") return id.trim() || null;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

/** `/w/{provider}/{refId}?run=…[&step=…]` — the workflow page replaying that run. */
export function runReplayHref(provider: string, refId: string, executionId: string, stepId?: string | number | null): string {
  const step = stepId != null && String(stepId) !== "" ? `&step=${encodeURIComponent(String(stepId))}` : "";
  return `/w/${provider}/${refId}?run=${encodeURIComponent(executionId)}${step}`;
}

/** Sidebar / tooltip wording for a node state. */
export function runStateLabel(state: RunState): string {
  switch (state) {
    case "touched":
      return "Ran in this run";
    case "warning":
      return "Ran with a warning";
    case "failed":
      return "Failed here";
    case "untouched":
      return "Not reached in this run";
    case "unknown":
      return "Not checked in this run";
    case "reached":
      return "Reached by this run";
  }
}

/** aria-label suffix for a node while a run is replayed ("— not reached in this run"). */
export function runAria(state: RunState | null | undefined, error?: string | null): string | null {
  switch (state) {
    case "untouched":
      return "not reached in this run";
    case "failed":
      return error ? `failed in this run: ${error}` : "failed in this run";
    case "warning":
      return error ? `ran with a warning in this run: ${error}` : "ran with a warning in this run";
    case "unknown":
      return "not checked in this run";
    case "reached":
      return "reached in this run";
    case "touched":
      return "ran in this run";
    default:
      return null;
  }
}

/* ─── Framing the run ────────────────────────────────────────────────────── */

export interface FocusRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RunFocus {
  rect: FocusRect;
  padding: number;
  minZoom: number;
  maxZoom: number;
  /** The failed node the frame narrowed to, when it did — null when the
   *  frame is the whole path. */
  focusId: string | null;
  /** How many reached nodes the map had measured when this was computed. */
  count: number;
}

/** Inner-space spread beyond which a run counts as sprawling: past this, a
 *  run with a failure frames the failure instead of the whole path. */
export const RUN_FOCUS_SPREAD = 2200;
export const RUN_FOCUS_PADDING = 80;
/** Never zoom past 1:1 to frame a run — a short run should read as centred,
 *  not as one node blown up to fill the canvas. */
export const RUN_FOCUS_MAX_ZOOM = 1;

/*
 * Which rectangle the camera should frame for a replayed run.
 *
 * Pure: it takes the states `runStates` produced and the node rectangles the
 * map has measured (inner coordinates), and answers with a rect plus the
 * bounds `fitRect` should clamp to — no DOM, no camera, no React.
 *
 * Rules
 *  - Only nodes the run actually reached count (`ran`): untouched and
 *    unchecked nodes never pull the camera.
 *  - Nothing reached, or nothing measured yet → null, and the caller leaves
 *    the camera exactly where the user left it.
 *  - A failure inside a sprawling run frames the failure, not the sprawl:
 *    a 40-step path zoomed to fit shows nothing legible. Within the spread
 *    limit the whole path is framed and the failure is inside it already.
 */
export function runFocusRect(
  states: ReadonlyMap<string, RunState>,
  rects: ReadonlyMap<string, FocusRect>
): RunFocus | null {
  let failedId: string | null = null;
  let failedRect: FocusRect | null = null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (const [id, state] of states) {
    if (!ran(state)) continue;
    const r = rects.get(id);
    if (!r) continue;
    count++;
    if (state === "failed" && !failedId) {
      failedId = id;
      failedRect = r;
    }
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  if (count === 0) return null;

  const union: FocusRect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const sprawling = union.w > RUN_FOCUS_SPREAD || union.h > RUN_FOCUS_SPREAD;
  const narrow = sprawling && failedRect != null;

  return {
    rect: narrow ? failedRect! : union,
    padding: RUN_FOCUS_PADDING,
    minZoom: ZOOM_MIN,
    maxZoom: RUN_FOCUS_MAX_ZOOM,
    focusId: narrow ? failedId : null,
    count,
  };
}
