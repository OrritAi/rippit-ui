import type { Connection, LinkMap, ModuleInfo, WorkflowCard, WorkflowLink } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";
import type {
  EdgePair,
  MapModel,
  MapNode,
  PillStatus,
  SummaryEntry,
  WorkflowKey,
  WorkflowRef,
} from "./types";

/*
 * buildMap — link map + loaded summaries + UI state → MapModel. Pure: no
 * React, no fetch, no DOM, and only `import type` so it runs under
 * `node --experimental-strip-types` (see model.check.ts).
 *
 * Orientation (hub): the viewed workflow is the single root — one pill,
 * always open, drawn as the map's start state — with its chain to the right
 * and its targets attached at their calling steps. The workflows that call
 * it form a folded-by-default block to its left (`callers`), each joined
 * into the viewed pill by a `join` pair that starts at the caller's pill or,
 * once the caller is expanded, at the step that makes the call. The viewed
 * workflow renders nowhere else: a link to it is always that cross edge.
 *
 * Inside a workflow, a linear sequence renders as one vertical column that
 * reads as a chain: the parent (pill, route, join head) connects to the
 * first step only and every later step is `chained` — connected from the
 * previous one by a straight vertical edge. Only fan-outs (routers /
 * branches, or any step with more than one outgoing edge) nest a `route`
 * child per out edge. Nothing chains after a fan-out. Every step renders exactly once: a step reached by more
 * than one column of a band (branches of a router, entries of a workflow)
 * renders as a join head in the join column of that row, connected by
 * `join` pairs from the tails, and its chain continues as its children; a
 * step reached again from anywhere else gets a `join` pair and no card; a
 * `goto` edge keeps the real "Go to" card (detail "→ target") and adds a
 * `jump` pair to the target. Cross-workflow links attach the target as a
 * collapsed pill under the calling step.
 *
 * The filter (query) hides every subtree without a name/desc hit and
 * force-unfolds *loaded* pills only — it never asks for more data.
 * Selection is render-time state and never rebuilds the model.
 */

export interface BuildMapInput {
  viewed: WorkflowRef;
  linkMap: LinkMap | null;
  summaries: ReadonlyMap<WorkflowKey, SummaryEntry>;
  /** Pill ids (`MapNode.id`) the user unfolded. */
  expanded: Readonly<Record<string, boolean>>;
  query: string;
  /** Clock for the relative times in pill meta lines. Defaults to Date.now(). */
  now?: number;
}

const CROSS_KINDS: ReadonlySet<string> = new Set(["webhook-call", "subflow"]);

/* ─── keys ────────────────────────────────────────────────────────────── */

export function keyOf(ref: { source: ProviderId; refId: string }): WorkflowKey {
  return `${ref.source}:${ref.refId}`;
}

export function parseKey(key: string): WorkflowRef | null {
  const i = key.indexOf(":");
  if (i <= 0) return null;
  return { source: key.slice(0, i) as ProviderId, refId: key.slice(i + 1) };
}

/** Root pill id for a workflow. */
export function rootId(ref: WorkflowRef): string {
  return `wf:${keyOf(ref)}`;
}

/** The root row a node id belongs to (ids are path-based, `/`-separated). */
export function rootOf(id: string): string {
  const i = id.indexOf("/");
  return i < 0 ? id : id.slice(0, i);
}

/* ─── link map indexes ────────────────────────────────────────────────── */

interface Index {
  cards: Map<WorkflowKey, WorkflowCard>;
  outgoing: Map<WorkflowKey, WorkflowLink[]>;
  incoming: Map<WorkflowKey, WorkflowLink[]>;
}

function index(linkMap: LinkMap | null): Index {
  const cards = new Map<WorkflowKey, WorkflowCard>();
  const outgoing = new Map<WorkflowKey, WorkflowLink[]>();
  const incoming = new Map<WorkflowKey, WorkflowLink[]>();
  if (!linkMap) return { cards, outgoing, incoming };
  for (const w of linkMap.workflows) cards.set(keyOf(w), w);
  for (const l of linkMap.links) {
    if (!CROSS_KINDS.has(l.kind)) continue;
    const from = keyOf(l.from);
    const to = keyOf(l.to);
    if (from === to) continue;
    (outgoing.get(from) ?? outgoing.set(from, []).get(from)!).push(l);
    (incoming.get(to) ?? incoming.set(to, []).get(to)!).push(l);
  }
  return { cards, outgoing, incoming };
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Workflows that call `viewed` (one entry per workflow, sorted by name). */
export function callersOf(linkMap: LinkMap | null, viewed: WorkflowRef): { ref: WorkflowRef; link: WorkflowLink; name: string }[] {
  const { cards, incoming } = index(linkMap);
  const seen = new Set<WorkflowKey>();
  const out: { ref: WorkflowRef; link: WorkflowLink; name: string }[] = [];
  for (const l of incoming.get(keyOf(viewed)) ?? []) {
    const key = keyOf(l.from);
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = { source: l.from.source, refId: l.from.refId };
    out.push({ ref, link: l, name: cards.get(key)?.name ?? key });
  }
  return out.sort(byName);
}

/** What to open on load: the first caller and the viewed pill under it, or
 *  the viewed root when nothing calls it. */
export function initialExpanded(linkMap: LinkMap | null, viewed: WorkflowRef): Record<string, boolean> {
  /* The viewed pill is open by construction (pinned); callers start folded. */
  void linkMap;
  void viewed;
  return {};
}

/** Id of `target`'s pill when attached under the pill `ownerPillId` — the
 *  same id whether the owner is folded (pill → pill) or unfolded (under the
 *  calling step), so expansion, selection and deep links survive a toggle. */
export function attachedPillId(ownerPillId: string, target: WorkflowRef): string {
  return `${ownerPillId}/wf:${keyOf(target)}`;
}

/** The first rendered pill for `viewed` (under `root` when given), or null
 *  while its caller has not unfolded yet. */
export function viewedPillId(model: MapModel, viewed: WorkflowRef, root?: string): string | null {
  const key = keyOf(viewed);
  for (const n of model.flat) {
    if (n.ref && keyOf(n.ref) === key && (!root || rootOf(n.id) === root)) return n.id;
  }
  return null;
}

/** Ids for "Expand all": every rendered pill that can unfold, plus what is
 *  already open. One bounded load wave; click again to go deeper. */
export function expandAllSnapshot(model: MapModel, expanded: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const next: Record<string, boolean> = { ...expanded };
  for (const n of model.flat) {
    if (n.pill && !n.pill.pinned && !n.pill.cycle && !n.pill.unavailable && !n.pill.error) next[n.id] = true;
  }
  return next;
}

/** Chip text for a pill, in the design's vocabulary. */
export function pillChip(node: MapNode): string | null {
  const p = node.pill;
  if (!p) return null;
  /* The pinned (viewed) pill has no toggle; it only states a problem. */
  if (p.pinned) return p.unavailable ? "steps unavailable" : p.error ? "not captured" : null;
  if (p.cycle) return "↺ already open above";
  if (p.unavailable) return "steps unavailable";
  if (p.error) return "not captured";
  if (p.loading) return "loading";
  // No count: before a summary loads the link map may not carry one (Make
  // entries do not), and "+ 0 steps" reads as a broken workflow.
  if (p.open) return "− fold";
  return "+ expand";
}

/* ─── copy helpers ────────────────────────────────────────────────────── */

const PROVIDER_LABEL: Record<string, string> = {
  make: "make",
  ghl: "ghl",
  clickfunnels: "clickfunnels",
  clickfunnels_classic: "clickfunnels classic",
};

function noun(source: ProviderId): string {
  return source === "make" ? "scenario" : "workflow";
}

function pillKind(source: ProviderId): "workflow" | "scenario" {
  return source === "make" ? "scenario" : "workflow";
}

function linkPhrase(kind: WorkflowLink["kind"]): string {
  return kind === "subflow" ? "as a subflow" : "over a webhook";
}

/** Coarse relative time, same grain as lib/time.ts (which we cannot import
 *  here without a value import through `@/`). */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const secs = (now - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(secs)) return "never";
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function cardStatus(card: WorkflowCard | undefined): PillStatus | undefined {
  if (!card) return undefined;
  if (typeof card.isActive === "boolean") return card.isActive ? "ok" : "off";
  if (card.status == null) return undefined;
  return /^(published|active|on|live)$/i.test(card.status) ? "ok" : "off";
}

/** Under-pill line: only what carries a signal (last run, capture state,
 *  paused). No provider/noun prefix — the puck already says which platform. */
function metaLine(card: WorkflowCard | undefined, now: number): string | undefined {
  const parts: string[] = [];
  if (card?.lastRun?.at) parts.push(`last run ${ago(card.lastRun.at, now)}`);
  else if (card?.lastRun?.status) parts.push(`last run ${card.lastRun.status}`);
  const cap = card?.capture;
  if (cap?.deletedUpstreamAt) parts.push("deleted upstream");
  else if (cap?.state === "never-captured") parts.push("not captured");
  else if (cap?.state === "failed") parts.push("capture failed");
  else if (card?.status === "paused") parts.push("paused");
  return parts.length ? parts.join(" · ") : undefined;
}

const routeLetter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");

/** "route · yes" from a labelled edge; else "route · A" (GHL) / "route · 1" (Make). */
function routeLabel(edge: Connection, i: number, source: ProviderId): string {
  const label = edge.label?.trim();
  if (label) return /^route\s*·/i.test(label) ? label : `route · ${label}`;
  return source === "ghl" ? `route · ${routeLetter(i)}` : `route · ${i + 1}`;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Stable partition: collapsed pills, then unfolded ones. */
const collapsedFirst = (pills: MapNode[]): MapNode[] => [...pills.filter((p) => !p.pill?.open), ...pills.filter((p) => !!p.pill?.open)];

/* ─── build ───────────────────────────────────────────────────────────── */

export function buildMap(input: BuildMapInput): MapModel {
  const { viewed, linkMap, summaries, expanded } = input;
  const now = input.now ?? Date.now();
  const q = input.query.trim().toLowerCase();
  const { cards, outgoing, incoming } = index(linkMap);
  const viewedKey = keyOf(viewed);
  const wantedSet = new Set<WorkflowKey>();

  const viewedName = (() => {
    const e = summaries.get(viewedKey);
    return (e?.state === "ok" ? e.summary.name : null) ?? cards.get(viewedKey)?.name ?? viewedKey;
  })();

  const hitOf = (name: string, desc: string) => q.length > 0 && `${name} ${desc}`.toLowerCase().includes(q);

  /* A workflow pill: a root, or attached under the step that calls it. */
  const pill = (
    ref: WorkflowRef,
    parentId: string | null,
    depth: number,
    path: WorkflowKey[],
    link: WorkflowLink | null,
    callerStep: string | null,
    unresolvedStep: boolean,
    /** The owning pill's id for an attached pill (stable across the owner's fold/unfold). */
    ownerPillId: string | null = null
  ): MapNode => {
    const key = keyOf(ref);
    const id = ownerPillId ? attachedPillId(ownerPillId, ref) : parentId ? `${parentId}/wf:${key}` : `wf:${key}`;
    const card = cards.get(key);
    const entry = summaries.get(key);
    const summary = entry?.state === "ok" ? entry.summary : null;
    const error = entry?.state === "error" ? entry.error : undefined;
    const unavailable = entry?.state === "error" ? !!entry.stepsUnavailable : !!summary?.stepsUnavailable;
    const cycle = path.includes(key);
    /* Under a filter only what is already loaded unfolds — no fetch storms. */
    const canUnfold = summary != null || unavailable;
    /* The viewed root is pinned: always open, whatever `expanded` says. */
    const pinned = parentId === null && ownerPillId === null && key === viewedKey;
    const open = pinned || (!cycle && (q ? canUnfold : !!expanded[id]));
    const loading = open && entry?.state !== "ok" && entry?.state !== "error";
    if (open && !entry) wantedSet.add(key);

    const ownPath = [...path, key];
    const label = PROVIDER_LABEL[ref.source] ?? ref.source;
    let desc: string;
    if (link) {
      desc = `${label} ${noun(ref.source)} · called ${linkPhrase(link.kind)}${callerStep ? ` from ${callerStep}` : ""}`;
      if (unresolvedStep) desc += " · calling step not captured";
      if (link.status === "dead") desc += " · link is dead";
    } else if (key === viewedKey) {
      desc = `${label} ${noun(ref.source)} · the ${noun(ref.source)} you are viewing`;
    } else {
      const call = (incoming.get(viewedKey) ?? []).find((l) => keyOf(l.from) === key);
      desc = `${label} ${noun(ref.source)} · calls ${viewedName}${call ? ` ${linkPhrase(call.kind)}` : ""}`;
    }

    const node: MapNode = {
      id,
      parentId,
      depth,
      kind: pillKind(ref.source),
      app: ref.source,
      name: summary?.name ?? card?.name ?? key,
      desc,
      status: cardStatus(card),
      meta: metaLine(card, now),
      ref,
      isViewed: key === viewedKey || undefined,
      rippitHref: key === viewedKey ? undefined : `/w/${ref.source}/${ref.refId}`,
      nativeUrl: summary?.nativeUrl ?? card?.nativeUrl ?? null,
      path: ownPath,
      children: [],
      childCount: summary?.modules.length ?? card?.stepCount ?? 0,
      attachedRefs: [],
      joins: [],
      descendants: 0,
      pill: {
        open,
        loading,
        error,
        cycle,
        pinned: pinned || undefined,
        unavailable,
        link: link ? { kind: link.kind, status: link.status } : undefined,
        unresolvedStep: unresolvedStep || undefined,
      },
      hit: false,
    };
    node.hit = hitOf(node.name, node.desc);

    if (open && summary && !unavailable) {
      node.children = stepsOf(summary, key, node, depth + 1, ownPath);
    } else if (!cycle) {
      /* Folded (or open without step content, or still loading): the map
         still shows what this workflow is connected to — its link-map
         targets hang directly under the pill, one per target, folded ones
         first. No summary is needed for this, so a folded pill never asks
         for one. Unfolding moves each pill under the step that calls it,
         with the same id. */
      const seenTargets = new Set<WorkflowKey>();
      node.children = collapsedFirst(
        (outgoing.get(key) ?? [])
          .filter((l) => keyOf(l.to) !== viewedKey && !seenTargets.has(keyOf(l.to)) && seenTargets.add(keyOf(l.to)))
          .map((l) => pill({ source: l.to.source, refId: l.to.refId }, id, depth + 1, ownPath, l, l.from.stepName ?? null, false, id))
      );
    }
    node.attachedRefs = node.children.flatMap((c) => (c.ref ? [c.ref] : []));
    return node;
  };

  /* One workflow's steps as columns hanging off `ownerId` (its pill). */
  /* Cross pairs (join / jump) collected while building; resolved to visible
     nodes after the filter, in the final walk. */
  const crossPairs: { from: string; to: string; kind: "join" | "jump" }[] = [];

  const stepsOf = (
    summary: { modules: ModuleInfo[]; connections: Connection[]; nativeUrl?: string | null },
    key: WorkflowKey,
    owner: MapNode,
    depth: number,
    path: WorkflowKey[]
  ): MapNode[] => {
    const ownerUrl = summary.nativeUrl ?? null;
    const source = parseKey(key)?.source ?? viewed.source;
    const modules = new Map<string, ModuleInfo>();
    for (const m of summary.modules) modules.set(String(m.id), m);

    const out = new Map<string, Connection[]>();
    const gotos = new Map<string, Connection[]>();
    const indeg = new Map<string, number>();
    for (const c of summary.connections) {
      const from = String(c.from);
      const to = String(c.to);
      if (!modules.has(from) || !modules.has(to)) continue;
      const kind = c.kind ?? "sequence";
      if (kind === "goto") {
        (gotos.get(from) ?? gotos.set(from, []).get(from)!).push(c);
      } else if (kind === "sequence" || kind === "branch") {
        (out.get(from) ?? out.set(from, []).get(from)!).push(c);
        indeg.set(to, (indeg.get(to) ?? 0) + 1);
      }
    }

    /* Entries: triggers first, then by ordinal, orphans (no ordinal) last. */
    const rank = (m: ModuleInfo) => (m.kind === "trigger" ? 0 : m.ordinal ? 1 : 2);
    let entries = summary.modules.filter((m) => (indeg.get(String(m.id)) ?? 0) === 0);
    if (entries.length === 0 && summary.modules.length > 0) entries = [summary.modules[0]];
    entries = [...entries].sort((a, b) => rank(a) - rank(b) || natural(a.ordinal ?? "", b.ordinal ?? ""));
    const entryId = entries[0] ? String(entries[0].id) : null;

    /* Cross-workflow links leaving this workflow, by calling step. */
    const linksAt = new Map<string, WorkflowLink[]>();
    const unresolved: WorkflowLink[] = [];
    for (const l of outgoing.get(key) ?? []) {
      const sid = l.from.stepId != null ? String(l.from.stepId) : "";
      if (sid && modules.has(sid)) (linksAt.get(sid) ?? linksAt.set(sid, []).get(sid)!).push(l);
      else unresolved.push(l);
    }

    const nameOf = (id: string) => modules.get(id)?.label ?? id;

    /* Every step renders exactly once: step id → its node. A chain that
       reaches a rendered step ends in a cross pair instead of a second card. */
    const rendered = new Map<string, MapNode>();
    /* One attached pill per target workflow, under the first step that
       calls it — its id is `<owner pill>/wf:<key>`, so it must be unique per
       owning workflow, not per step. */
    const attached = new Set<WorkflowKey>();
    const cross: { from: string; toStep: string; kind: "join" | "jump" }[] = [];

    const makeStep = (cur: string, parentId: string, d: number): MapNode => {
      const m = modules.get(cur)!;
      const jumps = gotos.get(cur) ?? [];
      const target = jumps.length ? String(jumps[0].to) : null;
      const node: MapNode = {
        id: `${parentId}/m:${cur}`,
        parentId,
        depth: d,
        kind: "step",
        app: m.app,
        name: m.label,
        desc: target ? `→ ${nameOf(target)}` : (m.summary ?? ""),
        stepRef: { key, stepId: cur },
        module: m,
        nativeUrl: ownerUrl,
        path,
        children: [],
        childCount: 0,
        attachedRefs: [],
        joins: [],
        descendants: 0,
        jumpTo: target ? { stepId: target, targetName: nameOf(target) } : undefined,
        hit: false,
      };
      node.hit = hitOf(node.name, node.desc);
      return node;
    };

    /* Hang a step's outgoing structure off it: routes for a fan-out (each
       route walks its own chain with this step as the group), attached
       pills, the goto cross pair. `continueAsChildren`: a join head's
       continuation chain becomes its children band (it is a mini-root: the
       tails connect to the head, the head fans to its chain). Returns the
       next step of a plain chain, or undefined. */
    const attachOut = (node: MapNode, cur: string, d: number, continueAsChildren: boolean): string | undefined => {
      const m = modules.get(cur)!;
      const outs: Connection[] = out.get(cur) ?? [];
      const fan: boolean = outs.length > 1 || m.kind === "router" || m.kind === "branch";
      const kids: MapNode[] = [];
      if (fan) {
        outs.forEach((e, i) => {
          const routeId = `${node.id}/route:${cur}:${i}`;
          const route: MapNode = {
            id: routeId,
            parentId: node.id,
            depth: d + 1,
            kind: "route",
            app: "router",
            name: routeLabel(e, i, source),
            desc: `Route ${i + 1} of ${outs.length} from ${m.label}`,
            stepRef: { key, stepId: cur },
            nativeUrl: ownerUrl,
            path,
            children: [],
            childCount: 0,
            attachedRefs: [],
            joins: [],
            descendants: 0,
            hit: false,
          };
          route.hit = hitOf(route.name, route.desc);
          route.children = chain(String(e.to), routeId, d + 2, node, false);
          route.childCount = route.children.length;
          kids.push(route);
        });
      } else if (continueAsChildren && outs.length === 1) {
        kids.push(...chain(String(outs[0].to), node.id, d + 1, node, true));
      }
      /* One pill per target workflow, however many links point at it.
         Collapsed pills render before unfolded ones (stable otherwise) so a
         folded sibling stays beside the calling step and only the unfolded
         pill's subtree extends downward. `open` already covers a pill whose
         summary is still loading, so nothing reorders when it lands. */
      const pills: MapNode[] = [];
      for (const l of linksAt.get(cur) ?? []) {
        if (keyOf(l.to) === viewedKey || attached.has(keyOf(l.to))) continue;
        attached.add(keyOf(l.to));
        pills.push(pill({ source: l.to.source, refId: l.to.refId }, node.id, d + 1, path, l, m.label, false, owner.id));
      }
      if (cur === entryId) {
        for (const l of unresolved) {
          if (keyOf(l.to) === viewedKey || attached.has(keyOf(l.to))) continue;
          attached.add(keyOf(l.to));
          pills.push(pill({ source: l.to.source, refId: l.to.refId }, node.id, d + 1, path, l, null, true, owner.id));
        }
      }
      kids.push(...collapsedFirst(pills));
      const jumped = new Set<string>();
      for (const g of gotos.get(cur) ?? []) {
        if (jumped.has(String(g.to))) continue;
        jumped.add(String(g.to));
        cross.push({ from: node.id, toStep: String(g.to), kind: "jump" });
      }
      node.children = kids;
      node.childCount = kids.length;
      node.attachedRefs = kids.flatMap((c) => (c.ref ? [c.ref] : []));
      return fan || continueAsChildren || outs.length === 0 ? undefined : String(outs[0].to);
    };

    /* Walk one chain from `startId` under `parentId` (a band column: the
       chain fans from the group). `group` owns the row this column sits in
       — [group][children band][join column]. A step with more than one
       predecessor met from a band column renders once as a join head of
       that group and continues as the head's children; `inJoin` marks a
       head's own continuation, where further shared steps stay inline. */
    const chain = (startId: string, parentId: string, d: number, group: MapNode, inJoin: boolean): MapNode[] => {
      const nodes: MapNode[] = [];
      let next: string | undefined = startId;
      let prev: MapNode | null = null;
      while (next !== undefined) {
        const cur: string = next;
        const from = prev?.id ?? parentId;
        if (rendered.has(cur)) {
          cross.push({ from, toStep: cur, kind: "join" });
          break;
        }
        if (!inJoin && (indeg.get(cur) ?? 0) >= 2) {
          const head = makeStep(cur, group.id, group.depth + 1);
          rendered.set(cur, head);
          group.joins.push(head);
          attachOut(head, cur, group.depth + 1, true);
          cross.push({ from, toStep: cur, kind: "join" });
          break;
        }
        const node = makeStep(cur, parentId, d);
        if (prev) node.chained = true;
        rendered.set(cur, node);
        nodes.push(node);
        next = attachOut(node, cur, d, false);
        prev = node;
      }
      return nodes;
    };

    const nodes: MapNode[] = [];
    for (const e of entries) {
      const id = String(e.id);
      if (rendered.has(id)) continue;
      nodes.push(...chain(id, owner.id, depth, owner, false));
    }
    for (const c of cross) {
      const to = rendered.get(c.toStep);
      if (to) crossPairs.push({ from: c.from, to: to.id, kind: c.kind });
    }
    return nodes;
  };

  /* Hub: the viewed workflow is the one root; its callers form the block. */
  const viewedRoot = pill(viewed, null, 0, [], null, null, false);
  let roots = [viewedRoot];
  let callers = callersOf(linkMap, viewed).map((c) => pill(c.ref, null, 0, [], null, null, false));

  /* Caller → viewed cross edges: from the calling step when the caller is
     expanded and that step is rendered, else from the caller's pill; one
     per distinct source. */
  const findStep = (n: MapNode, stepId: string): MapNode | null => {
    if (n.kind === "step" && n.stepRef?.stepId === stepId) return n;
    for (const c of n.children) {
      const f = findStep(c, stepId);
      if (f) return f;
    }
    for (const j of n.joins) {
      const f = findStep(j, stepId);
      if (f) return f;
    }
    return null;
  };
  for (const c of callers) {
    const sources = new Set<string>();
    for (const l of incoming.get(viewedKey) ?? []) {
      if (keyOf(l.from) !== keyOf(c.ref!)) continue;
      const sid = l.from.stepId != null ? String(l.from.stepId) : "";
      const src = (c.pill?.open && sid ? findStep(c, sid) : null) ?? c;
      if (sources.has(src.id)) continue;
      sources.add(src.id);
      crossPairs.push({ from: src.id, to: viewedRoot.id, kind: "join" });
    }
  }

  /* Filter: keep subtrees with a hit anywhere, at every level. */
  if (q) {
    const any = new Map<MapNode, boolean>();
    const mark = (n: MapNode): boolean => {
      let a = n.hit;
      for (const c of n.children) if (mark(c)) a = true;
      for (const j of n.joins) if (mark(j)) a = true;
      any.set(n, a);
      return a;
    };
    const prune = (n: MapNode) => {
      n.children = n.children.filter((c) => any.get(c));
      n.children.forEach(prune);
      n.joins = n.joins.filter((j) => any.get(j));
      n.joins.forEach(prune);
      if (n.kind === "step" || n.kind === "route") n.childCount = n.children.length;
      n.attachedRefs = n.children.flatMap((c) => (c.ref ? [c.ref] : []));
    };
    roots.forEach(mark);
    callers.forEach(mark);
    roots = roots.filter((r) => any.get(r));
    callers = callers.filter((r) => any.get(r));
    roots.forEach(prune);
    callers.forEach(prune);
  }

  /* Walk the visible tree once for pairs, flat order and the lookups. */
  const pairs: EdgePair[] = [];
  const flat: MapNode[] = [];
  const byId = new Map<string, MapNode>();
  const byStep = new Map<string, MapNode>();
  let openPills = 0;
  const walk = (n: MapNode): number => {
    flat.push(n);
    byId.set(n.id, n);
    if (n.stepRef && n.kind === "step") {
      const sk = `${n.stepRef.key}:${n.stepRef.stepId}`;
      if (!byStep.has(sk)) byStep.set(sk, n);
    }
    if (n.pill?.open) openPills++;
    let below = 0;
    let prev: MapNode | null = null;
    for (const c of n.children) {
      /* A chained step hangs off the previous step (vertical); a chain start,
         a route, or an attached pill hangs off the parent. Under a filter a
         chained step whose predecessor was pruned falls back to the parent. */
      if (c.chained && prev && !prev.pill) pairs.push({ key: `${prev.id}>${c.id}`, from: prev.id, to: c.id, depth: n.depth, kind: "tree", anchor: "v" });
      else pairs.push({ key: `${n.id}>${c.id}`, from: n.id, to: c.id, depth: n.depth, kind: "tree" });
      prev = c;
      below += 1 + walk(c);
    }
    for (const j of n.joins) below += 1 + walk(j);
    n.descendants = below;
    return below;
  };
  callers.forEach(walk);
  roots.forEach(walk);
  /* Cross pairs whose both ends survived the filter. */
  for (const c of crossPairs) {
    const from = byId.get(c.from);
    if (!from || !byId.has(c.to)) continue;
    pairs.push({ key: `${c.from}>${c.to}#${c.kind}`, from: c.from, to: c.to, depth: from.depth, kind: c.kind });
  }

  const connected = new Set<WorkflowKey>();
  for (const l of incoming.get(viewedKey) ?? []) connected.add(keyOf(l.from));
  for (const l of outgoing.get(viewedKey) ?? []) connected.add(keyOf(l.to));

  return {
    roots,
    callers,
    pairs,
    flat,
    byId,
    byStep,
    wanted: [...wantedSet],
    counts: {
      rendered: flat.length,
      openPills,
      matchedRoots: roots.length + callers.length,
      connected: connected.size,
    },
  };
}
