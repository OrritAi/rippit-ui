import type {
  Evidence,
  FunnelAutomation,
  FunnelAutomationAction,
  FunnelDecision,
  FunnelPage,
  FunnelPageAsset,
  FunnelStage,
  FunnelStageRole,
} from "@/app/lib/api";

/*
 * Martech view model. `deriveView` turns a FunnelGraph (v2) into columns of
 * nodes and typed edges; `layoutMartech` places them. Both are pure so the
 * canvas, the inspector and the screen-reader list read the same structure.
 *
 * The diagram grammar is fixed: one horizontal spine of pages (left → right),
 * and under each page a vertical stack — the assets on the page, the browser
 * pixel facet, then each automation as a trigger card with its actions
 * stacked below. A decision column sits after the stage that owns a
 * qualification split; the disqualified page hangs off it.
 */

export type MartechNodeKind = "ad" | "page" | "stage" | "decision" | "asset" | "pixel" | "trigger" | "action";

/** spine = the page/stage row; branch = the disqualified page; sub = cards under a stage. */
export type MartechLane = "spine" | "branch" | "sub";

interface NodeBase {
  id: string;
  col: number;
  lane: MartechLane;
  label: string;
  sublabel?: string | null;
  /** What Rippit can say about this node. Drives the dashed "not captured" look. */
  evidence: Evidence;
  /** Owning stage; null for the ad platform. "unplaced" for the not-placed column. */
  stageId: string | null;
}

export interface AdNode extends NodeBase {
  kind: "ad";
  destination: string | null;
  /** The platform was inferred from attribution / conversion targets. */
  inferred: boolean;
}

export interface PageNode extends NodeBase {
  kind: "page";
  /** null = placeholder ("No page captured"). */
  page: FunnelPage | null;
  role: FunnelStageRole | null;
  url: string | null;
}

export interface StageNode extends NodeBase {
  kind: "stage";
  stage: FunnelStage | null;
  role: FunnelStageRole | null;
  url: string | null;
  /** 1-based position on the spine and the spine length. */
  position: number;
  total: number;
}

export interface DecisionNode extends NodeBase {
  kind: "decision";
  decision: FunnelDecision;
}

export interface AssetNode extends NodeBase {
  kind: "asset";
  asset: FunnelPageAsset;
  /** Found embedded on the page, or only known from a workflow trigger. */
  source: "embed" | "trigger";
  /** Other stages that carry the same asset. */
  sharedWith: string[];
}

export interface PixelNode extends NodeBase {
  kind: "pixel";
  reason: string;
}

export interface TriggerNode extends NodeBase {
  kind: "trigger";
  automation: FunnelAutomation;
  /** The asset card this trigger listens on, when placed. */
  assetNodeId: string | null;
}

export interface ActionNode extends NodeBase {
  kind: "action";
  automation: FunnelAutomation;
  /** null = the "+k more" overflow card. */
  action: FunnelAutomationAction | null;
  /** How many actions the overflow card stands for (0 on real actions). */
  overflow: number;
  /** Position in the automation's action list (0-based). */
  index: number;
}

export type MartechNode = AdNode | PageNode | StageNode | DecisionNode | AssetNode | PixelNode | TriggerNode | ActionNode;

export type MartechEdgeKind =
  | "spine"
  | "branch"
  | "stem"
  | "fires-on"
  | "automation"
  | "conversion-report"
  | "shared-asset"
  | "inferred";

export interface MartechEdge {
  id: string;
  from: string;
  to: string;
  kind: MartechEdgeKind;
  label?: string | null;
  tone: "neutral" | "err" | "warn";
  evidence: Evidence;
  validity: "current" | "stale" | "unresolved" | "source_deleted";
  /** h = right-mid → left-mid curve; v = bottom → top. */
  route: "h" | "v";
}

export interface MartechAutomationStack {
  triggerId: string;
  actionIds: string[];
  /** Asset card the trigger fires on (may live in another column). */
  assetNodeId: string | null;
}

export interface MartechColumn {
  index: number;
  kind: "ad" | "stage" | "decision";
  stageId: string | null;
  /** ad: [ad]; stage: [page, stage]; decision: [decision, branch page?]. */
  headIds: string[];
  /** Left sub-lane: assets then the pixel card. */
  left: string[];
  /** Right sub-lane: one stack per automation. */
  stacks: MartechAutomationStack[];
}

export interface MartechModel {
  columns: MartechColumn[];
  nodes: MartechNode[];
  edges: MartechEdge[];
  /** Automations the detector could not place on a page. Shown, never guessed. */
  unplaced: FunnelAutomation[];
}

export interface MartechBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MartechLayoutEdge {
  id: string;
  d: string;
  /** Label anchor. */
  mx: number;
  my: number;
}

export interface MartechLayout {
  w: number;
  h: number;
  boxes: Map<string, MartechBox>;
  edges: MartechLayoutEdge[];
  /** Column-major traversal order for the roving tabindex. */
  order: string[];
  /** Node id → column index. */
  columnOf: Map<string, number>;
}
