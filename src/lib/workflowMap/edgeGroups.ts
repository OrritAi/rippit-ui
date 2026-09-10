import type { MapEdge } from "@/components/workflowMap/useMapMeasure";
import type { MapNode } from "./types";

/*
 * Connection groups — what a hover or a click on an edge refers to. A plain
 * edge is its own group; a fan-out trunk and its stubs are one group (parent
 * → every child on that trunk); a fan-in trunk and its stubs are one group
 * (every caller → the viewed pill). Pure: derived from the measured edges
 * and the model's byId; recomputed only when the edge list changes.
 */

export type ConnectionKind = "sequence" | "branch" | "calls" | "join" | "go to" | "fan-out" | "fan-in";

export interface EdgePair {
  /** The member edge that draws this source → target route (a stub, or the edge itself). */
  edgeKey: string;
  from: string;
  to: string;
  /** Route / branch label when one side is a route node. */
  label?: string;
}

export interface EdgeGroup {
  key: string;
  kind: ConnectionKind;
  froms: MapNode[];
  tos: MapNode[];
  members: MapEdge[];
  /** Every source → target pairing in the group, in member order. */
  pairs: EdgePair[];
  /** Tooltip / aria text: "A → B", "Parent → 4 steps", "4 callers → Viewed". */
  label: string;
}

/** The pairing a row stands for: a source's (first) target, or a target's source. */
export function pairFor(group: EdgeGroup, nodeId: string, side: "source" | "target"): EdgePair | null {
  return group.pairs.find((p) => (side === "source" ? p.from === nodeId : p.to === nodeId)) ?? null;
}

/** Every pairing that touches a node on the given side (a source with several targets). */
export function pairsFor(group: EdgeGroup, nodeId: string, side: "source" | "target"): EdgePair[] {
  return group.pairs.filter((p) => (side === "source" ? p.from === nodeId : p.to === nodeId));
}

export interface EdgeInfo {
  group: string;
  label: string;
  from: string;
  to: string;
}

const KIND_LABEL: Record<ConnectionKind, string> = {
  sequence: "sequence",
  branch: "branch",
  calls: "calls",
  join: "join",
  "go to": "go to",
  "fan-out": "fan-out",
  "fan-in": "fan-in",
};

export const connectionKindLabel = (k: ConnectionKind) => KIND_LABEL[k];

function singleKind(e: MapEdge, to: MapNode | undefined): ConnectionKind {
  if (e.kind === "join") return "join";
  if (e.kind === "jump") return "go to";
  if (e.anchor === "v") return "sequence";
  if (to?.pill) return "calls";
  if (to?.kind === "route") return "branch";
  return "sequence";
}

export function groupEdges(edges: MapEdge[], byId: ReadonlyMap<string, MapNode>): { groups: Map<string, EdgeGroup>; infoOf: Map<string, EdgeInfo> } {
  const groups = new Map<string, EdgeGroup>();
  const infoOf = new Map<string, EdgeInfo>();
  const byGroup = new Map<string, MapEdge[]>();
  for (const e of edges) {
    const gk = e.kind === "trunk" ? e.key : (e.stub ?? e.key);
    (byGroup.get(gk) ?? byGroup.set(gk, []).get(gk)!).push(e);
  }
  const routeLabel = (from: MapNode | undefined, to: MapNode | undefined) => (to?.kind === "route" ? to.name : from?.kind === "route" ? from.name : undefined);
  for (const [gk, members] of byGroup) {
    const trunk = members.find((m) => m.kind === "trunk");
    const stubs = members.filter((m) => m.kind !== "trunk");
    const pairOf = (m: MapEdge): EdgePair => ({ edgeKey: m.key, from: m.from, to: m.to, label: routeLabel(byId.get(m.from), byId.get(m.to)) });
    let group: EdgeGroup;
    if (trunk && trunk.fanIn) {
      const to = byId.get(trunk.to);
      const froms = stubs.map((s) => byId.get(s.from)).filter((n): n is MapNode => !!n);
      group = { key: gk, kind: "fan-in", froms, tos: to ? [to] : [], members, pairs: stubs.map(pairOf), label: `${froms.length} caller${froms.length === 1 ? "" : "s"} → ${to?.name ?? "viewed"}` };
    } else if (trunk) {
      const from = byId.get(trunk.from);
      const tos = stubs.map((s) => byId.get(s.to)).filter((n): n is MapNode => !!n);
      group = { key: gk, kind: "fan-out", froms: from ? [from] : [], tos, members, pairs: stubs.map(pairOf), label: `${from?.name ?? "parent"} → ${tos.length} step${tos.length === 1 ? "" : "s"}` };
    } else {
      const e = members[0];
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      group = { key: gk, kind: singleKind(e, to), froms: from ? [from] : [], tos: to ? [to] : [], members, pairs: [pairOf(e)], label: `${from?.name ?? e.from} → ${to?.name ?? e.to}` };
    }
    groups.set(gk, group);
    /* A click on the trunk itself focuses the group's first pairing. */
    for (const m of members) {
      const pair = m.kind === "trunk" ? group.pairs[0] : group.pairs.find((p) => p.edgeKey === m.key);
      infoOf.set(m.key, { group: gk, label: group.label, from: pair?.from ?? m.from, to: pair?.to ?? m.to });
    }
  }
  return { groups, infoOf };
}
