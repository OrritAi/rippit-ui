import type { ModuleInfo, ScenarioSummary, WorkflowLink } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";

/*
 * Workflow map model types. `buildMap` (model.ts) turns the link map plus
 * whatever summaries are loaded into a tree of MapNodes; the renderer
 * (components/workflowMap) only reads this shape. Everything here is
 * type-only so the model runs under `node --experimental-strip-types`.
 */

/** "{source}:{refId}" — the key the link map, the summary store and the
 *  `/workflows/summaries?ids=` route all agree on. */
export type WorkflowKey = `${ProviderId}:${string}`;

export interface WorkflowRef {
  source: ProviderId;
  refId: string;
}

export type MapNodeKind = "workflow" | "scenario" | "step" | "route";

export type PillStatus = "ok" | "off";

export interface PillState {
  /** Children are rendered (or requested) — the pill reads "− fold". */
  open: boolean;
  /** Open, but the summary has not arrived yet. */
  loading: boolean;
  /** Summary fetch failed: "not-synced" | "not-captured" | "fetch-failed". */
  error?: string;
  /** This workflow is already open further up the current path. */
  cycle: boolean;
  /** The viewed workflow's own pill: always open, never toggles, no chip. */
  pinned?: boolean;
  /** The connection path exposes no step content (GHL OAuth list-only). */
  unavailable: boolean;
  /** How this pill hangs off its parent step (absent on roots). */
  link?: Pick<WorkflowLink, "kind" | "status">;
  /** The link's `from.stepId` did not resolve to a captured step, so the
   *  pill hangs off the entry node instead. */
  unresolvedStep?: boolean;
}

export interface MapNode {
  /** Path-based, index-free: root `wf:ghl:abc`, step `<parent>/m:<moduleId>`,
   *  route `<parent>/route:<moduleId>:<i>`, attached pill `<parent>/wf:make:912`,
   *  marker `<parent>/goto:<target>` or `<parent>/merge:<target>`. */
  id: string;
  parentId: string | null;
  depth: number;
  kind: MapNodeKind;
  /** App key for AppPuck (colour + glyph). Pills use the provider id. */
  app: string;
  name: string;
  desc: string;
  /** Pills only: drives the status dot. Undefined when the card does not say. */
  status?: PillStatus;
  /** Pills only: mono line under the pill ("make scenario · last run 2h ago"). */
  meta?: string;
  /** Pills only: which workflow this is. */
  ref?: WorkflowRef;
  /** Steps and routes: the workflow + step they belong to. */
  stepRef?: { key: WorkflowKey; stepId: string };
  /** Steps only: the summary module behind the node. */
  module?: ModuleInfo;
  /** Deep link into the platform's editor: a pill's own workflow, or for
   *  steps / routes / markers the OWNING workflow's (no platform has
   *  per-step links). Null until the summary carrying it is loaded. */
  nativeUrl: string | null;
  /** Workflow keys open on the way here, root first. Pills include themselves. */
  path: WorkflowKey[];
  children: MapNode[];
  /** Pills: total steps (summary length, else the card's stepCount, else 0).
   *  Other nodes: `children.length`. */
  childCount: number;
  /** Workflows attached to this node (the pills among `children`), in order. */
  attachedRefs: WorkflowRef[];
  /** Join heads: steps reached by more than one column of this node's
   *  children band (branches of a router, entries of a workflow). Each is
   *  rendered once, in a join column right of the band, and continues its
   *  own chain as its children. Connected by `join` pairs from the tails. */
  joins: MapNode[];
  /** Rendered nodes below this one (children band + join column, excluding itself). */
  descendants: number;
  /** Steps only: a `goto` edge leaves here — the target renders exactly
   *  once elsewhere and a `jump` pair points at it. */
  jumpTo?: { stepId: string; targetName: string };
  /** Steps only: continues the previous sibling's chain — its incoming edge
   *  comes from that sibling (vertical), not from the parent. */
  chained?: boolean;
  /** Pills: this is the workflow being viewed (every copy of it). */
  isViewed?: boolean;
  /** Pills of a workflow other than the viewed one: where to open it in
   *  Rippit — `/w/<source>/<refId>`. Steps and routes never carry it. */
  rippitHref?: string;
  pill?: PillState;
  /** Name or description matches the current filter query. */
  hit: boolean;
}

export type EdgeKind = "tree" | "join" | "jump";
/** Drawn edges add the per-parent `trunk` (no pair of its own). */
export type DrawnEdgeKind = EdgeKind | "trunk";

export interface EdgePair {
  /** `${from}>${to}` (+ `#join` / `#jump` for cross pairs) */
  key: string;
  from: string;
  to: string;
  /** The parent's depth — 0 for root pill → step edges. */
  depth: number;
  /** tree = parent → child; join = a branch tail into a shared step rendered
   *  once; jump = a "Go to" step to its target. */
  kind: EdgeKind;
  /** "v": a chain edge, drawn straight from the source's bottom-centre (+5)
   *  to the target's top-centre (−5). Absent: right-centre → left-centre. */
  anchor?: "v";
}

export type SummaryEntry =
  | { state: "loading" }
  | { state: "error"; error: string; stepsUnavailable?: boolean }
  | { state: "ok"; summary: ScenarioSummary };

export interface MapCounts {
  /** Nodes actually rendered (length of `flat`). */
  rendered: number;
  /** Pills that are open and rendered. */
  openPills: number;
  /** Roots after the filter (equals `roots.length`). */
  matchedRoots: number;
  /** Callers ∪ direct targets of the viewed workflow. */
  connected: number;
}

export interface MapModel {
  /** The viewed workflow's tree — exactly one pill, always open. */
  roots: MapNode[];
  /** The workflows that call the viewed one: a folded-by-default block to
   *  the left of the tree, each connected by a `join` pair into the viewed
   *  pill (from its calling step once expanded). */
  callers: MapNode[];
  /** Every visible parent → child edge, in render order. */
  pairs: EdgePair[];
  /** Depth-first, render order — the keyboard tree walks this. */
  flat: MapNode[];
  byId: Map<string, MapNode>;
  /** `${WorkflowKey}:${stepId}` → the first rendered node for that step. */
  byStep: Map<string, MapNode>;
  /** Workflow keys that are open but have no summary entry yet — feed
   *  these to `useSummaryStore.ensure`. */
  wanted: WorkflowKey[];
  counts: MapCounts;
}
