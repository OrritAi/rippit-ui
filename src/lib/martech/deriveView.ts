import type {
  Evidence,
  FunnelAutomation,
  FunnelGraph,
  FunnelPage,
  FunnelPageAsset,
  FunnelRelationship,
  FunnelStage,
} from "@/app/lib/api";
import { ACTIONS_MAX, PIXEL_REASON, adPlatformLabel, roleLabel } from "./labels";
import type {
  ActionNode,
  AssetNode,
  MartechAutomationStack,
  MartechColumn,
  MartechEdge,
  MartechModel,
  MartechNode,
  PageNode,
  StageNode,
} from "./types";

/*
 * deriveView — FunnelGraph (v2) → MartechModel. Pure: no React, no fetch.
 *
 * Rules (see the plan, "deriveView rules"):
 *  - spine = stages by displayOrder, minus any stage that is the target of a
 *    `branches_to` relationship and carries role "disqualified";
 *  - column 0 is the ad platform (inferred when the API says so, otherwise
 *    "not captured"), joined to the first page by an `inferred` edge;
 *  - a decision column follows the stage owning a `decisions[]` entry; the
 *    disqualified page renders inside it on the branch lane;
 *  - one page per stage (lowest stepIndex), else a placeholder;
 *  - assets per stage = page embeds ∪ trigger assets of its automations,
 *    then a pixel card that is always "not captured";
 *  - automations filtered on a survey outcome go under the decision column;
 *  - a missing adjacent relationship is drawn, but as "not captured".
 * Nothing is guessed: unplaced automations get their own column.
 */

export const UNPLACED_STAGE = "unplaced";

const asArray = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

const assetKey = (a: { assetKind: string; externalId: string }) => `${a.assetKind}:${a.externalId}`;

function assetFromTrigger(auto: FunnelAutomation): FunnelPageAsset | null {
  const t = auto.trigger?.asset;
  if (!t || !t.assetValue) return null;
  if (t.assetKind !== "ghl_form" && t.assetKind !== "ghl_calendar") return null;
  const type = (auto.trigger.type || "").toLowerCase();
  const kind: FunnelPageAsset["kind"] =
    t.assetKind === "ghl_calendar" ? "calendar" : type.includes("survey") ? "survey" : "form";
  return { kind, externalId: t.assetValue, name: t.label ?? null, nativeUrl: null, assetKind: t.assetKind };
}

function primaryPage(pages: FunnelPage[], stageId: string): FunnelPage | null {
  let best: FunnelPage | null = null;
  for (const p of pages) {
    if (p.stageId !== stageId) continue;
    if (!best || p.stepIndex < best.stepIndex) best = p;
  }
  return best;
}

function relationshipBetween(rels: FunnelRelationship[], from: string, to: string): FunnelRelationship | null {
  return rels.find((r) => r.fromStageId === from && r.toStageId === to && r.kind !== "branches_to") ?? null;
}

export function deriveView(graph: FunnelGraph): MartechModel {
  const stages = [...asArray(graph.stages)].sort((a, b) => a.displayOrder - b.displayOrder);
  const relationships = asArray(graph.relationships);
  const pages = asArray(graph.pages);
  const automations = asArray(graph.automations);
  const decisions = asArray(graph.decisions);
  const tracking = asArray(graph.tracking);
  const stageById = new Map(stages.map((s) => [s.id, s]));

  const nodes: MartechNode[] = [];
  const edges: MartechEdge[] = [];
  const columns: MartechColumn[] = [];
  const byId = new Map<string, MartechNode>();
  const push = <T extends MartechNode>(n: T): T => {
    nodes.push(n);
    byId.set(n.id, n);
    return n;
  };
  const edge = (e: Omit<MartechEdge, "id"> & { id?: string }) => {
    edges.push({ id: e.id ?? `${e.kind}:${e.from}>${e.to}`, ...e });
  };

  /* ---- spine ---- */
  const dqTargets = new Set<string>();
  for (const r of relationships) {
    if (r.kind === "branches_to" && r.toStageId && stageById.get(r.toStageId)?.role === "disqualified") dqTargets.add(r.toStageId);
  }
  const spine = stages.filter((s) => !dqTargets.has(s.id));
  const spineIndex = new Map(spine.map((s, i) => [s.id, i]));

  /* ---- column 0: ad platform ---- */
  const ad = graph.adPlatform ?? null;
  const adInferred = !!ad && ad.destination != null && ad.destination !== "unknown";
  const adNode = push({
    id: "ad",
    kind: "ad" as const,
    col: 0,
    lane: "spine" as const,
    label: adPlatformLabel(ad?.destination),
    sublabel: adInferred ? "Inferred from attribution" : "Not captured",
    evidence: adInferred && ad ? (ad.evidence ?? "configured") : "not-captured",
    stageId: null,
    destination: ad?.destination ?? null,
    inferred: adInferred,
  });
  columns.push({ index: 0, kind: "ad", stageId: null, headIds: [adNode.id], left: [], stacks: [] });

  /* ---- per-stage bookkeeping ---- */
  const assetNodeByStage = new Map<string, Map<string, AssetNode>>();
  const assetStages = new Map<string, string[]>(); // asset key → stage ids
  const stageNodeId = (stageId: string) => `stage:${stageId}`;
  const pageNodeId = (stageId: string) => `page:${stageId}`;
  const pixelReason = (stageId: string) => tracking.find((t) => t.stageId === stageId)?.pixel.reason ?? PIXEL_REASON;

  const addAutomationStack = (auto: FunnelAutomation, col: number, stageId: string, assetNodeId: string | null): MartechAutomationStack => {
    const trigger = push({
      id: `trigger:${auto.id}`,
      kind: "trigger" as const,
      col,
      lane: "sub" as const,
      label: auto.trigger?.label || auto.name,
      sublabel: auto.name,
      evidence: "configured" as Evidence,
      stageId,
      automation: auto,
      assetNodeId,
    });
    if (assetNodeId) {
      edge({ from: assetNodeId, to: trigger.id, kind: "fires-on", tone: "neutral", evidence: "configured", validity: "current", route: "h" });
    }
    const actions = asArray(auto.actions);
    const shown = actions.slice(0, ACTIONS_MAX);
    const actionIds: string[] = [];
    let prev = trigger.id;
    shown.forEach((a, i) => {
      const node: ActionNode = push({
        id: `action:${auto.id}:${a.id}`,
        kind: "action",
        col,
        lane: "sub",
        label: a.label,
        sublabel: null,
        evidence: "configured",
        stageId,
        automation: auto,
        action: a,
        overflow: 0,
        index: i,
      });
      actionIds.push(node.id);
      edge({ from: prev, to: node.id, kind: "automation", tone: "neutral", evidence: "configured", validity: "current", route: "v" });
      prev = node.id;
      if (a.kind === "conversion" && a.conversion) {
        edge({
          from: node.id,
          to: adNode.id,
          kind: "conversion-report",
          label: a.conversion.eventName,
          tone: "warn",
          evidence: "configured",
          validity: "current",
          route: "h",
        });
      }
    });
    const hidden = actions.length - shown.length;
    if (hidden > 0 || auto.actionsTruncated) {
      const more: ActionNode = push({
        id: `more:${auto.id}`,
        kind: "action",
        col,
        lane: "sub",
        label: hidden > 0 ? `+${hidden} more${auto.actionsTruncated ? "…" : ""}` : "More actions",
        sublabel: auto.actionsTruncated ? "List capped by the API" : null,
        evidence: "configured",
        stageId,
        automation: auto,
        action: null,
        overflow: hidden,
        index: shown.length,
      });
      actionIds.push(more.id);
      edge({ from: prev, to: more.id, kind: "automation", tone: "neutral", evidence: "configured", validity: "current", route: "v" });
    }
    return { triggerId: trigger.id, actionIds, assetNodeId };
  };

  /* ---- stage columns (+ decision columns) ---- */
  const pendingDecisionStacks: { auto: FunnelAutomation; stageId: string; assetNodeId: string | null }[] = [];
  let prevSpineTail: { id: string; stageId: string } | null = null;

  spine.forEach((stage, i) => {
    const col = columns.length;
    const page = primaryPage(pages, stage.id);
    const url = page?.url ?? stage.url ?? null;
    const role = stage.role ?? null;

    const pageNode: PageNode = push({
      id: pageNodeId(stage.id),
      kind: "page",
      col,
      lane: "spine",
      label: page?.name ?? "No page captured",
      sublabel: url,
      evidence: page ? "configured" : "not-captured",
      stageId: stage.id,
      page,
      role,
      url,
    });
    const stageNode: StageNode = push({
      id: stageNodeId(stage.id),
      kind: "stage",
      col,
      lane: "spine",
      label: stage.displayName,
      sublabel: [roleLabel(role), `Page ${i + 1} of ${spine.length}`].filter(Boolean).join(" · "),
      evidence: stage.origin === "manual" ? "not-captured" : "configured",
      stageId: stage.id,
      stage,
      role,
      url,
      position: i + 1,
      total: spine.length,
    });
    edge({ from: pageNode.id, to: stageNode.id, kind: "stem", tone: "neutral", evidence: "configured", validity: "current", route: "v" });

    if (i === 0) {
      edge({ from: adNode.id, to: pageNode.id, kind: "inferred", tone: "neutral", evidence: adNode.evidence, validity: "current", route: "h" });
    }

    // Spine edge from the previous tail (stage or decision) into this stage.
    if (prevSpineTail) {
      const rel = relationshipBetween(relationships, prevSpineTail.stageId, stage.id);
      const fromDecision = prevSpineTail.id.startsWith("decision:");
      edge({
        from: prevSpineTail.id,
        to: stageNode.id,
        kind: fromDecision ? "branch" : "spine",
        label: fromDecision ? "Qualified" : rel?.label ?? null,
        tone: "neutral",
        evidence: rel ? "configured" : "not-captured",
        validity: rel?.validity ?? "current",
        route: "h",
      });
    }

    // Assets: page embeds ∪ trigger assets of the stage's automations.
    const stageAutos = automations.filter((a) => a.stageId === stage.id);
    const assetMap = new Map<string, AssetNode>();
    const left: string[] = [];
    const addAsset = (asset: FunnelPageAsset, source: "embed" | "trigger") => {
      const key = assetKey(asset);
      let node = assetMap.get(key);
      if (!node) {
        node = push({
          id: `asset:${stage.id}:${key}`,
          kind: "asset" as const,
          col,
          lane: "sub" as const,
          label: asset.name || `${asset.kind} ${asset.externalId}`,
          sublabel: null,
          evidence: "configured" as Evidence,
          stageId: stage.id,
          asset,
          source,
          sharedWith: [],
        });
        assetMap.set(key, node);
        left.push(node.id);
        assetStages.set(key, [...(assetStages.get(key) ?? []), stage.id]);
      } else if (source === "embed" && node.source === "trigger") {
        node.source = "embed";
        node.asset = asset;
      }
      return node;
    };
    for (const a of asArray(page?.embeddedAssets)) addAsset(a, "embed");
    for (const auto of stageAutos) {
      const a = assetFromTrigger(auto);
      if (a) addAsset(a, "trigger");
    }
    assetNodeByStage.set(stage.id, assetMap);

    const pixel = push({
      id: `pixel:${stage.id}`,
      kind: "pixel" as const,
      col,
      lane: "sub" as const,
      label: "Browser pixel",
      sublabel: "Not captured",
      evidence: "not-captured" as Evidence,
      stageId: stage.id,
      reason: pixelReason(stage.id),
    });
    left.push(pixel.id);

    // Automations: outcome-filtered ones wait for the decision column.
    const decision = decisions.find((d) => d.stageId === stage.id) ?? null;
    const stacks: MartechAutomationStack[] = [];
    for (const auto of stageAutos) {
      const ta = assetFromTrigger(auto);
      const assetNodeId = ta ? (assetMap.get(assetKey(ta))?.id ?? null) : null;
      if (decision && auto.trigger?.qualification) pendingDecisionStacks.push({ auto, stageId: stage.id, assetNodeId });
      else stacks.push(addAutomationStack(auto, col, stage.id, assetNodeId));
    }
    columns.push({ index: col, kind: "stage", stageId: stage.id, headIds: [pageNode.id, stageNode.id], left, stacks });
    prevSpineTail = { id: stageNode.id, stageId: stage.id };

    /* ---- decision column ---- */
    if (decision) {
      const dcol = columns.length;
      const decisionNode = push({
        id: `decision:${decision.id}`,
        kind: "decision" as const,
        col: dcol,
        lane: "spine" as const,
        label: decision.label,
        sublabel: "Survey outcome",
        evidence: "configured" as Evidence,
        stageId: stage.id,
        decision,
      });
      edge({
        from: stageNode.id,
        to: decisionNode.id,
        kind: "spine",
        tone: "neutral",
        evidence: "configured",
        validity: "current",
        route: "h",
      });
      const headIds = [decisionNode.id];

      const dq = asArray(decision.branches).find((b) => b.outcome === "disqualified") ?? null;
      const dqStage: FunnelStage | null = dq?.toStageId ? (stageById.get(dq.toStageId) ?? null) : null;
      const dqPage = dqStage ? primaryPage(pages, dqStage.id) : null;
      const dqStageId = dqStage?.id ?? `${stage.id}:dq`;
      const dqPageNode: PageNode = push({
        id: pageNodeId(dqStageId),
        kind: "page",
        col: dcol,
        lane: "branch",
        label: dqPage?.name ?? dqStage?.displayName ?? "Disqualified page",
        sublabel: dqPage?.url ?? dqStage?.url ?? (dq ? "Destination not captured" : "No disqualified branch captured"),
        evidence: dqPage || dqStage ? "configured" : "not-captured",
        stageId: dqStage?.id ?? null,
        page: dqPage,
        role: "disqualified",
        url: dqPage?.url ?? dqStage?.url ?? null,
      });
      headIds.push(dqPageNode.id);
      const dqRel = dqStage ? relationships.find((r) => r.kind === "branches_to" && r.fromStageId === stage.id && r.toStageId === dqStage.id) : null;
      edge({
        from: decisionNode.id,
        to: dqPageNode.id,
        kind: "branch",
        label: dq?.conditionText || "Disqualified",
        tone: "err",
        evidence: dq?.evidence ?? "not-captured",
        validity: dqRel?.validity ?? (dq ? "current" : "unresolved"),
        route: "v",
      });

      const dstacks: MartechAutomationStack[] = [];
      for (const p of pendingDecisionStacks.splice(0)) dstacks.push(addAutomationStack(p.auto, dcol, p.stageId, p.assetNodeId));
      columns.push({ index: dcol, kind: "decision", stageId: stage.id, headIds, left: [], stacks: dstacks });
      prevSpineTail = { id: decisionNode.id, stageId: stage.id };
    }
  });

  /* ---- other relationships between placed stages (redirects, jumps) ---- */
  for (const r of relationships) {
    if (!r.fromStageId || !r.toStageId || r.kind === "branches_to") continue;
    const a = spineIndex.get(r.fromStageId);
    const b = spineIndex.get(r.toStageId);
    if (a === undefined || b === undefined || b === a + 1) continue; // adjacent = spine, already drawn
    const from = stageNodeId(r.fromStageId);
    const to = stageNodeId(r.toStageId);
    if (!byId.has(from) || !byId.has(to)) continue;
    edge({
      id: `rel:${r.id}`,
      from,
      to,
      kind: "spine",
      label: r.label ?? r.conditionText ?? r.kind.replace(/_/g, " "),
      tone: r.validity === "current" ? "neutral" : "err",
      evidence: "configured",
      validity: r.validity,
      route: "h",
    });
  }

  /* ---- shared assets across stages ---- */
  for (const [key, stageIds] of assetStages) {
    if (stageIds.length < 2) continue;
    for (let i = 0; i < stageIds.length; i++) {
      const node = assetNodeByStage.get(stageIds[i])?.get(key);
      if (node) node.sharedWith = stageIds.filter((s) => s !== stageIds[i]);
      if (i === 0) continue;
      const prev = assetNodeByStage.get(stageIds[i - 1])?.get(key);
      if (node && prev) {
        edge({ from: prev.id, to: node.id, kind: "shared-asset", label: "same asset", tone: "neutral", evidence: "configured", validity: "current", route: "h" });
      }
    }
  }

  /* ---- unplaced automations: their own column, no spine edge ---- */
  const placedIds = new Set(automations.filter((a) => a.stageId && stageById.has(a.stageId)).map((a) => a.id));
  const listed = new Set(asArray(graph.unplaced).map((u) => u.automationId));
  const unplaced = automations.filter((a) => !placedIds.has(a.id) || listed.has(a.id));
  if (unplaced.length > 0) {
    const col = columns.length;
    const pageNode: PageNode = push({
      id: pageNodeId(UNPLACED_STAGE),
      kind: "page",
      col,
      lane: "spine",
      label: "Not placed on a page",
      sublabel: `${unplaced.length} automation${unplaced.length === 1 ? "" : "s"}`,
      evidence: "not-captured",
      stageId: UNPLACED_STAGE,
      page: null,
      role: null,
      url: null,
    });
    const stageNode: StageNode = push({
      id: stageNodeId(UNPLACED_STAGE),
      kind: "stage",
      col,
      lane: "spine",
      label: "Unplaced",
      sublabel: "Trigger asset not on any captured page",
      evidence: "not-captured",
      stageId: UNPLACED_STAGE,
      stage: null,
      role: null,
      url: null,
      position: 0,
      total: spine.length,
    });
    edge({ from: pageNode.id, to: stageNode.id, kind: "stem", tone: "neutral", evidence: "not-captured", validity: "current", route: "v" });
    const stacks = unplaced.map((auto) => addAutomationStack(auto, col, UNPLACED_STAGE, null));
    columns.push({ index: col, kind: "stage", stageId: UNPLACED_STAGE, headIds: [pageNode.id, stageNode.id], left: [], stacks });
  }

  return { columns, nodes, edges, unplaced };
}
