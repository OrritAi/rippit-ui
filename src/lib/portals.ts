/*
 * Portal injection: given one workflow's canvas summary and the org's
 * workflow-level link map, append synthetic "portal" nodes for every
 * connected workflow. A portal renders as an orange chip on the canvas
 * (see ScenarioCanvas) and clicking it navigates to that workflow.
 *
 * Portal node ids are "portal:{source}:{refId}" — pages parse this prefix
 * in their node-click handler.
 */

import type {
  Connection,
  LinkMap,
  ModuleInfo,
  NodeId,
  WorkflowLink,
} from "@/app/lib/api";
import { getConnector, isProviderId } from "@/lib/connectors";
import type { ProviderId } from "@/lib/connectors/types";

export interface WorkflowRef {
  source: ProviderId;
  refId: string;
}

export function portalId(target: WorkflowRef): string {
  return `portal:${target.source}:${target.refId}`;
}

export function parsePortalId(id: NodeId): WorkflowRef | null {
  const s = String(id);
  if (!s.startsWith("portal:")) return null;
  const rest = s.slice("portal:".length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const source = rest.slice(0, sep);
  if (!isProviderId(source)) return null;
  return { source, refId: rest.slice(sep + 1) };
}

/** Parse a "{source}:{refId}" workflow-card id (unified map nodes). */
export function parseWorkflowId(id: NodeId): WorkflowRef | null {
  const s = String(id);
  const sep = s.indexOf(":");
  if (sep < 0) return null;
  const source = s.slice(0, sep);
  if (!isProviderId(source)) return null;
  return { source, refId: s.slice(sep + 1) };
}

export function workflowHref(ref: WorkflowRef): string {
  return `/w/${ref.source}/${ref.refId}`;
}

const same = (a: WorkflowRef, b: { source: string; refId: string }) =>
  a.source === b.source && a.refId === b.refId;

/** The links (in either direction) that touch one workflow. */
export function linksFor(linkMap: LinkMap, self: WorkflowRef): WorkflowLink[] {
  return linkMap.links.filter(
    (l) => same(self, l.from) || same(self, l.to)
  );
}

export function withPortals(
  summary: { modules: ModuleInfo[]; connections: Connection[] },
  linkMap: LinkMap | null,
  self: WorkflowRef
): { modules: ModuleInfo[]; connections: Connection[] } {
  if (!linkMap) return summary;
  const links = linksFor(linkMap, self);
  if (links.length === 0) return summary;

  const nameOf = (ref: { source: string; refId: string }) =>
    linkMap.workflows.find((w) => same(ref as WorkflowRef, w))?.name ||
    `${ref.source}:${ref.refId}`;

  const moduleIds = new Set(summary.modules.map((m) => m.id));
  const modules = [...summary.modules];
  const connections = [...summary.connections];
  const added = new Map<string, ModuleInfo>();

  const ensurePortal = (
    target: { source: string; refId: string },
    status: "ok" | "dead"
  ): NodeId => {
    const id = portalId(target as WorkflowRef);
    let node = added.get(id);
    if (!node) {
      node = {
        id,
        module: "portal",
        app: target.source,
        label: nameOf(target),
        depth: 0,
        x: null,
        y: null,
        hasFilter: false,
        filterName: null,
        hasErrorHandler: false,
        source: target.source as ProviderId,
        kind: "portal",
        badge: undefined,
      };
      added.set(id, node);
      modules.push(node);
    }
    if (status === "dead") node.badge = "deadLink";
    return id;
  };

  /* Incoming anchor: where a cross-workflow link lands on this platform's
     canvas — resolved by the connector descriptor. */
  const incomingAnchor = (hookId?: number): NodeId | null =>
    getConnector(self.source).incomingAnchor(summary.modules, hookId);

  for (const link of links) {
    if (same(self, link.from)) {
      // outgoing: anchor step → portal(target)
      const anchor =
        link.from.stepId && moduleIds.has(link.from.stepId)
          ? link.from.stepId
          : summary.modules[0]?.id;
      if (anchor == null) continue;
      const pid = ensurePortal(link.to, link.status);
      connections.push({
        from: anchor,
        to: pid,
        kind: link.kind,
        label: link.kind === "subflow" ? "subflow" : "webhook",
        status: link.status,
      });
    } else {
      // incoming: portal(origin) → anchor module
      const anchor = incomingAnchor(link.to.hookId);
      if (anchor == null) continue;
      const pid = ensurePortal(link.from, link.status);
      connections.push({
        from: pid,
        to: anchor,
        kind: link.kind,
        label: link.kind === "subflow" ? "subflow" : "webhook",
        status: link.status,
      });
    }
  }

  return { modules, connections };
}

/* ── Inline linked-workflow expansion ─────────────────────────────────────────
 * When a portal is expanded on the canvas, the linked workflow's steps are
 * appended inline (flowing off the portal node) rather than opening a popup.
 * Host nodes keep their bare ids; linked nodes are namespaced so selection and
 * styling can tell them apart. */

type CanvasSummary = { modules: ModuleInfo[]; connections: Connection[] };

export function linkedNodePrefix(ref: WorkflowRef): string {
  return `linked:${ref.source}:${ref.refId}:`;
}

/** Parse a "linked:{source}:{refId}:{nodeId}" id back to its parts. */
export function parseLinkedNodeId(id: NodeId): { ref: WorkflowRef; nodeId: string } | null {
  const s = String(id);
  if (!s.startsWith("linked:")) return null;
  const rest = s.slice("linked:".length);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  const source = rest.slice(0, i);
  if (!isProviderId(source)) return null;
  const afterSource = rest.slice(i + 1);
  const j = afterSource.indexOf(":");
  if (j < 0) return null;
  return { ref: { source, refId: afterSource.slice(0, j) }, nodeId: afterSource.slice(j + 1) };
}

export interface LinkedExpansion {
  ref: WorkflowRef;
  modules: ModuleInfo[];
  connections: Connection[];
}

/** Append each expanded linked workflow's steps to the base graph, connected
 * from its portal node so they flow inline. Pure — returns a new summary. */
export function expandLinked(base: CanvasSummary, expansions: LinkedExpansion[]): CanvasSummary {
  if (expansions.length === 0) return base;
  const modules = [...base.modules];
  const connections = [...base.connections];
  for (const ex of expansions) {
    const prefix = linkedNodePrefix(ex.ref);
    const ns = (nid: NodeId) => `${prefix}${nid}`;
    for (const m of ex.modules) modules.push({ ...m, id: ns(m.id), source: ex.ref.source });
    for (const c of ex.connections) connections.push({ ...c, from: ns(c.from), to: ns(c.to) });
    // Root(s) of the linked graph hang off the portal node.
    const incoming = new Set(ex.connections.map((c) => String(c.to)));
    const roots = ex.modules.filter((m) => !incoming.has(String(m.id)));
    const pid = portalId(ex.ref);
    for (const r of roots.length ? roots : ex.modules.slice(0, 1)) {
      connections.push({ from: pid, to: ns(r.id), kind: "subflow", label: "opens" });
    }
  }
  return { ...base, modules, connections };
}
