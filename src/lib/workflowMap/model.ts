import type { Connection, LinkMap, ModuleInfo, ShapeElement, WorkflowCard, WorkflowLink, WorkflowShapes } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";
import type {
  EdgePair,
  FoldState,
  Layer,
  MapModel,
  MapNode,
  PackState,
  PillStatus,
  SummaryEntry,
  WorkflowKey,
  WorkflowRef,
} from "./types";
import { FOLD_AT, PACK_AT } from "./tokens.ts";

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
 * Inside a workflow, a linear sequence is a chain: the parent (pill, route,
 * join head) links to the first step, and every later step is `chained` —
 * linked from the card before it. Only fan-outs (routers / branches, or any
 * step with more than one outgoing edge) nest a `route` child per out edge,
 * and a fan-out always ends its chain. The viewed workflow's own flow (steps
 * and routes marked `main`) runs LEFT TO RIGHT — straight rail edges
 * (`anchor: "h"`), with a workflow one of its steps calls hanging below that
 * step (`anchor: "drop"`). A connected workflow runs TOP TO BOTTOM — its
 * chain stacks under its pill (`anchor: "v"`), and what its steps call sits
 * to their right. The tree itself is unchanged by direction — parent,
 * children and `chained` mean what they always did; `flowsRight`, `chainsOf`
 * and `stacksChain` decide it, `MapTree` lays out by them and the anchors say
 * how each line meets its cards. Every step renders exactly once: a step reached by more
 * than one column of a band (branches of a router, entries of a workflow)
 * renders as a join head in the join column of that row, connected by
 * `join` pairs from the tails, and its chain continues as its children; a
 * step reached again from anywhere else gets a `join` pair and no card; a
 * `goto` edge keeps the real "Go to" card (detail "→ target") and adds a
 * `jump` pair to the target. Cross-workflow links attach the target as a
 * collapsed pill under the calling step.
 *
 * Repeated structure is folded away before any of that happens. Every
 * fan-out arm is drawn as the one route card that already headed it,
 * annotated with what it stands for — each branch its own card, never merged
 * with siblings that share its shape. The withheld steps are
 * removed HERE, not hidden in the DOM — `walk()` builds `flat`, `byId`, the
 * pairs and the render tree in one pass, so tab order, edge measurement, the
 * LITE threshold and the `descendants` layout weight all describe what is
 * actually drawn. No node is ever invented: a fold card is the real route,
 * so `byId` gains nothing and the sidebar payload is unchanged.
 *
 * The filter (query) hides every subtree without a name/desc hit and
 * force-unfolds *loaded* pills only — it never asks for more data. It also
 * unfolds every arm, so a query searches the whole workflow.
 * Selection is render-time state and never rebuilds the model.
 */

export interface BuildMapInput {
  viewed: WorkflowRef;
  linkMap: LinkMap | null;
  summaries: ReadonlyMap<WorkflowKey, SummaryEntry>;
  /** Pill ids (`MapNode.id`) the user unfolded, plus the `armKey()` entries
   *  for the cards they opened. */
  expanded: Readonly<Record<string, boolean>>;
  query: string;
  /** Clock for the relative times in pill meta lines. Defaults to Date.now(). */
  now?: number;
  /** `GET …/shapes` per workflow. Its `elements` tree IS the fold plan —
   *  where each card goes, which step it draws, and exactly which steps each
   *  folded member withholds — so nothing is derived twice. Absent (slow
   *  endpoint, older API, a provider with no step content): the canvas falls
   *  back to folding arms from the graph alone, which is coarser but never
   *  broken. */
  shapes?: ReadonlyMap<WorkflowKey, WorkflowShapes> | null;
  /** Which rung of the ladder to draw. Defaults to "structure". Deliberately
   *  not derived from zoom: a reader zooming out to see more must never find
   *  the map has silently changed what it is showing them. */
  layer?: Layer;
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


/** The first rendered pill for `viewed` (under `root` when given), or null
 *  while its caller has not unfolded yet. */
export function viewedPillId(model: MapModel, viewed: WorkflowRef, root?: string): string | null {
  const key = keyOf(viewed);
  for (const n of model.flat) {
    if (n.ref && keyOf(n.ref) === key && (!root || rootOf(n.id) === root)) return n.id;
  }
  return null;
}

/** Ids for "Expand all": every rendered pill that can unfold and every
 *  rendered card standing for more than itself, plus what is already open.
 *  One bounded wave; click again to go deeper — arms nested inside one that
 *  just opened wait for the next press. On the Overview, a card standing for
 *  a whole fan-out opens each arm behind it, so descending lands open. */
export function expandAllSnapshot(model: MapModel, expanded: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const next: Record<string, boolean> = { ...expanded };
  /* A workflow called from several steps opens at ONE of them — the one
     already open, else the first in render order. Asking for every instance
     would draw its steps several times, and would leave the others primed to
     spring open the moment the one on screen is folded. */
  const opening = new Set<WorkflowKey>();
  for (const n of model.flat) if (n.pill?.open && n.ref) opening.add(keyOf(n.ref));
  for (const n of model.flat) {
    if (n.pill && n.ref && !n.pill.pinned && !n.pill.cycle && !n.pill.unavailable && !n.pill.error && !opening.has(keyOf(n.ref))) {
      opening.add(keyOf(n.ref));
      next[n.id] = true;
    }
    if (n.fold && n.stepRef) {
      next[armKey(n.stepRef.key, n.fold.armId)] = true;
      for (const mem of n.fold.members) next[armKey(n.stepRef.key, mem.stepId)] = true;
    }
    if (n.pack && n.stepRef) next[armKey(n.stepRef.key, n.stepRef.stepId)] = true;
  }
  return next;
}

/**
 * `expanded` after opening or closing a pill. A workflow called from several
 * steps is drawn open at one of them, so this is the ONE place that rule is
 * applied to reader state: opening a copy closes every other copy of the same
 * workflow, and closing it closes them all — folding the copy on screen can
 * never make another spring open elsewhere, and a chip can never go on naming
 * a copy that has been folded. Pill ids end `/wf:<key>`, or are `wf:<key>` at
 * the root.
 */
export function withPillOpen(expanded: Readonly<Record<string, boolean>>, node: MapNode, open: boolean): Record<string, boolean> {
  const next: Record<string, boolean> = { ...expanded };
  if (node.pill && node.ref) {
    const target = `wf:${keyOf(node.ref)}`;
    for (const k of Object.keys(next)) if (k === target || k.endsWith(`/${target}`)) next[k] = false;
  }
  next[node.id] = open;
  return next;
}

/**
 * The steps an open tile draws after its card, in order: what folding it takes
 * away again. They continue the card's own row — its chained siblings, or a
 * join head's own chain — up to the tile's last step. Empty for anything that
 * is not an open pack.
 */
export function packedSteps(model: Pick<MapModel, "byId">, node: MapNode): MapNode[] {
  const pack = node.pack;
  if (!pack?.open) return [];
  const parent = node.parentId ? model.byId.get(node.parentId) : undefined;
  if (!parent) return [];
  const head = parent.joins.includes(node);
  const after = head ? node.children : parent.children.slice(parent.children.indexOf(node) + 1);
  const out: MapNode[] = [];
  for (const s of after) {
    if (s.kind !== "step" || !(s.chained || (head && out.length === 0))) break;
    out.push(s);
    if (s.stepRef?.stepId === pack.lastId) break;
  }
  return out;
}

/** What a pill's flow is made of, in its platform's own word: a Make
 *  scenario is built from modules, everything else from steps. */
export function pillNoun(node: MapNode, count = 2): string {
  const make = node.ref?.source === "make";
  if (count === 1) return make ? "module" : "step";
  return make ? "modules" : "steps";
}

/** Chip text for a pill, in the design's vocabulary. */
export function pillChip(node: MapNode): string | null {
  const p = node.pill;
  if (!p) return null;
  /* The pinned (viewed) pill has no toggle; it only states a problem. */
  if (p.pinned) return p.unavailable ? "steps unavailable" : p.error ? "not captured" : null;
  if (p.cycle) return "↺ already open above";
  if (p.openAt) return `↗ open in ${p.openAt.where}`;
  if (p.unavailable) return "steps unavailable";
  if (p.error) return "not captured";
  /*
   * The toggle's label says what is inside — "12 steps" — and says it the
   * same way open, closed or loading. Which of those it is belongs to the
   * circle beside it (WorkflowPill), so a toggle never changes the label's
   * width, never resizes the capsule every edge attaches to, and no line
   * moves because a pill was opened.
   *
   * A count only when one is known: the summary, else the link-map card.
   * Make's link map carries none before a summary loads, and "0 modules"
   * reads as a broken scenario, so an unknown count names the noun alone.
   */
  const n = node.childCount;
  const noun = pillNoun(node, n);
  return n > 0 ? `${n} ${noun}` : noun.charAt(0).toUpperCase() + noun.slice(1);
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

/**
 * What a branch is called. The platform's own branch name, and nothing
 * around it — a branch card is the next step, so its name stands alone and
 * is the most legible thing in the band. No `route ·` prefix, no position.
 *
 * Unlabelled branches are the awkward case and the honest answer is still a
 * name: the step the branch leads to, which is what it is. Only when even
 * that is unknown does it fall back to the platform's own ordinal (GHL
 * letters its branches, Make numbers them).
 */
function routeLabel(edge: Connection, i: number, source: ProviderId, leadsTo?: string): string {
  const label = edge.label?.trim().replace(/^route\s*·\s*/i, "");
  if (label) return label;
  if (leadsTo) return leadsTo;
  return source === "ghl" ? routeLetter(i) : String(i + 1);
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Stable partition: collapsed pills, then unfolded ones. */
const collapsedFirst = (pills: MapNode[]): MapNode[] => [...pills.filter((p) => !p.pill?.open), ...pills.filter((p) => !!p.pill?.open)];

/* ─── direction ───────────────────────────────────────────────────────── */

/** Whether a card's line runs left to right: the viewed workflow's flow, and
 *  every branch lane anywhere. Only a connected workflow's own trunk — its
 *  pill and the steps under it — runs top to bottom (`MapNode.down`).
 *  `MapTree` lays out by this and `walk()` anchors by it, so the two cannot
 *  disagree about which way a line goes. */
export const flowsRight = (node: MapNode): boolean => !node.down;

/** How a fan-out's lanes stack around its rail: the first `above` sit over
 *  it, and when the count is odd the next one is on it. The Condition sits
 *  in the middle of its branches, which fan above and below its line. */
export const fanSplit = (lanes: number): { above: number; onRail: boolean } => ({ above: Math.floor(lanes / 2), onRail: lanes % 2 === 1 });

/** A group's step children split into its chains: a new chain starts at
 *  every step that does not continue the one before it. Under a filter a
 *  chained step whose predecessor was pruned joins the chain before it, just
 *  as `walk()` links it from the card before it. */
export function chainsOf(node: MapNode): MapNode[][] {
  const out: MapNode[][] = [];
  for (const s of node.children) {
    if (s.kind !== "step") continue;
    if (s.chained && out.length > 0) out[out.length - 1].push(s);
    else out.push([s]);
  }
  return out;
}

/** A connected group whose one chain stacks under its own card, joined by
 *  "v" lines. With two or more entries, or shared steps, its chains keep to
 *  a column on its right instead, as they always have. */
export const stacksChain = (node: MapNode): boolean => !flowsRight(node) && chainsOf(node).length <= 1 && node.joins.length === 0;

/* ─── arrow keys ──────────────────────────────────────────────────────── */

export type Arrow = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * Where an arrow key moves from `node`, following the picture `MapTree`
 * draws — or null when nothing lies that way, and the key does nothing.
 * Opening and folding (→ on a shut card, ← on an open one) are the keyboard
 * hook's, and come first.
 *
 * ALONG a flow — right in the viewed workflow, down in a connected one — the
 * arrows walk its line: card to card, a group card to its first step, and in
 * the viewed workflow a fan-out to its first branch. Back the other way the
 * first card of a line returns to the card it hangs from.
 *
 * ACROSS a flow they move between lanes. In the viewed workflow Down enters
 * the workflows a step calls; otherwise Down and Up go to the next and
 * previous lane — the next branch, entry, shared step or root — climbing out
 * to the enclosing lane when this one has no neighbour that way. In a
 * connected workflow Right enters what a step calls, or its branches, and
 * Left returns to the card its column hangs from; Down past the end of a
 * column goes on to the next lane.
 */
export function arrowTarget(model: Pick<MapModel, "byId" | "roots" | "callers" | "pairs">, node: MapNode, key: Arrow): MapNode | null {
  const parentOf = (n: MapNode) => (n.parentId ? model.byId.get(n.parentId) : undefined);
  const isJoinHead = (n: MapNode) => !!parentOf(n)?.joins.includes(n);
  const routesOf = (n: MapNode) => n.children.filter((k) => k.kind === "route");
  const pillsOf = (n: MapNode) => n.children.filter((k) => !!k.pill);
  const sideOf = (n: MapNode) => n.children.filter((k) => k.kind !== "step");
  /** A group's first chain continues the group's own line. */
  const continues = (g: MapNode) => flowsRight(g) || stacksChain(g);
  /** Where a join points from this card, if its line ends in one. */
  const joinTarget = (n: MapNode) => {
    const pair = model.pairs.find((p) => p.kind === "join" && p.from === n.id);
    return pair ? (model.byId.get(pair.to) ?? null) : null;
  };

  /** The line `n` is a card of — a row or a column — and its place in it. */
  const lineOf = (n: MapNode): { cards: MapNode[]; at: number } => {
    const own = (g: MapNode, first: MapNode[]) => ({ cards: [g, ...first], at: 0 });
    if (n.pill || n.kind === "route") return own(n, continues(n) ? (chainsOf(n)[0] ?? []) : []);
    if (isJoinHead(n)) return own(n, chainsOf(n).flat());
    const p = parentOf(n);
    if (!p) return { cards: [n], at: 0 };
    if (isJoinHead(p)) {
      const cards = [p, ...chainsOf(p).flat()];
      return { cards, at: cards.indexOf(n) };
    }
    const chains = chainsOf(p);
    const k = chains.findIndex((c) => c.includes(n));
    const cards = k === 0 && continues(p) ? [p, ...chains[0]] : (chains[k] ?? [n]);
    return { cards, at: cards.indexOf(n) };
  };

  /** The lane a card belongs to, named by its first card: a group card is its
   *  own lane; a step heads, or belongs to, the lane of its chain — the
   *  first chain of a group included, which is stacked with the group's other
   *  chains; a shared step's own chain belongs to the shared step. */
  const laneOf = (n: MapNode): MapNode => {
    const head = lineOf(n).cards[0];
    if (head === n || isJoinHead(head)) return head;
    if (head.pill || head.kind === "route") return chainsOf(head)[0]?.[0] ?? head;
    return head;
  };

  /** The lanes stacked with `lane`, in order, and the card they hang from. */
  const stackOf = (lane: MapNode): { lanes: MapNode[]; owner: MapNode | null } => {
    const p = parentOf(lane);
    /* The callers block is a column of its own, beside the viewed tree rather
       than above it, so neither stack runs on into the other. */
    if (!p) return { lanes: model.roots.includes(lane) ? model.roots : model.callers, owner: null };
    /* An entry chain, stacked with the group's others and its shared steps. */
    if (lane.kind === "step" && !isJoinHead(lane)) return { lanes: [...chainsOf(p).map((c) => c[0]), ...p.joins], owner: p };
    if (p.kind === "step") {
      /* Beside a connected step, one column holds its branches, its calls and
         the steps they share; a main step keeps branches beside it and calls
         below it, two separate stacks. */
      if (!flowsRight(p)) return { lanes: [...sideOf(p), ...p.joins], owner: p };
      return { lanes: lane.pill ? pillsOf(p) : [...routesOf(p), ...p.joins], owner: p };
    }
    return { lanes: [...chainsOf(p).map((c) => c[0]), ...p.joins], owner: p };
  };

  /** The next or previous lane, climbing out while a lane has no neighbour. */
  const lane = (from: MapNode, step: 1 | -1): MapNode | null => {
    for (let cur: MapNode | null = laneOf(from); cur; ) {
      const { lanes, owner } = stackOf(cur);
      const next = lanes[lanes.indexOf(cur) + step];
      if (next) return next;
      cur = owner ? laneOf(owner) : null;
    }
    return null;
  };

  /** The card a line hangs from: a branch's fan-out, a pill's calling step,
   *  a shared step's first feeder, a lower entry chain's group. */
  const outOf = (head: MapNode): MapNode | null => {
    if (isJoinHead(head)) {
      const pair = model.pairs.find((p) => p.kind === "join" && p.to === head.id);
      const feeder = pair ? model.byId.get(pair.from) : undefined;
      if (feeder) return feeder;
    }
    return parentOf(head) ?? null;
  };

  const { cards, at } = lineOf(node);
  const next = cards[at + 1] ?? null;
  const prev = at > 0 ? cards[at - 1] : null;

  if (flowsRight(cards[0])) {
    switch (key) {
      case "ArrowRight":
        return next ?? routesOf(node)[0] ?? joinTarget(node);
      case "ArrowLeft":
        if (prev) return prev;
        if (!node.parentId && model.roots.includes(node)) return model.callers[0] ?? null;
        return outOf(node);
      case "ArrowDown":
        return pillsOf(node)[0] ?? lane(node, 1);
      case "ArrowUp":
        return lane(node, -1);
    }
  }
  switch (key) {
    case "ArrowDown":
      return next ?? lane(node, 1);
    case "ArrowUp": {
      if (prev) return prev;
      /* The head of a column: the lane above it beside the same card, else
         the card the column hangs from. */
      const { lanes } = stackOf(laneOf(node));
      return lanes[lanes.indexOf(laneOf(node)) - 1] ?? outOf(node);
    }
    case "ArrowRight": {
      if (sideOf(node).length > 0) return sideOf(node)[0];
      if (!continues(node)) {
        const entry = node.children.find((k) => k.kind === "step");
        if (entry) return entry;
      }
      /* A caller with nothing further to its right leads on to the workflow it
         calls — the viewed pill, as ← from that pill leads back. */
      return node.joins[0] ?? joinTarget(node) ?? (model.callers.includes(node) ? (model.roots[0] ?? null) : null);
    }
    case "ArrowLeft":
      return outOf(cards[0]);
  }
}

/* ─── folding repeated structure ──────────────────────────────────────── */

/** `expanded` key that draws a folded arm's steps. */
export const armKey = (key: WorkflowKey, stepId: string): string => `arm:${key}:${stepId}`;
/** What a macro card withholds is revealed by descending the ladder, not by
 *  expanding one card — so a reveal may name a rung instead of a key. */
export const layerReveal = (layer: Layer): string => `layer:${layer}`;
/** The rung a reveal asks for, or null when it is an `expanded` key. */
export const revealLayer = (reveal: string): Layer | null =>
  reveal.startsWith("layer:") ? (reveal.slice(6) as Layer) : null;

export interface FoldPlan {
  /** Arm head step id → the annotation its route card carries. */
  folds: Map<string, FoldState>;
  /** Head step id → the annotation its step card carries: a tile at
   *  structure or macro, a run at macro only. */
  packs: Map<string, PackState>;
  /** Steps removed from the workflow before the walk sees it. A folded arm's
   *  head is NOT here — its route card has to exist to stand for the arm. */
  dropped: Set<string>;
  /** Every step that is not drawn → the key that reveals it: an `expanded`
   *  key, or `layer:<rung>` when only descending the ladder can. */
  reveals: Map<string, string>;
  /** A packed run's head → where its chain continues, so the one card the run
   *  became still connects to whatever the run led to. This rewires an edge;
   *  it never invents a node. */
  bridge: Map<string, string>;
}

const emptyPlan = (): FoldPlan => ({ folds: new Map(), packs: new Map(), dropped: new Set(), reveals: new Map(), bridge: new Map() });

/**
 * The plan from the API's element tree — the primary path.
 *
 * `elements` already answers everything a fold needs: where each card goes,
 * which step it draws, and exactly which steps each member it does not draw
 * withholds. So nothing here walks the graph; it reads positions and turns
 * them into the same `FoldPlan` the graph fallback produces, and the reader's
 * own state (which arms are open, which members are split out) is applied on
 * top — which is the half no server can know.
 *
 * Both have the fallback's floors: a tile packs from PACK_AT steps and an arm
 * folds from FOLD_AT. Below them a card only costs a press to learn what the
 * steps themselves would have shown. The floor counts an arm's own steps,
 * never how many arms share its shape — a shape that occurs once still folds
 * when it is big enough.
 */
function planFromElements(
  shapes: WorkflowShapes,
  key: WorkflowKey,
  expanded: Readonly<Record<string, boolean>>,
  layer: Layer,
  linked: ReadonlySet<string>,
  successorOf: (stepId: string) => string | undefined,
  jumps: ReadonlySet<string>,
  moduleOf: (stepId: string) => string | undefined,
  /** The workflow hangs under a pill the reader opened (see `openOf`). */
  opened = false
): FoldPlan {
  const plan = emptyPlan();
  const macro = layer === "macro";
  const id = (v: unknown) => String(v);
  const openOf = (k: string, under: boolean) => expanded[k] ?? under;

  /** Withhold `ids`, and say which key brings them back. `keep` is a step
   *  whose card is drawn in its place, so it stays in the workflow. */
  const hide = (ids: readonly unknown[], reveal: string, keep?: string) => {
    for (const raw of ids) {
      const s = id(raw);
      if (s === keep) continue;
      plan.dropped.add(s);
      plan.reveals.set(s, reveal);
    }
  };

  /** A step whose own card carries something no summary can: a jump, or a
   *  call into another workflow. Never packed away behind a count. */
  const landmark = (s: string) => linked.has(s) || jumps.has(s);

  /**
   * Every arm of a fan-out is its own card, side by side, named for its own
   * branch — the way GoHighLevel's editor draws it. Arms that share a shape
   * are NOT drawn as one card with the others compressed into chips: reaching
   * `Canceled` must never mean clicking a pill under a card named
   * `No-Showed`. The grouping still exists — it is what the Overview's
   * "5 patterns" counts — it just is not how a branch is drawn.
   *
   * Each card folds its own arm, and opening it draws that arm one level
   * deep. The element tree only recurses into a group's representative, so a
   * sibling arm borrows the representative's tree by POSITION: identical
   * signatures walk in the same canonical order, so member i's k-th node is
   * the representative's k-th. That is verified per arm, not assumed — the
   * span lengths and every node's module must agree — and an arm that fails
   * the check draws its steps in full rather than folding nodes that are not
   * its own.
   */
  const arm = (el: ShapeElement, under: boolean) => {
    const members = el.members ?? [];
    if (members.length === 0) return;
    const repIds = members[0].nodeIds.map(id);
    for (const m of members) {
      const head = id(m.id);
      const ids = m.nodeIds.map(id);
      /* A branch under FOLD_AT steps is drawn, never folded — the same floor
         the graph fallback has always had. A card saying "2 steps" costs a
         press to learn what two cards would have shown. */
      const small = ids.length < FOLD_AT;
      const open = small || openOf(armKey(key, head), under);
      /* Everything inside a branch the reader opened opens with it. A branch
         drawn only because it is small passes on what it was given. */
      const inside = under || (!small && expanded[armKey(key, head)] === true);
      if (!small)
        plan.folds.set(head, {
          scope: "arm",
          patterns: 1,
          armId: head,
          open,
          steps: m.count,
          pattern: "",
          count: 1,
          totalSteps: m.count,
          members: [],
        });
      if (!open) {
        hide(ids, armKey(key, head), head);
        /* The head is kept out of `dropped` — its route card has to exist —
           but it is not drawn as a step either, so it must still be HELD. A
           head in neither map is a step a `?step=` link reports missing,
           and the first step of a branch is the most natural thing to link. */
        plan.reveals.set(head, armKey(key, head));
        continue;
      }
      if (m === members[0]) {
        walk(el.children ?? [], inside);
        continue;
      }
      const byPosition = positional(repIds, ids);
      if (byPosition) walk(remap(el.children ?? [], byPosition), inside);
    }
  };

  /** Representative id → member id, by position — or null when the two
   *  spans do not have the same length and the same module at every step. */
  const positional = (rep: string[], member: string[]): Map<string, string> | null => {
    if (rep.length !== member.length) return null;
    const out = new Map<string, string>();
    for (let k = 0; k < rep.length; k++) {
      if (moduleOf(rep[k]) !== moduleOf(member[k])) return null;
      out.set(rep[k], member[k]);
    }
    return out;
  };

  /** The same element tree with every step id carried across to a sibling. */
  const remap = (els: readonly ShapeElement[], map: ReadonlyMap<string, string>): ShapeElement[] => {
    const to = (v: unknown) => map.get(id(v)) ?? id(v);
    return els.map((e) => ({
      ...e,
      nodeIds: e.nodeIds.map(to),
      representative: e.representative === undefined ? undefined : to(e.representative),
      hidden: e.hidden?.map(to),
      members: e.members?.map((mm) => ({ ...mm, id: to(mm.id), nodeIds: mm.nodeIds.map(to) })),
      children: e.children ? remap(e.children, map) : undefined,
    }));
  };

  /** One fan as a single element: how many outcomes, and how many shapes.
   *  A count and a variety — never a claim that they are the same. */
  const band = (el: ShapeElement) => {
    const arms = (el.children ?? []).filter((c) => c.kind === "arm" && c.members?.length);
    const first = arms[0];
    if (!first?.members) return false;
    const head = id(first.members[0].id);
    const reveal = layerReveal("structure");
    plan.folds.set(head, {
      scope: "band",
      patterns: arms.length,
      armId: head,
      open: false,
      steps: first.members[0].count,
      pattern: "",
      count: arms.reduce((t, a) => t + (a.members?.length ?? 0), 0),
      totalSteps: arms.reduce((t, a) => t + a.nodeIds.length, 0),
      members: arms.flatMap((a) => (a.members ?? []).map((m) => ({ stepId: id(m.id), label: m.label }))).slice(1),
    });
    hide(first.nodeIds, reveal, head);
    plan.reveals.set(head, reveal); // not drawn as a step: held, for the same reason as an arm's head
    for (const a of arms.slice(1)) hide(a.nodeIds, reveal);
    return true;
  };

  /** A stretch of tiles drawn as one card at the macro rung. */
  const packRun = (tiles: ShapeElement[]) => {
    const ids = tiles.flatMap((t) => t.nodeIds.map(id));
    if (ids.length < PACK_AT) return false;
    const head = ids[0];
    const last = ids[ids.length - 1];
    plan.packs.set(head, { steps: ids.length, lastId: last });
    hide(ids, layerReveal("structure"), head);
    const after = successorOf(last);
    if (after !== undefined) plan.bridge.set(head, after);
    return true;
  };

  function walk(list: readonly ShapeElement[], under: boolean) {
    /* Macro packs a stretch of tiles into one card. A trigger, a jump, a
       call into another workflow and the step a fan branches from all break
       the stretch: each is something the reader would lose by not seeing. */
    let run: ShapeElement[] = [];
    const flush = () => {
      if (run.length && !packRun(run)) tileEach(run);
      run = [];
    };
    const tileEach = (tiles: ShapeElement[]) => {
      for (const t of tiles) {
        const ids = t.nodeIds.map(id);
        /* The same floor as a run. Two steps — a lookup and the setter after
           it — are a pair the reader takes in at a glance, and a "2 steps"
           card in their place costs a press to learn what two cards would
           have said. */
        if (ids.length < PACK_AT || ids.some(landmark)) continue;
        /* A tile opens in place, exactly as an arm does. It used to be
           revealed by dropping to the `steps` rung, which answered "show me
           this one step" by expanding the entire workflow — and, because a
           rung was a stored preference, kept it expanded on every workflow
           afterwards. One card's worth of steps is one card's business.
           Open, it is still a pack: its card keeps the cap, filled, and the
           same press folds the steps away again. */
        const open = openOf(armKey(key, ids[0]), under);
        plan.packs.set(ids[0], { steps: ids.length, lastId: ids[ids.length - 1], inPlace: true, open });
        if (open) continue;
        hide(ids, armKey(key, ids[0]), ids[0]);
        const after = successorOf(ids[ids.length - 1]);
        if (after !== undefined) plan.bridge.set(ids[0], after);
      }
    };
    for (const el of list) {
      if (el.kind === "tile") {
        const ids = el.nodeIds.map(id);
        const breaks = !macro || ids.some(landmark) || ids.some((s) => fanSteps.has(s)) || triggers.has(ids[0]);
        if (breaks) {
          flush();
          if (!macro || !triggers.has(ids[0])) tileEach([el]);
        } else run.push(el);
        continue;
      }
      flush();
      if (el.kind === "fan") {
        if (macro && band(el)) continue;
        walk(el.children ?? [], under);
        continue;
      }
      if (el.kind === "arm") arm(el, under);
    }
    flush();
  }

  /* Steps a fan branches from, and triggers: both keep their own card. */
  const fanSteps = new Set<string>();
  const triggers = new Set<string>();
  const scan = (list: readonly ShapeElement[]) => {
    for (const el of list) {
      if (el.kind === "fan") for (const nid of el.nodeIds) fanSteps.add(id(nid));
      scan(el.children ?? []);
    }
  };
  scan(shapes.elements);
  for (const el of shapes.elements) {
    if (el.kind === "tile" && el.nodeIds.length) triggers.add(id(el.nodeIds[0]));
    break;
  }

  walk(shapes.elements, opened);
  return plan;
}

/**
 * Decide what the canvas withholds at one rung of the ladder, from the
 * workflow's own topology alone — the fallback for when `elements` has not
 * arrived. Coarser than the element tree by design: it folds arms on size and
 * groups nothing, which takes the 119-step workflow to 21 rather than 14.
 * Kept because a canvas that degrades when an endpoint is slow is worth more
 * than one that is only ever correct.
 *
 * Pure and provider-blind: it reads `connections` and `kind`, never a
 * platform name.
 *
 * Walked breadth-first from the entries, so an outer decision is always made
 * before anything inside it and nothing is ever decided twice.
 *
 * At **structure**, one rule: **every arm of a fan-out is its own card**,
 *  named for its own branch and folding its own steps. `armKey()` in
 *  `expanded` draws them. Arms that share a shape are never merged into one
 *  card here — that grouping is what the macro rung's pattern count reads.
 *
 * At **macro**, two coarser ones, which subsume those:
 *  - **A whole fan-out is one element.** Every arm, whatever its size or
 *    shape, stands behind the first arm's route card, which says how many
 *    outcomes there are and how many distinct shapes — a count and a
 *    variety, never a claim that they are the same.
 *  - **A run of PACK_AT plain steps or more is one card**, its first, which
 *    carries the count and connects straight to what the run led to. A
 *    trigger never joins a run: "what starts this" is the one question with
 *    the same answer shape on every platform, so it keeps its own card.
 *
 * Only a real fan-out (more than one outgoing edge) has arms — a single-path
 * condition gates a line, and hiding that line behind a "3 steps" card would
 * cost more than it saves. An arm reachable from anywhere else is left
 * alone: it is a shared step, and the join column already renders it once.
 */
export function planFolds(
  summary: { modules: ModuleInfo[]; connections: Connection[] },
  key: WorkflowKey,
  expanded: Readonly<Record<string, boolean>>,
  layer: Layer = "structure",
  /** Steps that call another workflow. A run never packs one away: a
   *  hand-off to another platform is exactly what an overview is for. */
  linked: ReadonlySet<string> = new Set(),
  /** The workflow hangs under a pill the reader opened: an arm nobody has
   *  folded is drawn open (see `openOf` in `planFromElements`). */
  opened = false
): FoldPlan {
  const plan = emptyPlan();
  const byId = new Map<string, ModuleInfo>();
  for (const m of summary.modules) byId.set(String(m.id), m);
  if (byId.size === 0) return plan;

  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  /** Steps a "Go to" leaves from — a jump is a cross-reference, not filler. */
  const jumps = new Set<string>();
  /** The label on the edge into a step — a member's name when the API has none. */
  const edgeLabel = new Map<string, string>();
  for (const c of summary.connections) {
    const from = String(c.from);
    const to = String(c.to);
    if (!byId.has(from) || !byId.has(to)) continue;
    const kind = c.kind ?? "sequence";
    if (kind === "goto") jumps.add(from);
    if (kind !== "sequence" && kind !== "branch") continue;
    (out.get(from) ?? out.set(from, []).get(from)!).push(to);
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
    const label = c.label?.trim();
    if (label && !edgeLabel.has(to)) edgeLabel.set(to, label);
  }

  /* The same entry rule the walk uses, so the two agree on what is reachable. */
  let entries = summary.modules.filter((m) => (indeg.get(String(m.id)) ?? 0) === 0).map((m) => String(m.id));
  if (entries.length === 0) entries = [String(summary.modules[0].id)];

  /**
   * Steps only reachable through `head` — the arm it heads, head excluded.
   * A step the workflow can also reach without walking through `head` is a
   * rejoin: it and everything past it stay drawn, so a fold never withholds
   * a step that another branch depends on.
   */
  const bodies = new Map<string, Set<string>>();
  const bodyOf = (head: string): Set<string> => {
    const memo = bodies.get(head);
    if (memo) return memo;
    const outside = new Set<string>();
    const s1 = [...entries];
    while (s1.length) {
      const cur = s1.pop()!;
      if (outside.has(cur)) continue;
      outside.add(cur);
      if (cur === head) continue; // reachable, never walked through
      for (const t of out.get(cur) ?? []) s1.push(t);
    }
    const body = new Set<string>();
    const s2 = [...(out.get(head) ?? [])];
    while (s2.length) {
      const cur = s2.pop()!;
      if (cur === head || body.has(cur) || outside.has(cur)) continue;
      body.add(cur);
      for (const t of out.get(cur) ?? []) s2.push(t);
    }
    bodies.set(head, body);
    return body;
  };

  /* Without the element tree there is nothing to group by: every arm stands
     for itself. The branch's own label names it. */
  const labelOf = (head: string): string => edgeLabel.get(head) || byId.get(head)?.label || head;

  const macro = layer === "macro";

  /**
   * The macro rung packs a run of plain steps into its first card. A run
   * ends at anything the reader would lose by not seeing: a fan-out, a step
   * reached from elsewhere (a join head), a trigger, or the end of the
   * chain. Returns the steps AFTER the head that it stands for.
   */
  const plain = (id: string): boolean => {
    const m = byId.get(id);
    return (
      !!m &&
      m.kind !== "trigger" &&
      (out.get(id) ?? []).length <= 1 && // a fan-out is the shape of the workflow
      !jumps.has(id) && // a "Go to" points somewhere; do not hide the pointer
      !linked.has(id) && // nor a call into another workflow
      (indeg.get(id) ?? 0) <= 1 // a step several paths reach is a landmark
    );
  };
  const runFrom = (head: string): string[] => {
    const run: string[] = [];
    let cur = head;
    for (;;) {
      const nexts = out.get(cur) ?? [];
      if (nexts.length !== 1) break;
      const next = nexts[0];
      if (next === head || run.includes(next) || !plain(next)) break;
      run.push(next);
      cur = next;
    }
    return run;
  };

  const seen = new Set<string>();
  /* Each step carries whether something above it was opened by the reader:
     an arm nobody has folded is drawn open under one, and shut elsewhere. */
  const queue: [string, boolean][] = entries.map((e) => [e, opened]);
  while (queue.length) {
    const [cur, under] = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const outs = out.get(cur) ?? [];
    if (outs.length < 2) {
      if (macro && plain(cur)) {
        /* Everything the run stands for goes; the head keeps its card, and
           its one edge is rewired to whatever the run led to. */
        const run = runFrom(cur);
        if (run.length + 1 >= PACK_AT) {
          const tail = run[run.length - 1];
          const after = (out.get(tail) ?? [])[0];
          plan.packs.set(cur, { steps: run.length + 1, lastId: tail });
          for (const stepId of run) {
            plan.dropped.add(stepId);
            plan.reveals.set(stepId, layerReveal("structure"));
          }
          if (after !== undefined) plan.bridge.set(cur, after);
          for (const t of out.get(tail) ?? []) queue.push([t, under]);
          continue;
        }
      }
      for (const t of outs) queue.push([t, under]);
      continue;
    }
    if (macro) {
      /* One element for the whole fan-out: the first arm's route card, which
         says how many outcomes there are and how many shapes they have. It
         claims a count and a variety, never a sameness. */
      const heads = [...new Set(outs)];
      const first = heads[0];
      if (heads.length > 1 && (indeg.get(first) ?? 0) <= 1) {
        const body = bodyOf(first);
        plan.folds.set(first, {
          scope: "band",
          /* Nothing here can tell two arms apart by shape, so every arm is
             its own pattern — the honest answer when the tree is absent. */
          patterns: heads.length,
          armId: first,
          open: false,
          steps: body.size + 1,
          pattern: byId.get(first)?.label ?? first,
          count: heads.length,
          totalSteps: heads.reduce((total, h) => total + bodyOf(h).size + 1, 0),
          members: heads.slice(1).map((h) => ({ stepId: h, label: labelOf(h) })),
        });
        const reveal = layerReveal("structure");
        plan.reveals.set(first, reveal);
        for (const s of body) {
          plan.dropped.add(s);
          plan.reveals.set(s, reveal);
        }
        for (const h of heads.slice(1)) {
          plan.dropped.add(h);
          plan.reveals.set(h, reveal);
          for (const s of bodyOf(h)) {
            plan.dropped.add(s);
            plan.reveals.set(s, reveal);
          }
        }
        continue;
      }
    }
    /* Two edges to the same step draw two routes; neither can stand alone
       for the arm, so that arm is never folded. */
    const arity = new Map<string, number>();
    for (const t of outs) arity.set(t, (arity.get(t) ?? 0) + 1);
    for (const head of new Set(outs)) {
      if (arity.get(head)! > 1 || (indeg.get(head) ?? 0) > 1) {
        queue.push([head, under]);
        continue;
      }
      const body = bodyOf(head);
      /* Under FOLD_AT steps an arm is drawn and never offers a fold. */
      if (body.size + 1 < FOLD_AT) {
        queue.push([head, under]);
        continue;
      }
      const explicit = expanded[armKey(key, head)];
      const open = explicit ?? under;
      plan.folds.set(head, {
        scope: "arm",
        patterns: 1,
        armId: head,
        open,
        steps: body.size + 1,
        pattern: byId.get(head)?.label ?? head,
        count: 1,
        totalSteps: body.size + 1,
        members: [],
      });
      if (open) {
        queue.push([head, under || explicit === true]);
      } else {
        const reveal = armKey(key, head);
        plan.reveals.set(head, reveal);
        for (const s of body) {
          plan.dropped.add(s);
          plan.reveals.set(s, reveal);
        }
      }
    }
  }
  return plan;
}

/* ─── build ───────────────────────────────────────────────────────────── */

export function buildMap(input: BuildMapInput): MapModel {
  const { viewed, linkMap, summaries, expanded } = input;
  const now = input.now ?? Date.now();
  const q = input.query.trim().toLowerCase();
  const { cards, outgoing, incoming } = index(linkMap);
  const viewedKey = keyOf(viewed);
  const wantedSet = new Set<WorkflowKey>();
  const hiddenSteps = new Map<string, string>();
  /* A query searches the whole workflow: it drops to the finest rung, the
     way it already force-unfolds loaded pills, so nothing can hide from a
     filter. The rung the reader chose is untouched — this is the query's
     view, and it ends when the query does. */
  const layer: Layer = q.length > 0 ? "steps" : (input.layer ?? "structure");

  const viewedName = (() => {
    const e = summaries.get(viewedKey);
    return (e?.state === "ok" ? e.summary.name : null) ?? cards.get(viewedKey)?.name ?? viewedKey;
  })();

  const hitOf = (name: string, desc: string) => q.length > 0 && `${name} ${desc}`.toLowerCase().includes(q);

  /*
   * Workflows drawn open, by key. A scenario called from five branches is
   * five pills — one beside each step that calls it — but its own steps are
   * drawn once: a 102-module scenario repeated five times would be the
   * opposite of legible and would push the map past LITE_AT on its own.
   * When state asks for several (expand-all, a filter, or anything left from
   * before), the first instance in build order is the one that opens; a
   * reader's own click moves it, because WorkflowMap closes every other
   * instance of a target when one opens.
   */
  const openTargets = new Set<WorkflowKey>();

  /* A workflow pill: a root, or attached beside the step that calls it. */
  const pill = (
    ref: WorkflowRef,
    parentId: string | null,
    depth: number,
    path: WorkflowKey[],
    link: WorkflowLink | null,
    callerStep: string | null,
    unresolvedStep: boolean
  ): MapNode => {
    const key = keyOf(ref);
    /* Keyed by where it is called from. Two steps calling the same workflow
       are two call sites and two pills, never one id that only the first
       caller gets — and a step's id is path-based, so the pill keeps its id
       while its own arm opens and folds. */
    const id = parentId ? `${parentId}/wf:${key}` : `wf:${key}`;
    const card = cards.get(key);
    const entry = summaries.get(key);
    const summary = entry?.state === "ok" ? entry.summary : null;
    const error = entry?.state === "error" ? entry.error : undefined;
    const unavailable = entry?.state === "error" ? !!entry.stepsUnavailable : !!summary?.stepsUnavailable;
    const cycle = path.includes(key);
    /* Under a filter only what is already loaded unfolds — no fetch storms. */
    const canUnfold = summary != null || unavailable;
    /* The viewed root is pinned: always open, whatever `expanded` says. */
    const pinned = parentId === null && key === viewedKey;
    const open = pinned || (!cycle && (q ? canUnfold : !!expanded[id]) && !openTargets.has(key));
    if (open) openTargets.add(key);
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
      down: key !== viewedKey || undefined,
      orritHref: key === viewedKey ? undefined : `/w/${ref.source}/${ref.refId}`,
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

    /* A workflow's downstream connections hang off the steps that make them,
       so they exist exactly when those steps are drawn. A pill that is not
       open draws no steps, and so shows no connections of its own: what a
       folded workflow calls is one click away, never guessed at from here. */
    if (open && summary && !unavailable) {
      node.children = stepsOf(summary, key, node, depth + 1, ownPath);
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
    /* What the canvas withholds, decided before anything is built. */
    /* Steps that hand off to another workflow, so a run never packs one
       away — computed before the plan, from the same link map the pills
       hang off further down. */
    const linkedIds = new Set<string>();
    for (const l of outgoing.get(key) ?? []) {
      if (l.from.stepId != null) linkedIds.add(String(l.from.stepId));
    }
    /* Where the chain goes after a step, for a packed run's one rewired edge. */
    const nextOf = new Map<string, string>();
    const jumpFrom = new Set<string>();
    for (const c of summary.connections) {
      const from = String(c.from);
      const kind = c.kind ?? "sequence";
      if (kind === "goto") jumpFrom.add(from);
      else if ((kind === "sequence" || kind === "branch") && !nextOf.has(from)) nextOf.set(from, String(c.to));
    }
    /* Built before the plan, not taken from `allModules` below: the plan
       calls this synchronously, and a closure over a `const` declared later
       compiles cleanly and throws at runtime. */
    const moduleTypeOf = new Map<string, string>();
    for (const m of summary.modules) moduleTypeOf.set(String(m.id), m.module);
    const served = input.shapes?.get(key);
    /* A connected workflow is drawn because the reader opened its pill, and
       an opened workflow shows all of itself — every branch and tile open
       until the reader folds one — at every rung, whatever its platform. The
       rung describes the viewed workflow alone. */
    const opened = !owner.isViewed;
    const rung: Layer = opened && layer === "macro" ? "structure" : layer;
    const plan =
      layer === "steps"
        ? emptyPlan()
        : served && served.elements?.length
          ? planFromElements(served, key, expanded, rung, linkedIds, (s) => nextOf.get(s), jumpFrom, (s) => moduleTypeOf.get(s), opened)
          : planFolds(summary, key, expanded, rung, linkedIds, opened);
    for (const [stepId, reveal] of plan.reveals) hiddenSteps.set(`${key}:${stepId}`, reveal);
    /* Every step of the workflow — a withheld one still names itself on a
       "Go to" card's detail line, it just has no card of its own. */
    const allModules = new Map<string, ModuleInfo>();
    for (const m of summary.modules) allModules.set(String(m.id), m);
    const modules = new Map<string, ModuleInfo>();
    for (const m of summary.modules) if (!plan.dropped.has(String(m.id))) modules.set(String(m.id), m);

    const out = new Map<string, Connection[]>();
    const gotos = new Map<string, Connection[]>();
    const indeg = new Map<string, number>();
    for (const c of summary.connections) {
      const from = String(c.from);
      const to = String(c.to);
      if (!modules.has(from)) continue;
      const kind = c.kind ?? "sequence";
      if (kind === "goto") {
        if (allModules.has(to)) (gotos.get(from) ?? gotos.set(from, []).get(from)!).push(c);
      } else if (kind === "sequence" || kind === "branch") {
        /* A packed run's head connects straight to whatever the run led to:
           one edge in place of the run's own chain. The steps between are
           gone from `modules`, so their edges fall away with them. */
        const bridged = plan.bridge.get(from);
        const edge = bridged !== undefined ? { ...c, to: bridged } : c;
        const target = bridged ?? to;
        /* An arm another card stands for keeps its place among its siblings:
           it is not drawn, but a branch named `C` still means the platform's third
           branch, and the route ids of the arms after it do not shift. */
        (out.get(from) ?? out.set(from, []).get(from)!).push(edge);
        if (modules.has(target)) indeg.set(target, (indeg.get(target) ?? 0) + 1);
      }
    }

    /* Entries: triggers first, then by ordinal, orphans (no ordinal) last. */
    const rank = (m: ModuleInfo) => (m.kind === "trigger" ? 0 : m.ordinal ? 1 : 2);
    /* Over the KEPT modules: a withheld step has no edges left, and must
       never fall out of its arm and start a column of its own. */
    const kept = [...modules.values()];
    let entries = kept.filter((m) => (indeg.get(String(m.id)) ?? 0) === 0);
    if (entries.length === 0 && kept.length > 0) entries = [kept[0]];
    entries = [...entries].sort((a, b) => rank(a) - rank(b) || natural(a.ordinal ?? "", b.ordinal ?? ""));
    const entryId = entries[0] ? String(entries[0].id) : null;

    /*
     * Cross-workflow links leaving this workflow, by the step that makes the
     * call. A connection is drawn beside that step, and only when that step
     * is drawn: `attachOut` runs for drawn steps alone, so a call from a step
     * that is folded away has no pill anywhere — not on the card standing for
     * it, and not on the trigger. What a branch connects to is part of that
     * branch, and reads as such when the branch is opened.
     *
     * `unresolved` is only what it says: a link whose calling step this
     * workflow genuinely does not have. Those still hang off the entry node,
     * and still say so. A step that exists and is merely folded is never one
     * of them — that claim would be false about the user's own data.
     */
    const linksAt = new Map<string, WorkflowLink[]>();
    const unresolved: WorkflowLink[] = [];
    for (const l of outgoing.get(key) ?? []) {
      const sid = l.from.stepId != null ? String(l.from.stepId) : "";
      if (!sid || !allModules.has(sid)) unresolved.push(l);
      else (linksAt.get(sid) ?? linksAt.set(sid, []).get(sid)!).push(l);
    }

    const nameOf = (id: string) => allModules.get(id)?.label ?? id;

    /* Every step renders exactly once: step id → its node. A chain that
       reaches a rendered step ends in a cross pair instead of a second card. */
    const rendered = new Map<string, MapNode>();
    const cross: { from: string; toStep: string; kind: "join" | "jump" }[] = [];

    /** `down`: the step belongs to a connected workflow's trunk, which runs
     *  top to bottom (see `MapNode.down`). */
    const makeStep = (cur: string, parentId: string, d: number, down: boolean): MapNode => {
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
        pack: plan.packs.get(cur),
        main: key === viewedKey || undefined,
        down: down || undefined,
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
          if (!modules.has(String(e.to))) return; // the Overview's fan-out card stands for this arm
          const routeId = `${node.id}/route:${cur}:${i}`;
          /* This branch is drawn as one card: the route that already headed
             it, saying what it stands for. The card is a real node, so the
             sidebar, selection and measurement are untouched. */
          const fold = plan.folds.get(String(e.to));
          const route: MapNode = {
            id: routeId,
            parentId: node.id,
            depth: d + 1,
            kind: "route",
            app: "router",
            /* A card standing for the whole fan-out is not any one branch,
               so it does not wear any one branch's name: it says how many
               outcomes there are, and how many distinct shapes. */
            name: fold?.scope === "band" ? `${fold.count} outcomes` : routeLabel(e, i, source, allModules.get(String(e.to))?.label),
            /* Second line: what decides this branch, or nothing. Never the
               name again, and never "Route 2 of 3 from" — position is not
               information, and filler here competes with the one thing on
               the card that matters. The predicate arrives with the
               contract; until then a branch card is its name alone. */
            desc:
              fold?.scope === "band"
                ? [fold.patterns < fold.count ? `${fold.patterns} patterns` : null, `${fold.totalSteps} steps`].filter(Boolean).join(" · ")
                : (e.condition?.trim() ?? ""),
            stepRef: { key, stepId: cur },
            nativeUrl: ownerUrl,
            path,
            children: [],
            childCount: 0,
            attachedRefs: [],
            joins: [],
            descendants: 0,
            fold,
            main: key === viewedKey || undefined,
            hit: false,
          };
          route.hit = hitOf(route.name, route.desc);
          /* A branch is a lane running right, wherever it sits. */
          if (!fold || fold.open) route.children = chain(String(e.to), routeId, d + 2, node, false, false);
          route.childCount = route.children.length;
          kids.push(route);
        });
      } else if (continueAsChildren && outs.length === 1 && modules.has(String(outs[0].to))) {
        kids.push(...chain(String(outs[0].to), node.id, d + 1, node, true, !!node.down));
      }
      /* One pill per distinct workflow THIS step calls. Every calling step
         gets its own, whatever any other step does: the same scenario called
         from five branches is five pills, one beside each branch that calls
         it, and none of them depends on whether a sibling branch is open.
         Collapsed pills render before unfolded ones (stable otherwise) so a
         folded sibling stays beside the calling step and only the unfolded
         pill's subtree extends downward. */
      const pills: MapNode[] = [];
      const here = new Set<WorkflowKey>();
      const callsFrom = (l: WorkflowLink, callerStep: string | null, unresolvedStep: boolean) => {
        const target = keyOf(l.to);
        if (target === viewedKey || here.has(target)) return;
        here.add(target);
        pills.push(pill({ source: l.to.source, refId: l.to.refId }, node.id, d + 1, path, l, callerStep, unresolvedStep));
      };
      for (const l of linksAt.get(cur) ?? []) callsFrom(l, m.label, false);
      if (cur === entryId) for (const l of unresolved) callsFrom(l, null, true);
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
      return fan || continueAsChildren || outs.length === 0 || !modules.has(String(outs[0].to)) ? undefined : String(outs[0].to);
    };

    /* Walk one chain from `startId` under `parentId` (a band column: the
       chain fans from the group). `group` owns the row this column sits in
       — [group][children band][join column]. A step with more than one
       predecessor met from a band column renders once as a join head of
       that group and continues as the head's children; `inJoin` marks a
       head's own continuation, where further shared steps stay inline. */
    const chain = (startId: string, parentId: string, d: number, group: MapNode, inJoin: boolean, down: boolean): MapNode[] => {
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
          /* A shared step continues the way its group runs: down a connected
             workflow's trunk when its entries meet, right when branches do. */
          const head = makeStep(cur, group.id, group.depth + 1, !!group.pill && !!group.down);
          rendered.set(cur, head);
          group.joins.push(head);
          attachOut(head, cur, group.depth + 1, true);
          cross.push({ from, toStep: cur, kind: "join" });
          break;
        }
        const node = makeStep(cur, parentId, d, down);
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
      nodes.push(...chain(id, owner.id, depth, owner, false, !!owner.down));
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
  let folded = 0;
  const walk = (n: MapNode): number => {
    flat.push(n);
    byId.set(n.id, n);
    if (n.stepRef && n.kind === "step") {
      const sk = `${n.stepRef.key}:${n.stepRef.stepId}`;
      if (!byStep.has(sk)) byStep.set(sk, n);
    }
    if (n.pill?.open) openPills++;
    if (n.fold && !n.fold.open) folded++;
    let below = 0;
    let prev: MapNode | null = null;
    /* The step that continues this node's own row or column: the first
       chain's first card. A second chain under the same group starts a lane
       of its own, so only this one is a straight link from the group. */
    const rowNext = n.children.find((k) => k.kind === "step");
    const right = flowsRight(n);
    for (const c of n.children) {
      /* The viewed workflow runs left to right: a chained step links from the
         card before it in its row ("h"), a group to the first card of its
         first chain the same way, and a workflow one of its steps calls
         hangs below that step ("drop"). A connected workflow runs top to
         bottom: the same links are "v", and a group's first link is one
         only when it stacks its chain under itself. A pill called from
         inside a connected workflow sits to the right of its step. The rest
         — a fan-out to its branches, a group to a second chain — is routed
         as before. Under a filter a chained step whose predecessor was
         pruned falls back to the parent, and if it is now the first step it
         is still the next card. */
      const chainLink = !!(c.chained && prev && !prev.pill);
      const from = chainLink ? prev!.id : n.id;
      const anchor: EdgePair["anchor"] = chainLink
        ? right
          ? "h"
          : "v"
        : c === rowNext
          ? right
            ? "h"
            : stacksChain(n)
              ? "v"
              : undefined
          : c.pill && n.kind === "step" && right
            ? "drop"
            : undefined;
      pairs.push({ key: `${from}>${c.id}`, from, to: c.id, depth: n.depth, kind: "tree", ...(anchor ? { anchor } : {}) });
      prev = c;
      below += 1 + walk(c);
    }
    for (const j of n.joins) below += 1 + walk(j);
    n.descendants = below;
    return below;
  };
  callers.forEach(walk);
  roots.forEach(walk);

  /*
   * Where each workflow is drawn open, told to every other copy of it.
   *
   * Computed over what is RENDERED, after the filter, so a chip can only ever
   * name a copy that is actually on the canvas. Named by the branch it sits
   * in, because that is how a reader thinks about where they left it
   * ("open in Canceled"); outside any branch, by the step that calls it.
   */
  const openCopy = new Map<WorkflowKey, MapNode>();
  for (const n of flat) {
    if (n.pill?.open && !n.pill.pinned && n.ref && !openCopy.has(keyOf(n.ref))) openCopy.set(keyOf(n.ref), n);
  }
  const whereOf = (copy: MapNode): string => {
    for (let at = copy.parentId ? byId.get(copy.parentId) : undefined; at; at = at.parentId ? byId.get(at.parentId) : undefined) {
      if (at.kind === "route") return at.name;
      if (at.pill) break; // a branch of some other workflow is not where the reader left it
    }
    const caller = copy.parentId ? byId.get(copy.parentId) : undefined;
    return caller && !caller.pill ? caller.name : "the workflows calling this one";
  };
  for (const n of flat) {
    /* Only a copy the reader can actually open here says where the open one
       is — "open in Canceled" is an offer, and a pill that cannot toggle (an
       error, no step content) keeps saying what is wrong with it instead. */
    if (!n.pill || n.pill.open || n.pill.cycle || n.pill.unavailable || n.pill.error || !n.ref) continue;
    const open = openCopy.get(keyOf(n.ref));
    if (open && open !== n) n.pill.openAt = { id: open.id, where: whereOf(open) };
  }
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
    hiddenSteps,
    wanted: [...wantedSet],
    counts: {
      rendered: flat.length,
      openPills,
      matchedRoots: roots.length + callers.length,
      connected: connected.size,
      folded,
      withheld: hiddenSteps.size,
    },
  };
}
