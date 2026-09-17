import type { ModuleInfo, ScenarioSummary, WorkflowLink } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";

/*
 * Workflow map model types. `buildMap` (model.ts) turns the link map plus
 * whatever summaries are loaded into a tree of MapNodes; the renderer
 * (components/workflowMap) only reads this shape. Types, plus the one
 * literal list a type cannot express (`LAYERS`); nothing here imports a
 * value, so the model still runs under `node --experimental-strip-types`.
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
  /** This workflow is drawn open at ANOTHER call site, and this pill says
   *  where. A workflow called from several steps is several pills but open at
   *  one of them; every other copy names it, so a copy the reader left open
   *  and later finds closed is never a mystery. Unset whenever no copy is
   *  open — folding the open one resets every other back to "+ expand". */
  openAt?: { id: string; where: string };
}

/**
 * How much of a workflow the canvas draws — a ladder of description the
 * reader climbs deliberately, never something zoom does to them.
 *
 *  macro     what this workflow IS: the trigger, its run-in packed into one
 *            card, the fan-out, and everything past it as a single element
 *            ("9 outcomes · 5 patterns"). Most nodes are withheld on purpose.
 *  structure the default: trunk steps individually, plus one card per
 *            distinct branch shape. This is the working view.
 *  steps     every step the platform has, however much it repeats.
 *
 * One rung down from `structure` is per-card, not global: opening one arm
 * draws that arm and leaves its siblings alone. One rung below that is the
 * sidebar, which is the same at every rung.
 */
export type Layer = "macro" | "structure" | "steps";

/** The rungs, coarse to fine — the order the control and Esc walk. */
export const LAYERS: readonly Layer[] = ["macro", "structure", "steps"];

/** One arm behind a card standing for a whole fan-out. */
export interface FoldMember {
  /** The arm's first step. */
  stepId: string;
  /** Its branch label — "No-Showed". Never truncated. */
  label: string;
}

/**
 * A route card standing for more than itself: its steps are withheld from
 * the model (never built, so nothing counts, measures or tab-stops on them)
 * and the card says what it stands for.
 *
 * At Structure that is always ONE arm: every branch is its own card, named
 * for itself, and branches that share a shape are never merged into one card.
 * Only the Overview's card for a whole fan-out stands for many arms at once.
 *
 * The card is always a real node — the route that already existed for that
 * branch. Nothing synthetic enters `byId`.
 */
export interface FoldState {
  /** What this one card stands for.
   *  "arm"  — its own branch, and nothing else (the `structure` rung).
   *  "band" — every arm of one fan-out as a single element (the `macro`
   *           rung). It claims a count and a variety, never a sameness. */
  scope: "arm" | "band";
  /** Distinct shapes among the arms it stands for. Equal to `count` when
   *  every arm differs — then the card says "9 outcomes" and nothing more. */
  patterns: number;
  /** The arm's first step. `armKey()` builds the `expanded` key that opens it. */
  armId: string;
  /** The reader opened it: the chain is drawn and the card offers "fold". */
  open: boolean;
  /** Steps in this one arm, its head included. */
  steps: number;
  /** What the arm does, in one line: its first step's label. */
  pattern: string;
  /** Arms this card stands for: always 1 for a branch card, the fan-out's
   *  outcome count for a band card. */
  count: number;
  /** Steps across every arm it stands for. */
  totalSteps: number;
  /** A band card's other arms — never drawn as chips, only read aloud and
   *  named in the panel. Always empty on a branch card. */
  members: FoldMember[];
}

/**
 * A step standing for the steps that follow it. The card is the first of
 * them, so clicking it opens that step's own panel; while it is shut the chain
 * continues from it to whatever they led to, which is one edge instead of
 * nine cards. Two kinds, told apart by how they open:
 *  - a TILE (`inPlace`): PACK_AT or more consecutive steps doing one thing.
 *    It opens in place under `armKey(key, <this step>)`, exactly as an arm
 *    does, and stays a pack while open so its cap shows filled and a second
 *    press folds the steps back. Two steps are a pair, never a tile.
 *  - a RUN: the Overview's "Prepare ×9", revealed only by descending to
 *    Structure.
 */
export interface PackState {
  /** Steps it stands for, this card's own included. */
  steps: number;
  /** The last step it stands for. */
  lastId: string;
  /** A tile: its chip opens it in place instead of descending a rung. */
  inPlace?: boolean;
  /** A tile the reader opened: its steps are drawn after this card. */
  open?: boolean;
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
   *  comes from that sibling, not from the parent. */
  chained?: boolean;
  /** Steps and routes of the viewed workflow: its own flow, which wears the
   *  main-flow colour. */
  main?: boolean;
  /** This card's line runs top to bottom: a connected workflow's pill, and
   *  the steps of that workflow's trunk. Every other line — the viewed
   *  workflow's, and every branch lane, wherever it sits — runs left to
   *  right. */
  down?: boolean;
  /** Routes only: this branch is drawn as one card (see `FoldState`). */
  fold?: FoldState;
  /** Steps only: the steps after it drawn as one card (see `PackState`). */
  pack?: PackState;
  /** Pills: this is the workflow being viewed (every copy of it). */
  isViewed?: boolean;
  /** Pills of a workflow other than the viewed one: where to open it in
   *  Orrit — `/w/<source>/<refId>`. Steps and routes never carry it. */
  orritHref?: string;
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
  /**
   * How the edge meets its two cards. The viewed workflow's own flow runs LEFT
   * TO RIGHT: consecutive steps sit side by side in one top-aligned row, and
   * a workflow a step calls hangs BELOW that step. A connected workflow runs
   * TOP TO BOTTOM: its steps stack under its pill, left-aligned with it.
   *
   *  "h"    — a chain link in the main flow: the next card in the same row. A
   *           straight horizontal line on the row's rail, from the source's
   *           right edge to the target's left edge, both at
   *           `target.top + CHAIN_RAIL_Y`. Measured from the TARGET, which is
   *           always a top-aligned step card; the source may be a pill
   *           starting the row, which the layout nudges so its centre — not
   *           its top + CHAIN_RAIL_Y — sits on that rail. Taking the height
   *           from the target keeps every chain line straight whichever kind
   *           of card it leaves.
   *  "v"    — a chain link in a connected workflow: the next card below, in a
   *           left-aligned column. A straight vertical line at
   *           `x = target.left + DROP_X`, under the target's puck, from the
   *           source's bottom edge to the target's top edge. Measured from the
   *           TARGET for the same reason as "h"; the column's left alignment
   *           puts it under the source's puck too, and inside a pill's width.
   *  "drop" — a main-flow step to a workflow pill hanging below it: from the
   *           source's bottom edge at `x = source.left + DROP_X`, straight
   *           down, then right into the target's left edge at its vertical
   *           centre.
   *  absent — everything else, routed as before: a fan-out to its branches,
   *           a group to a chain that does not continue its own row or column,
   *           a pill called from inside a connected workflow (it sits to the
   *           right of its step), a pill in the callers block. Cross pairs
   *           (join / jump) never carry one.
   */
  anchor?: "h" | "v" | "drop";
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
  /** Cards standing for a folded arm (`fold` set and not open). */
  folded: number;
  /** Steps those cards withhold (equals `hiddenSteps.size`). */
  withheld: number;
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
  /** `${WorkflowKey}:${stepId}` for every step a fold withholds → the
   *  `expanded` key that reveals it. A `?step=` that misses `byStep` looks
   *  here, opens that card, and converges one level per rebuild. Fold state
   *  is never in the URL: the link names a step, the map opens itself. */
  hiddenSteps: Map<string, string>;
  /** Workflow keys that are open but have no summary entry yet — feed
   *  these to `useSummaryStore.ensure`. */
  wanted: WorkflowKey[];
  counts: MapCounts;
}
