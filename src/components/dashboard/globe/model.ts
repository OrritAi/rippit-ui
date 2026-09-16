import type { Issue, LinkMap, WorkflowCard, WorkflowLink } from "@/app/lib/api";
import type { Connection } from "@/app/lib/connections-store";
import type { WorkflowIndexEntry } from "@/components/app/ConnectionsProvider";
import { CONNECTORS, byName, type ProviderId } from "@/lib/connectors";
import { workflowHref } from "@/lib/portals";
import { capCenter, capPoints, capSpread, type Vec3 } from "./geometry";
import { markerShape, type MarkerShape } from "./palette";

/*
 * Link map → globe model. Pure and memoisable. The one rule that matters:
 * a node's colour must trace back to the health signal model. Errors and
 * warnings come from breakage issues only — capture problems (Orrit could
 * not read the workflow) are flagged `data.capture` by the API and render
 * grey, never as an incident.
 */

export type NodeStatus = "ok" | "warn" | "err" | "off";
export type NodeReason = "healthy" | "error" | "warn" | "draft" | "inactive" | "not-captured" | "removed";

export interface GlobeNode {
  key: string;
  provider: ProviderId;
  refId: string;
  name: string;
  v: Vec3;
  status: NodeStatus;
  reason: NodeReason;
  card: WorkflowCard | null;
  /** Breakage issues only (capture-coded issues are kept separately). */
  issues: Issue[];
  captureIssues: Issue[];
  errorCount: number;
  warnCount: number;
  account: string | null;
  href: string;
  degree: number;
}

export interface GlobeArc {
  a: number;
  b: number;
  phase: number;
  kind: WorkflowLink["kind"];
  links: WorkflowLink[];
  dead: boolean;
}

export interface GlobeCluster {
  provider: ProviderId;
  v: Vec3;
  label: string;
}

export interface GlobePlatform {
  id: ProviderId;
  label: string;
  count: number;
  shape: MarkerShape;
}

export interface GlobeModel {
  nodes: GlobeNode[];
  arcs: GlobeArc[];
  clusters: GlobeCluster[];
  platforms: GlobePlatform[];
  hubs: Set<number>;
  labeled: Set<number>;
  byKey: Map<string, number>;
  shapes: Record<string, MarkerShape>;
  counts: { platforms: number; workflows: number; incidents: number; degraded: number };
}

export const EMPTY_MODEL: GlobeModel = {
  nodes: [],
  arcs: [],
  clusters: [],
  platforms: [],
  hubs: new Set(),
  labeled: new Set(),
  byKey: new Map(),
  shapes: {},
  counts: { platforms: 0, workflows: 0, incidents: 0, degraded: 0 },
};

const nodeKey = (provider: string, refId: string) => `${provider}:${refId}`;

interface Breakage {
  issues: Issue[];
  capture: Issue[];
  error: number;
  warn: number;
}

function groupIssues(issues: Issue[] | undefined): Map<string, Breakage> {
  const out = new Map<string, Breakage>();
  for (const issue of issues ?? []) {
    if (!issue.workflowExternalId) continue; // connection-level (e.g. needs-reauth)
    const key = nodeKey(issue.provider, issue.workflowExternalId);
    let b = out.get(key);
    if (!b) {
      b = { issues: [], capture: [], error: 0, warn: 0 };
      out.set(key, b);
    }
    if (issue.data?.capture) {
      b.capture.push(issue);
      continue;
    }
    b.issues.push(issue);
    if (issue.severity === "error") b.error++;
    else if (issue.severity === "warn") b.warn++;
  }
  return out;
}

/** Status precedence: breakage first, then platform state, then capture. */
export function deriveStatus(
  card: WorkflowCard | null,
  entry: WorkflowIndexEntry | undefined,
  breakage: Breakage | undefined,
): { status: NodeStatus; reason: NodeReason } {
  if (breakage) {
    if (breakage.error > 0) return { status: "err", reason: "error" };
    if (breakage.warn > 0) return { status: "warn", reason: "warn" };
  } else if (card?.issueCounts) {
    // Fallback only when the link map carries no issue detail; counts here
    // may include capture problems, which is why detail is preferred.
    if (card.issueCounts.error > 0) return { status: "err", reason: "error" };
    if (card.issueCounts.warn > 0) return { status: "warn", reason: "warn" };
  }
  const provider = card?.source ?? entry?.provider;
  if (provider === "ghl") {
    const s = card?.status ?? entry?.status;
    if (s != null && s !== "published") return { status: "off", reason: "draft" };
    if (s == null && entry && entry.live === false) return { status: "off", reason: "draft" };
  } else if (provider === "make") {
    if (card ? card.isActive === false : entry?.live === false) return { status: "off", reason: "inactive" };
  } else if (provider === "clickfunnels") {
    const s = card?.status ?? entry?.status;
    if (s != null && s !== "live") return { status: "off", reason: "draft" };
    if (s == null && entry && entry.live === false) return { status: "off", reason: "draft" };
  }
  const cap = card?.capture;
  if (cap?.deletedUpstreamAt) return { status: "off", reason: "removed" };
  if (cap && (cap.state === "failed" || cap.state === "never-captured")) return { status: "off", reason: "not-captured" };
  return { status: "ok", reason: "healthy" };
}

export function buildGlobeModel(input: {
  linkMap: LinkMap | null;
  index: WorkflowIndexEntry[];
  connections: Connection[];
}): GlobeModel {
  const { linkMap, index, connections } = input;
  const cards = linkMap?.workflows ?? [];
  const accountByConn = new Map(connections.map((c) => [c.id, c.displayName || c.label || c.externalId]));
  const entryByKey = new Map(index.map((e) => [nodeKey(e.provider, e.refId), e]));
  const breakage = groupIssues(linkMap?.issues);

  // Union of cards and tree entries, keyed by provider:refId.
  type Seed = { provider: ProviderId; refId: string; name: string; card: WorkflowCard | null };
  const seeds = new Map<string, Seed>();
  for (const card of cards) {
    seeds.set(nodeKey(card.source, card.refId), { provider: card.source, refId: card.refId, name: card.name || "Untitled", card });
  }
  for (const e of index) {
    const key = nodeKey(e.provider, e.refId);
    if (!seeds.has(key)) seeds.set(key, { provider: e.provider, refId: e.refId, name: e.name || "Untitled", card: null });
  }

  // Platforms present: every connected provider, plus any provider with nodes.
  const providers: ProviderId[] = [];
  for (const c of connections) if (!providers.includes(c.provider)) providers.push(c.provider);
  for (const s of seeds.values()) if (!providers.includes(s.provider)) providers.push(s.provider);

  const nodes: GlobeNode[] = [];
  const clusters: GlobeCluster[] = [];
  const shapes: Record<string, MarkerShape> = {};
  const platforms: GlobePlatform[] = [];
  let extra = 0;
  for (const provider of providers) {
    const known = provider === "ghl" || provider === "make";
    const extraIndex = known ? 0 : extra++;
    shapes[provider] = markerShape(provider, extraIndex);
    const mine = byName([...seeds.values()].filter((s) => s.provider === provider));
    const center = capCenter(provider, extraIndex);
    const pts = capPoints(center, capSpread(mine.length), mine.length);
    mine.forEach((s, i) => {
      const key = nodeKey(s.provider, s.refId);
      const entry = entryByKey.get(key);
      const b = breakage.get(key);
      const { status, reason } = deriveStatus(s.card, entry, b);
      nodes.push({
        key,
        provider: s.provider,
        refId: s.refId,
        name: s.name,
        v: pts[i],
        status,
        reason,
        card: s.card,
        issues: b?.issues ?? [],
        captureIssues: b?.capture ?? [],
        errorCount: b ? b.error : (s.card?.issueCounts?.error ?? 0),
        warnCount: b ? b.warn : (s.card?.issueCounts?.warn ?? 0),
        account: entry ? (accountByConn.get(entry.connectionId) ?? null) : null,
        href: workflowHref({ source: s.provider, refId: s.refId }),
        degree: 0,
      });
    });
    const desc = CONNECTORS[provider];
    platforms.push({ id: provider, label: desc?.label ?? provider, count: mine.length, shape: shapes[provider] });
    if (mine.length > 0) {
      clusters.push({
        provider,
        v: center,
        label: `${(desc?.shortLabel ?? provider).toLowerCase()} · ${mine.length} ${desc?.nouns.workflowPlural ?? "workflows"}`,
      });
    }
  }
  platforms.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const byKey = new Map(nodes.map((n, i) => [n.key, i]));

  // Arcs: every resolvable link; parallel links between the same pair collapse.
  const arcByPair = new Map<string, GlobeArc>();
  for (const link of linkMap?.links ?? []) {
    const a = byKey.get(nodeKey(link.from.source, link.from.refId));
    const b = byKey.get(nodeKey(link.to.source, link.to.refId));
    if (a === undefined || b === undefined || a === b) continue;
    const pair = a < b ? `${a}-${b}` : `${b}-${a}`;
    let arc = arcByPair.get(pair);
    if (!arc) {
      arc = { a, b, phase: 0, kind: link.kind, links: [], dead: false };
      arcByPair.set(pair, arc);
      nodes[a].degree++;
      nodes[b].degree++;
    }
    arc.links.push(link);
    if (link.status === "dead") arc.dead = true;
  }
  const arcs = [...arcByPair.values()].map((arc, i) => ({ ...arc, phase: i * 0.31 }));

  const hubs = new Set<number>();
  for (const arc of arcs) {
    hubs.add(arc.a);
    hubs.add(arc.b);
  }
  const labeled = new Set<number>();
  nodes.forEach((n, i) => {
    if (n.status === "err" || n.status === "warn") labeled.add(i);
  });

  return {
    nodes,
    arcs,
    clusters,
    platforms,
    hubs,
    labeled,
    byKey,
    shapes,
    counts: {
      platforms: providers.length,
      workflows: nodes.length,
      incidents: nodes.filter((n) => n.status === "err").length,
      degraded: nodes.filter((n) => n.status === "warn").length,
    },
  };
}

/* ─── Presentation helpers (pure) ─────────────────────────────────────── */

export function statusPill(node: GlobeNode): { label: string; tone: "ok" | "warn" | "err" | "muted" } {
  switch (node.status) {
    case "err":
      return { label: "Incident", tone: "err" };
    case "warn":
      return { label: "Degraded", tone: "warn" };
    case "off":
      return { label: reasonLabel(node.reason), tone: "muted" };
    default:
      return { label: node.provider === "ghl" ? "Published" : "Active", tone: "ok" };
  }
}

export function reasonLabel(reason: NodeReason): string {
  switch (reason) {
    case "draft":
      return "Draft";
    case "inactive":
      return "Inactive";
    case "not-captured":
      return "Not captured";
    case "removed":
      return "Removed";
    case "error":
      return "Incident";
    case "warn":
      return "Degraded";
    default:
      return "Active";
  }
}

/** Lower-case status word for tooltips: "active · last run 12s ago". */
export function statusWord(node: GlobeNode): string {
  return reasonLabel(node.reason).toLowerCase();
}

export function platformLabel(provider: ProviderId): string {
  return CONNECTORS[provider]?.label ?? provider;
}

export function platformShort(provider: ProviderId): string {
  return CONNECTORS[provider]?.shortLabel ?? provider;
}

export function linkKindLabel(kind: WorkflowLink["kind"]): string {
  return kind === "subflow" ? "Subflow" : "Webhook call";
}
