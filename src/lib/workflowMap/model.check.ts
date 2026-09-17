/*
 * Model assertions — `pnpm check:map`.
 * Runs with `node --experimental-strip-types`, so this file, model.ts and the
 * fixture use relative `.ts` imports and `import type` only through `@/`.
 */
import { armKey, arrowTarget, buildMap, chainsOf, expandAllSnapshot, fanSplit, flowsRight, initialExpanded, keyOf, layerReveal, packedSteps, pillChip, pillNoun, planFolds, revealLayer, rootOf, stacksChain, viewedPillId, withPillOpen, type Arrow } from "./model.ts";
import { dimNodeIds, failedNodeIds, runCounts, runFocusRect, runStates, runSummary, runUnchecked, RUN_FOCUS_MAX_ZOOM, RUN_FOCUS_SPREAD, type FocusRect, type RelatedTraces, type RunState } from "./run.ts";
import { FOLD_AT, LITE_AT, PACK_AT, ZOOM_MIN } from "./tokens.ts";
import { COLLAPSE, COLLAPSE_LINKED, COLLAPSE_SHAPES, COLLAPSE_SHAPE_MAP, COLLAPSE_SUMMARY, COLLAPSE_VIEWED, SCENARIO, PROTOTYPE, PROTOTYPE_NOW, PROTOTYPE_PROJECTION, PROTOTYPE_RELATED_TRACE, PROTOTYPE_RUN, PROTOTYPE_TRACE, PROTOTYPE_VIEWED, big } from "./fixtures/prototype.ts";
import { projectionAsTrace } from "../projection/overlay.ts";
import type { ExecutionTrace, LinkMap, ModuleInfo, ScenarioSummary, ShapeElement, WorkflowShapes } from "@/app/lib/api";
import type { Layer } from "./types.ts";
import type { EdgePair, MapNode, SummaryEntry, WorkflowKey } from "./types.ts";

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

/** Cards the arrow keys cannot reach from the map's first card. */
const reachable = (m: ReturnType<typeof buildMap>): string[] => {
  const seen = new Set<string>(m.flat[0] ? [m.flat[0].id] : []);
  const queue = m.flat.slice(0, 1);
  while (queue.length) {
    const n = queue.shift()!;
    for (const k of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"] as Arrow[]) {
      const t = arrowTarget(m, n, k);
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        queue.push(t);
      }
    }
  }
  return m.flat.filter((n) => !seen.has(n.id)).map((n) => n.id);
};

const find = (nodes: MapNode[], pred: (n: MapNode) => boolean): MapNode | undefined => {
  for (const n of nodes) {
    if (pred(n)) return n;
    const c = find(n.children, pred);
    if (c) return c;
  }
  return undefined;
};

/* Walk the reveals a `?step=` would follow from one rung until the step is
   drawn: exactly what WorkflowMap's pending-step effect does, with the same
   convergence claim — every hop draws strictly more, and a step nothing is
   holding stops the walk instead of looping. */
type Hopper = Parameters<typeof buildMap>[0];
function hopTo(seed: Omit<Hopper, "expanded" | "layer">, key: WorkflowKey, want: string, from: Layer) {
  let expanded: Record<string, boolean> = {};
  let layer = from;
  const drawn: number[] = [];
  const trail: string[] = [];
  for (let i = 0; i < 8; i++) {
    const built = buildMap({ ...seed, expanded, layer });
    drawn.push(built.counts.rendered);
    if (built.byStep.has(`${key}:${want}`)) return { hops: i, drawn, trail };
    const holding = built.hiddenSteps.get(`${key}:${want}`);
    if (!holding) return { hops: -1, drawn, trail };
    trail.push(holding);
    const rung = revealLayer(holding);
    if (rung) layer = rung;
    else expanded = { ...expanded, [holding]: true };
  }
  return { hops: -1, drawn, trail };
}

const base = { viewed: PROTOTYPE_VIEWED, linkMap: PROTOTYPE.linkMap, summaries: PROTOTYPE.summaries, query: "", now: PROTOTYPE_NOW };

/* ── prototype (hub): the viewed scenario is the one root, always open; callers form the block ── */
{
  const expanded = initialExpanded(PROTOTYPE.linkMap, PROTOTYPE_VIEWED);
  assert(Object.keys(expanded).length === 0, "initialExpanded is empty: the viewed root is open by construction, callers start folded");
  const m = buildMap({ ...base, expanded });
  assert(m.roots.length === 1 && m.roots[0].id === "wf:make:912" && m.roots[0].kind === "scenario", "the viewed scenario is the single root");
  const viewedPill = m.roots[0];
  assert(viewedPill.pill?.open === true && viewedPill.pill.pinned === true && pillChip(viewedPill) === null && viewedPill.isViewed === true, "the viewed root is pinned open with no chip");
  assert(m.callers.length === 4 && m.callers.every((c) => c.kind === "workflow" && c.pill?.open === false && c.depth === 0), "4 GHL callers form the folded block");
  assert(m.callers[0].id === "wf:ghl:pcf-a" && m.callers[3].name.startsWith("TEST"), "callers sorted by name (Live A first, TEST last)");
  assert(m.flat.filter((n) => n.ref?.refId === "912").length === 1, "the viewed workflow renders exactly once");
  const joins = m.pairs.filter((p) => p.kind === "join");
  assert(joins.length === 4 && joins.every((p) => p.to === viewedPill.id) && joins.map((p) => p.from).join(",") === m.callers.map((c) => c.id).join(","), "one join pair from every folded caller pill into the viewed pill");
  assert(m.callers.every((c) => c.children.length === 0), "a folded caller shows no downstream pills: what it calls hangs off the steps that call it, and a folded workflow draws no steps");
  assert(!m.flat.some((n) => n.ref?.refId === "913"), "so make:913, which only Live A calls, is nowhere on the map until Live A is opened — a connection is drawn beside its call site or not at all");
  assert(viewedPill.children.length === 3, "scenario shows a 3-step column (webhook, filterRows, BasicIfElse)");
  const router = m.byId.get("wf:make:912/m:3");
  assert(router?.children.length === 2 && router.children.every((c) => c.kind === "route"), "BasicIfElse fans out into two route nodes");
  assert(router.children[0].name === "yes" && router.children[1].name === "no", "a branch wears the platform's own branch name, alone — no prefix, no position");
  assert(router.children[0].desc === "" && router.children[1].desc === "", "and nothing on its second line when the platform exposes no predicate — filler there would compete with the name");
  const viewedSummary = PROTOTYPE.summaries.get("make:912")!;
  const scenario = viewedSummary.state === "ok" ? viewedSummary.summary : null;
  const withCond = buildMap({
    ...base,
    expanded: {},
    summaries: new Map([
      ...PROTOTYPE.summaries,
      ["make:912" as WorkflowKey, { state: "ok", summary: { ...scenario!, connections: scenario!.connections.map((c) => (c.label === "yes" ? { ...c, condition: "Outcome is 'No-Showed'" } : c)) } } as SummaryEntry],
    ]),
  });
  assert(withCond.byId.get("wf:make:912/m:3")?.children[0].desc === "Outcome is 'No-Showed'", "and the predicate when there is one — why execution takes this branch, which belongs to the line rather than to either end");
  assert(router.children[0].children.length === 2 && router.children[1].children.length === 1, "route columns carry their branch steps");
  assert(router.children[0].id === "wf:make:912/m:3/route:3:0", "route ids are path-based and index-free");
  assert(m.callers[0].meta === "last run 2h ago", "pill meta line is the card's last run, no provider prefix");
  assert(m.callers[3].status === "off" && m.callers[0].status === "ok", "status dot follows isActive");
  assert(m.counts.connected === 4 && m.counts.matchedRoots === 5, "connected = callers ∪ direct targets; matchedRoots counts the root and the callers");
  assert(m.counts.openPills === 1, "counts.openPills counts open pills actually rendered (only the viewed one)");
  assert(m.pairs.filter((p) => p.kind === "tree").length === m.flat.length - 1 - m.callers.length, "one tree pair per visible parent→child (roots and callers have none)");
  assert(m.pairs.find((p) => p.to === router.id)?.depth === 0 && m.pairs.find((p) => p.to === router.children[0].id)?.depth === 1, "pair depth is the parent's depth");
  assert(rootOf(router.id) === "wf:make:912" && rootOf("wf:ghl:pcf-a/m:hook/wf:make:913") === "wf:ghl:pcf-a", "rootOf() strips to the top-level row id (viewed root or caller)");
  assert(m.byStep.get("make:912:3") === router, "byStep resolves '<key>:<stepId>' to the first rendered step");
  assert(m.wanted.length === 0, "nothing wanted when every open pill is loaded");
  assert(viewedPillId(m, PROTOTYPE_VIEWED) === viewedPill.id, "viewedPillId finds the viewed root");
  assert(m.flat[0] === m.callers[0] && m.flat.indexOf(viewedPill) === m.flat.length - 1 - viewedPill.descendants, "flat order: callers block first (left), then the viewed tree");
  const all = buildMap({ ...base, expanded: expandAllSnapshot(m, expanded) });
  assert(all.callers.every((c) => c.pill?.open) && all.byId.get("wf:ghl:pcf-a/m:hook/wf:make:913")?.parentId === "wf:ghl:pcf-a/m:hook" && !("wf:make:912" in expandAllSnapshot(m, expanded)), "expand-all opens the callers, make:913 appears beside the POST webhook that calls it, and the viewed pill is never touched");
  /* unfolding caller 0: its chain renders in the block and the cross edge starts at POST webhook */
  const opened = buildMap({ ...base, expanded: { ...expanded, "wf:ghl:pcf-a": true } });
  const hook = opened.byId.get("wf:ghl:pcf-a/m:hook");
  assert(hook?.parentId === "wf:ghl:pcf-a/m:s1" || hook?.parentId === "wf:ghl:pcf-a", "an expanded caller renders its chain inside the block");
  assert(opened.pairs.some((p) => p.kind === "join" && p.from === hook!.id && p.to === "wf:make:912") && !opened.pairs.some((p) => p.kind === "join" && p.from === "wf:ghl:pcf-a"), "the cross edge now starts at the step that calls the viewed workflow");
  assert(opened.flat.filter((n) => n.ref?.refId === "912").length === 1 && hook!.attachedRefs.map((r) => r.refId).join(",") === "913", "the viewed workflow is still rendered once — the calling step attaches only its other target");
  assert(opened.byStep.get("make:912:3")?.id === router.id, "viewed ids are unchanged by the caller's toggle (deep links survive)");
  assert(opened.callers[0].descendants === 4, "the expanded caller's subtree counts its 3 steps + the 913 pill");
  const other = opened.byId.get("wf:ghl:pcf-a/m:hook/wf:make:913");
  assert(other?.pill?.open === false && pillChip(other) === "2 modules" && other.parentId === hook!.id, "the other scenario appears beside its calling step, folded, saying what is inside it");
  assert(pillChip(m.byId.get("wf:ghl:pcf-a")!) === "3 steps" && pillChip(opened.byId.get("wf:ghl:pcf-a")!) === "3 steps", "the label is the same shut or open — the end cap's circle says which — so opening a pill never resizes the capsule its edges attach to");
  assert(pillNoun(other, 2) === "modules" && pillNoun(other, 1) === "module" && pillNoun(m.byId.get("wf:ghl:pcf-a")!, 1) === "step", "in the platform's own word — a Make scenario's modules, everyone else's steps — and singular for one");
  /* a folded caller with no summary asks for nothing and still joins the viewed pill */
  const noB = new Map(PROTOTYPE.summaries);
  noB.delete("ghl:pcf-b");
  const mb = buildMap({ ...base, summaries: noB, expanded });
  assert(!mb.wanted.includes("ghl:pcf-b") && mb.pairs.some((p) => p.kind === "join" && p.from === "wf:ghl:pcf-b"), "a folded caller without a summary is not wanted and still joins the viewed pill");
  assert(mb.byStep.get("make:912:3")?.id === router.id, "?step deep link into the viewed scenario resolves regardless of the callers");
  /* collapse-all: {} leaves the viewed pill open */
  const collapsed = buildMap({ ...base, expanded: {} });
  assert(collapsed.roots[0].pill?.open === true && collapsed.roots[0].children.length === 3, "Collapse all cannot fold the viewed pill");
}

/* ── hub fixture like ghl-5bdc73bf: 4 callers, no targets ── */
{
  const mods = (ids: [string, string, string][]) =>
    ids.map(([id, kind, app]) => ({ id, module: id, app, label: id, summary: "", ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind }) as ModuleInfo);
  const hub: ScenarioSummary = { name: "hub", totalModules: 3, appsUsed: ["ghl"], modules: mods([["h1", "trigger", "ghl"], ["h2", "action", "ghl"], ["h3", "action", "ghl"]]), connections: [{ from: "h1", to: "h2", kind: "sequence" }, { from: "h2", to: "h3", kind: "sequence" }], issues: [] };
  const caller = (n: number): ScenarioSummary => ({ name: `caller ${n}`, totalModules: 2, appsUsed: ["ghl", "webhook"], modules: mods([[`t${n}`, "trigger", "ghl"], [`w${n}`, "webhook", "webhook"]]), connections: [{ from: `t${n}`, to: `w${n}`, kind: "sequence" }], issues: [] });
  const linkMap: LinkMap = {
    workflows: [{ source: "ghl", refId: "hub", name: "hub", stepCount: 3 }, ...[1, 2, 3, 4].map((n) => ({ source: "ghl" as const, refId: `c${n}`, name: `caller ${n}`, stepCount: 2 }))],
    links: [1, 2, 3, 4].map((n) => ({ from: { source: "ghl" as const, refId: `c${n}`, stepId: `w${n}`, stepName: `w${n}` }, to: { source: "ghl" as const, refId: "hub" }, kind: "webhook-call" as const, status: "ok" as const })),
    unmatched: [],
    stats: { workflows: 5, links: 4, deadLinks: 0 },
  };
  const summaries = new Map<WorkflowKey, SummaryEntry>([["ghl:hub", { state: "ok", summary: hub }], ...[1, 2, 3, 4].map((n): [WorkflowKey, SummaryEntry] => [`ghl:c${n}`, { state: "ok", summary: caller(n) }])]);
  const viewed = { source: "ghl" as const, refId: "hub" };
  const m = buildMap({ viewed, linkMap, summaries, expanded: initialExpanded(linkMap, viewed), query: "", now: PROTOTYPE_NOW });
  assert(m.roots.length === 1 && m.roots[0].pill?.pinned && m.roots[0].pill.open && pillChip(m.roots[0]) === null && m.flat.filter((n) => n.ref?.refId === "hub").length === 1, "exactly one viewed pill, open, no chip");
  assert(m.callers.length === 4 && m.callers.every((c) => c.pill?.open === false && c.children.length === 0), "4 caller pills folded in the block, nothing under them (their only target is the viewed workflow)");
  const j = m.pairs.filter((p) => p.kind === "join");
  assert(j.length === 4 && j.every((p) => p.to === "wf:ghl:hub") && j.map((p) => p.from).join(",") === "wf:ghl:c1,wf:ghl:c2,wf:ghl:c3,wf:ghl:c4", "4 join pairs caller → viewed");
  assert(m.roots[0].children.map((c) => c.name).join(",") === "h1,h2,h3" && m.pairs.filter((p) => p.anchor === "h").length === 3, "the viewed chain is one row: the pill to its first step, then step to step, all on the rail");
  const e = buildMap({ viewed, linkMap, summaries, expanded: { "wf:ghl:c2": true }, query: "", now: PROTOTYPE_NOW });
  assert(e.callers[1].children.map((c) => c.name).join(",") === "t2,w2" && e.callers[1].children[1].parentId === "wf:ghl:c2", "expanding caller 2 renders its chain inside the block");
  const ej = e.pairs.filter((p) => p.kind === "join");
  assert(ej.length === 4 && ej.some((p) => p.from === "wf:ghl:c2/m:w2") && !ej.some((p) => p.from === "wf:ghl:c2"), "its cross edge now starts at its webhook step");
  assert(e.flat.filter((n) => n.ref?.refId === "hub").length === 1, "still exactly one viewed pill");
  const ids = e.flat.map((n) => n.id);
  assert(new Set(ids).size === ids.length, "ids unique");
}

/* ── wanted: an open pill with no summary entry ── */
{
  const summaries = new Map(PROTOTYPE.summaries);
  summaries.delete("make:913");
  const expanded = { "wf:ghl:pcf-a": true, "wf:ghl:pcf-a/m:hook/wf:make:913": true };
  const m = buildMap({ ...base, summaries, expanded });
  const p = m.byId.get("wf:ghl:pcf-a/m:hook/wf:make:913");
  assert(m.wanted.includes("make:913") && p?.pill?.loading === true && pillChip(p) === "2 modules", "open + no entry → key in wanted, pill loading; its label is the link card's count, the words it keeps once loaded — the circle, not the label, says it is loading");
  const noCount = JSON.parse(JSON.stringify(PROTOTYPE.linkMap), (_k, v) => (v && v.source === "make" && v.refId === "913" && "stepCount" in v ? { ...v, stepCount: undefined } : v));
  assert(pillChip(buildMap({ ...base, linkMap: noCount, summaries, expanded }).byId.get(p.id)!) === "Modules", "with no count anywhere — a Make link card may carry none — the label names the noun alone, never '0 modules'");
  summaries.set("make:913", { state: "loading" });
  const m2 = buildMap({ ...base, summaries, expanded });
  assert(m2.wanted.length === 0 && m2.byId.get(p.id)?.pill?.loading === true, "a loading entry is not re-wanted");
  summaries.set("make:913", { state: "error", error: "not-synced" });
  const m3 = buildMap({ ...base, summaries, expanded });
  assert(pillChip(m3.byId.get(p.id)!) === "not captured" && m3.byId.get(p.id)!.children.length === 0, "an errored entry reads 'not captured'");
}

/* ── filter: force-unfolds loaded pills only ── */
{
  const expanded = { "wf:ghl:pcf-a": true };
  const loaded = buildMap({ ...base, expanded, query: "addRow" });
  assert(loaded.roots.length === 0 && loaded.callers.length === 1 && loaded.callers[0].id === "wf:ghl:pcf-a", "filter keeps only top-level rows with a hit somewhere below (here: the caller that links to make:913)");
  const p913 = find(loaded.callers, (n) => n.id.endsWith("/wf:make:913"));
  assert(p913?.pill?.open === true && p913.children.length === 1 && p913.children[0].hit, "a loaded pill force-unfolds to its matching step only");
  const hook = loaded.byId.get("wf:ghl:pcf-a/m:hook");
  assert(hook?.children.length === 1 && hook.attachedRefs.length === 1, "children are filtered at every level");
  assert(loaded.counts.matchedRoots === 1, "counts.matchedRoots after the filter");
  const summaries = new Map(PROTOTYPE.summaries);
  summaries.delete("make:913");
  const unloaded = buildMap({ ...base, summaries, expanded, query: "addRow" });
  assert(unloaded.roots.length === 0 && unloaded.callers.length === 0 && unloaded.wanted.length === 0, "an unloaded pill is not unfolded by the filter and nothing is fetched");
  const byName = buildMap({ ...base, summaries, expanded: {}, query: "log unsuccessful" });
  assert(byName.callers.length === 1 && byName.wanted.length === 0, "pill names still match while folded, without a fetch");
  const viewedHit = buildMap({ ...base, expanded: {}, query: "filterRows" });
  assert(viewedHit.roots.length === 1 && viewedHit.callers.length === 0 && viewedHit.roots[0].children.length === 1, "a hit inside the viewed workflow keeps the root and drops callers without hits");
}

/* ── cycle guard A → B → A ── */
{
  const a: ScenarioSummary = { name: "A", totalModules: 1, appsUsed: ["webhook"], modules: [{ id: "a1", module: "hook", app: "webhook", label: "call B", depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "webhook" }], connections: [] };
  const b: ScenarioSummary = { name: "B", totalModules: 1, appsUsed: ["webhook"], modules: [{ id: "b1", module: "hook", app: "webhook", label: "call A", depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "webhook" }], connections: [] };
  const linkMap: LinkMap = {
    workflows: [
      { source: "ghl", refId: "A", name: "A", stepCount: 1 },
      { source: "ghl", refId: "B", name: "B", stepCount: 1 },
    ],
    links: [
      { from: { source: "ghl", refId: "A", stepId: "a1" }, to: { source: "ghl", refId: "B" }, kind: "webhook-call", status: "ok" },
      { from: { source: "ghl", refId: "B", stepId: "b1" }, to: { source: "ghl", refId: "A" }, kind: "webhook-call", status: "ok" },
    ],
    unmatched: [],
    stats: { workflows: 2, links: 2, deadLinks: 0 },
  };
  const summaries = new Map<WorkflowKey, SummaryEntry>([
    ["ghl:A", { state: "ok", summary: a }],
    ["ghl:B", { state: "ok", summary: b }],
  ]);
  const viewed = { source: "ghl" as const, refId: "B" };
  const m = buildMap({ viewed, linkMap, summaries, expanded: { "wf:ghl:B/m:b1/wf:ghl:A": true }, query: "" });
  assert(m.roots.length === 1 && m.roots[0].id === "wf:ghl:B" && m.callers.length === 1 && m.callers[0].id === "wf:ghl:A", "B is the root; its caller A sits in the block");
  const aUnderB = m.byId.get("wf:ghl:B/m:b1/wf:ghl:A");
  assert(aUnderB?.pill?.open === true && aUnderB.children.length === 1 && aUnderB.children[0].children.length === 0, "A is also B's target: expanded under b1 it shows its step, whose link back to B (the viewed) renders as nothing — never a second B");
  assert(m.flat.filter((n) => n.ref?.refId === "B").length === 1 && m.pairs.filter((p) => p.kind === "join").length === 1, "the viewed workflow renders once; the block's A joins it");
  assert(m.counts.connected === 1, "A is both caller and target: counted once");
  /* a real ring away from the viewed workflow: V → X → Y → X */
  const step = (id: string, label: string): ModuleInfo => ({ id, module: "hook", app: "webhook", label, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "webhook" });
  const ring: LinkMap = {
    workflows: [{ source: "ghl", refId: "V", name: "V" }, { source: "ghl", refId: "X", name: "X" }, { source: "ghl", refId: "Y", name: "Y" }],
    links: [
      { from: { source: "ghl", refId: "V", stepId: "v1" }, to: { source: "ghl", refId: "X" }, kind: "webhook-call", status: "ok" },
      { from: { source: "ghl", refId: "X", stepId: "x1" }, to: { source: "ghl", refId: "Y" }, kind: "webhook-call", status: "ok" },
      { from: { source: "ghl", refId: "Y", stepId: "y1" }, to: { source: "ghl", refId: "X" }, kind: "webhook-call", status: "ok" },
    ],
    unmatched: [],
    stats: { workflows: 3, links: 3, deadLinks: 0 },
  };
  const ringSummaries = new Map<WorkflowKey, SummaryEntry>([
    ["ghl:V", { state: "ok", summary: { name: "V", totalModules: 1, appsUsed: ["webhook"], modules: [step("v1", "call X")], connections: [] } }],
    ["ghl:X", { state: "ok", summary: { name: "X", totalModules: 1, appsUsed: ["webhook"], modules: [step("x1", "call Y")], connections: [] } }],
    ["ghl:Y", { state: "ok", summary: { name: "Y", totalModules: 1, appsUsed: ["webhook"], modules: [step("y1", "call X")], connections: [] } }],
  ]);
  const r = buildMap({ viewed: { source: "ghl", refId: "V" }, linkMap: ring, summaries: ringSummaries, expanded: { "wf:ghl:V/m:v1/wf:ghl:X": true, "wf:ghl:V/m:v1/wf:ghl:X/m:x1/wf:ghl:Y": true }, query: "" });
  const back = r.byId.get("wf:ghl:V/m:v1/wf:ghl:X/m:x1/wf:ghl:Y/m:y1/wf:ghl:X");
  assert(back?.pill?.cycle === true && back.pill.open === false && back.children.length === 0, "X under Y under X is a cycle pill that cannot unfold");
  assert(pillChip(back) === "↺ already open above", "cycle chip text");
  assert(back.path.join(">") === "ghl:V>ghl:X>ghl:Y>ghl:X", "path records the workflows open on the way here");
}

/* ── GHL: router with labelled routes, an orphan, a join and a jump ── */
{
  const mod = (id: string, label: string, extra: Partial<ModuleInfo> = {}): ModuleInfo => ({ id, module: label, app: "ghl", label, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "action", ...extra });
  const g: ScenarioSummary = {
    name: "G",
    totalModules: 8,
    appsUsed: ["ghl"],
    modules: [
      mod("orphan", "Orphan step"),
      mod("e", "Send email", { ordinal: "4" }),
      mod("t", "Form submitted", { kind: "trigger" }),
      mod("a", "Wait 1 day", { kind: "wait", ordinal: "1" }),
      mod("b", "If / else", { kind: "branch", ordinal: "2" }),
      mod("c", "Add tag", { ordinal: "3.A.1" }),
      mod("d", "Remove tag", { ordinal: "3.B.1" }),
      mod("back", "Go to", { ordinal: "5" }),
    ],
    connections: [
      { from: "t", to: "a", kind: "sequence" },
      { from: "a", to: "b", kind: "sequence" },
      { from: "b", to: "c", kind: "branch", label: "Yes" },
      { from: "b", to: "d", kind: "branch" },
      { from: "c", to: "e", kind: "sequence" },
      { from: "d", to: "e", kind: "sequence" },
      { from: "e", to: "back", kind: "sequence" },
      { from: "back", to: "a", kind: "goto" },
    ],
  };
  const viewed = { source: "ghl" as const, refId: "G" };
  const linkMap: LinkMap = { workflows: [{ source: "ghl", refId: "G", name: "G", stepCount: 8 }], links: [], unmatched: [], stats: { workflows: 1, links: 0, deadLinks: 0 } };
  const summaries = new Map<WorkflowKey, SummaryEntry>([[keyOf(viewed), { state: "ok", summary: g }]]);
  const m = buildMap({ viewed, linkMap, summaries, expanded: initialExpanded(linkMap, viewed), query: "" });
  assert(m.roots.length === 1 && m.roots[0].id === "wf:ghl:G" && m.roots[0].pill?.open, "no callers → the viewed workflow is the single open root");
  const col = m.roots[0].children.map((n) => n.id.split("/").pop());
  assert(col.join(",") === "m:t,m:a,m:b,m:orphan", "column: trigger first, chain, nothing after the fan-out, orphan last");
  const b = m.byId.get("wf:ghl:G/m:b")!;
  assert(b.children.length === 2 && b.children[0].name === "Yes" && b.children[1].name === "Remove tag", "an unlabelled branch is named after the step it leads to — it IS the next step — rather than by its position");
  const yes = b.children[0];
  const no = b.children[1];
  assert(yes.children.map((n) => n.name).join(",") === "Add tag" && no.children.map((n) => n.name).join(",") === "Remove tag", "each route stops before the shared step");
  assert(b.joins.length === 1 && b.joins[0].name === "Send email" && b.joins[0].id === "wf:ghl:G/m:b/m:e", "the shared step is one join head in the router's join column");
  const e = b.joins[0];
  assert(e.children.map((n) => n.name).join(",") === "Go to" && e.children[0].parentId === e.id, "the join head continues its chain as its children");
  const joins = m.pairs.filter((p) => p.kind === "join");
  assert(joins.length === 2 && joins.every((p) => p.to === e.id) && joins.map((p) => p.from).sort().join(",") === "wf:ghl:G/m:b/route:b:0/m:c,wf:ghl:G/m:b/route:b:1/m:d", "two join pairs, one from each branch tail");
  const back = e.children[0];
  assert(back.desc === "→ Wait 1 day" && back.jumpTo?.stepId === "a", "a Go to step keeps its card with '→ target'");
  const jumps = m.pairs.filter((p) => p.kind === "jump");
  assert(jumps.length === 1 && jumps[0].from === back.id && jumps[0].to === "wf:ghl:G/m:a", "one jump pair from the Go to step to its target");
  assert(m.flat.every((n) => !n.name.startsWith("↺")), "no marker cards anywhere");
  assert(m.byStep.get("ghl:G:e")?.id === e.id && m.flat.filter((n) => n.stepRef?.stepId === "e" && n.kind === "step").length === 1, "byStep resolves the shared step to its single card");
  assert(m.byStep.get("ghl:G:b")?.kind === "step", "byStep for a fan-out step returns the step, not a route");
  assert(!m.byStep.has("ghl:G:missing"), "byStep misses cleanly");
  assert(m.pairs.filter((p) => p.kind === "tree").length === m.flat.length - 1 - 1, "tree pairs cover every node except the root and the join head");
  assert(m.flat.length === m.byId.size && new Set(m.flat.map((n) => n.id)).size === m.flat.length, "ids are unique");
}

/* ── unresolved calling step + steps unavailable ── */
{
  const linkMap: LinkMap = {
    workflows: [
      { source: "ghl", refId: "L", name: "L", stepCount: 2 },
      { source: "make", refId: "912", name: "S", stepCount: 6 },
      { source: "make", refId: "913", name: "S2", stepCount: 2 },
    ],
    links: [
      { from: { source: "ghl", refId: "L" }, to: { source: "make", refId: "912" }, kind: "webhook-call", status: "ok" },
      { from: { source: "ghl", refId: "L", stepId: "gone" }, to: { source: "make", refId: "913" }, kind: "subflow", status: "dead" },
    ],
    unmatched: [],
    stats: { workflows: 2, links: 2, deadLinks: 0 },
  };
  const l: ScenarioSummary = {
    name: "L",
    totalModules: 2,
    appsUsed: ["ghl"],
    modules: [
      { id: "t", module: "trigger", app: "ghl", label: "Trigger", depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "trigger" },
      { id: "s", module: "step", app: "ghl", label: "Step", depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "action", ordinal: "1" },
    ],
    connections: [{ from: "t", to: "s", kind: "sequence" }],
  };
  const viewed = { source: "ghl" as const, refId: "L" }; // L itself is viewed: both links leave it, neither target is the viewed workflow
  const summaries = new Map<WorkflowKey, SummaryEntry>([["ghl:L", { state: "ok", summary: l }]]);
  const m = buildMap({ viewed, linkMap, summaries, expanded: { "wf:ghl:L": true }, query: "" });
  const t = m.byId.get("wf:ghl:L/m:t")!;
  assert(t.attachedRefs.length === 2 && t.children.every((c) => c.pill?.unresolvedStep), "links without a captured step attach to the entry node");
  assert(t.children[1].desc.includes("calling step not captured") && t.children[1].desc.includes("link is dead"), "unresolved / dead links say so in the pill description");

  const unavailable = new Map<WorkflowKey, SummaryEntry>([["ghl:L", { state: "error", error: "not-captured", stepsUnavailable: true }]]);
  const u = buildMap({ viewed, linkMap, summaries: unavailable, expanded: { "wf:ghl:L": true }, query: "" });
  const root = u.roots[0];
  /* Nothing is hidden here, because there is nothing to hide. A workflow
     whose connection exposes no steps is never the CALLING end of a link:
     the link engine finds calls by reading step content, and a step-less row
     carries none, so the link capabilities have nothing to find. (It is the
     empty content that guarantees this, not the connector — the link map is
     built from the primary connector classes, so a step-less row is still
     walked by every link capability its provider has.) No real sync
     therefore produces the two links this fixture hangs off L — they are
     synthetic, and only exercise what the canvas would do with an impossible
     input: draw nothing, rather than invent a place for a call that has no
     step to make it. The premise is enforced API-side by
     `orrit-api/tests/test_links.py::TestStepLessWorkflowsNeverCall`, including
     a test pinning that it rests on empty raw content; if a step-less row
     ever carries step content, that fails and this is revisited on purpose. */
  assert(root.pill?.unavailable === true && root.pill.open && root.children.length === 0, "a step-less workflow has no call sites, so it has no downstream pills — and has no links to lose, since with no step content it cannot be a link's calling end");
  assert(pillChip(root) === "steps unavailable" && root.childCount === 2, "unavailable chip + childCount from the card");
}

/* ── big(): LITE / windowing thresholds ── */
{
  const f = big(300);
  assert(f.linkMap.workflows.length === 302 && f.linkMap.links.length === 375, "big(300) synthesises 300 callers (every 4th fans out to both scenarios)");
  const m = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: initialExpanded(f.linkMap, f.viewed), query: "", now: PROTOTYPE_NOW });
  assert(m.roots.length === 1 && m.callers.length === 300 && m.callers.every((c) => !c.pill?.open) && m.counts.openPills === 1, "one viewed root, 300 folded callers in the block");
  assert(m.pairs.filter((p) => p.kind === "join").length === 300 && m.callers.every((c) => c.children.length === 0), "300 join edges into the viewed pill; a folded caller shows none of its own downstream calls");
  const opened = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: expandAllSnapshot(m, {}), query: "", now: PROTOTYPE_NOW });
  assert(opened.counts.rendered > 150 && opened.callers.every((c) => c.pill?.open) && opened.flat.filter((n) => n.ref?.refId === "912").length === 1, "expand-all on the big fixture crosses LITE_AT, opens every caller, and the viewed workflow still renders once");
  const p913 = opened.flat.filter((n) => n.ref?.refId === "913");
  assert(p913.length === 75 && new Set(p913.map((n) => n.id)).size === 75, "and each of the 75 callers that calls make:913 carries its OWN pill for it — 75 call sites, 75 pills, 75 distinct ids — not one pill for the first caller");
  assert(p913.every((n) => opened.byId.get(n.parentId!)?.kind === "step"), "every one of them beside the step that makes the call");
  const twice = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: expandAllSnapshot(opened, expandAllSnapshot(m, {})), query: "", now: PROTOTYPE_NOW });
  assert(twice.flat.filter((n) => n.ref?.refId === "913" && n.pill?.open).length === 1, "a second Expand all opens make:913 once, not 75 times: a scenario called from many steps is drawn open at one of them");
}

/* ── joins: three triggers feeding one step → one card in the pill's join column ── */
{
  const mods = (ids: [string, string][]) =>
    ids.map(([id, kind]) => ({ id, module: id, app: "ghl", label: id, summary: "", ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind }) as ModuleInfo);
  const fan: ScenarioSummary = {
    name: "fan-in",
    totalModules: 4,
    appsUsed: ["ghl"],
    modules: mods([["t1", "trigger"], ["t2", "trigger"], ["t3", "trigger"], ["act", "action"]]),
    connections: [
      { from: "t1", to: "act", kind: "sequence" },
      { from: "t2", to: "act", kind: "sequence" },
      { from: "t3", to: "act", kind: "sequence" },
    ],
    issues: [],
  };
  const viewed = { source: "ghl" as const, refId: "fan" };
  const lm: LinkMap = { workflows: [{ source: "ghl", refId: "fan", name: "fan-in" }], links: [], unmatched: [], stats: { workflows: 1, links: 0, deadLinks: 0 } };
  const summaries = new Map<WorkflowKey, SummaryEntry>([["ghl:fan", { state: "ok", summary: fan }]]);
  const m = buildMap({ viewed, linkMap: lm, summaries, expanded: { "wf:ghl:fan": true }, query: "", now: PROTOTYPE_NOW });
  const ids = m.flat.map((n) => n.id);
  assert(new Set(ids).size === ids.length, "every node id in a build is unique");
  const root = m.roots[0];
  assert(root.children.map((n) => n.name).join(",") === "t1,t2,t3" && root.joins.length === 1 && root.joins[0].name === "act", "three entry columns, the shared step once as a join head");
  assert(m.pairs.filter((p) => p.kind === "join").length === 3 && m.flat.filter((n) => n.name === "act").length === 1, "three join pairs into the one card");
  assert(m.byStep.get("ghl:fan:act")?.id === root.joins[0].id, "byStep resolves the join head");
  assert(root.descendants === 4, "descendants count the join column");

  /* two branches → "Go to" → the same target: the target renders once, two jump pairs */
  const jumpy: ScenarioSummary = {
    name: "jumpy",
    totalModules: 6,
    appsUsed: ["ghl"],
    modules: mods([["t", "trigger"], ["r", "branch"], ["g1", "action"], ["g2", "action"], ["target", "action"], ["z", "action"]]),
    connections: [
      { from: "t", to: "r", kind: "sequence" },
      { from: "r", to: "g1", kind: "branch", label: "A" },
      { from: "r", to: "g2", kind: "branch", label: "B" },
      { from: "g1", to: "target", kind: "goto" },
      { from: "g2", to: "target", kind: "goto" },
      { from: "target", to: "z", kind: "sequence" },
    ],
    issues: [],
  };
  const jv = { source: "ghl" as const, refId: "jumpy" };
  const jm = buildMap({
    viewed: jv,
    linkMap: { workflows: [{ source: "ghl", refId: "jumpy", name: "jumpy" }], links: [], unmatched: [], stats: { workflows: 1, links: 0, deadLinks: 0 } },
    summaries: new Map<WorkflowKey, SummaryEntry>([["ghl:jumpy", { state: "ok", summary: jumpy }]]),
    expanded: { "wf:ghl:jumpy": true },
    query: "",
    now: PROTOTYPE_NOW,
  });
  const targets = jm.flat.filter((n) => n.stepRef?.stepId === "target" && n.kind === "step");
  const jjumps = jm.pairs.filter((p) => p.kind === "jump");
  assert(targets.length === 1 && jjumps.length === 2 && jjumps.every((p) => p.to === targets[0].id), "goto target rendered once, two jump pairs into it");
  assert(jm.roots[0].children.map((n) => n.name).join(",") === "t,r,target,z", "the goto-only target starts an entry column of its own (not a marker), its chain following");
  assert(jm.flat.filter((n) => n.jumpTo).map((n) => n.name).sort().join(",") === "g1,g2" && jm.flat.find((n) => n.name === "g1")?.desc === "→ target", "both Go to cards carry '→ target'");

  /* re-visit of a step rendered in another group: a cross pair, no card */
  const crossy: ScenarioSummary = {
    name: "crossy",
    totalModules: 6,
    appsUsed: ["ghl"],
    modules: mods([["t1", "trigger"], ["r", "branch"], ["a", "action"], ["x", "action"], ["b", "action"], ["t2", "trigger"]]),
    connections: [
      { from: "t1", to: "r", kind: "sequence" },
      { from: "r", to: "a", kind: "branch" },
      { from: "r", to: "b", kind: "branch" },
      { from: "a", to: "x", kind: "sequence" },
      { from: "t2", to: "x", kind: "sequence" },
    ],
    issues: [],
  };
  const cv = { source: "ghl" as const, refId: "crossy" };
  const cm = buildMap({
    viewed: cv,
    linkMap: { workflows: [{ source: "ghl", refId: "crossy", name: "crossy" }], links: [], unmatched: [], stats: { workflows: 1, links: 0, deadLinks: 0 } },
    summaries: new Map<WorkflowKey, SummaryEntry>([["ghl:crossy", { state: "ok", summary: crossy }]]),
    expanded: { "wf:ghl:crossy": true },
    query: "",
    now: PROTOTYPE_NOW,
  });
  const xs = cm.flat.filter((n) => n.stepRef?.stepId === "x" && n.kind === "step");
  const rnode = cm.flat.find((n) => n.name === "r")!;
  const t2 = cm.flat.find((n) => n.name === "t2")!;
  assert(xs.length === 1 && rnode.joins.length === 1 && rnode.joins[0] === xs[0], "x renders once, as a join head of the router it was first reached from");
  const cj = cm.pairs.filter((p) => p.kind === "join");
  assert(t2.children.length === 0 && cj.some((p) => p.from === t2.id && p.to === xs[0].id) && cj.length === 2, "the later trigger gets a join pair into the existing card and no second card");
  const allIds = cm.flat.map((n) => n.id);
  assert(new Set(allIds).size === allIds.length && cm.flat.filter((n) => n.kind === "step").every((n) => cm.byStep.get(`ghl:crossy:${n.stepRef!.stepId}`) === n), "ids unique and byStep resolves every step exactly once");
  for (const f of [PROTOTYPE, big(300)]) {
    const all = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: expandAllSnapshot(buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: {}, query: "", now: PROTOTYPE_NOW }), {}), query: "", now: PROTOTYPE_NOW });
    const allIds = all.flat.map((n) => n.id);
    assert(new Set(allIds).size === allIds.length, `unique ids across the fully expanded fixture (${allIds.length} nodes)`);
  }
}

/* ── descendants: rendered subtree size, used for the top-align rule ── */
{
  const expanded = { ...initialExpanded(PROTOTYPE.linkMap, PROTOTYPE_VIEWED), "wf:ghl:pcf-a": true };
  const m = buildMap({ ...base, expanded });
  const root = m.roots[0];
  assert(root.descendants === m.flat.filter((n) => n.id.startsWith("wf:make:912/")).length, "the viewed root's descendants = every rendered node under it");
  const callerA = m.callers[0];
  assert(callerA.descendants === m.flat.filter((n) => n.id.startsWith("wf:ghl:pcf-a/")).length && callerA.descendants === 4, "an expanded caller's descendants = its 3 steps + the folded 913 pill");
  const hook = find(m.callers, (n) => n.id === "wf:ghl:pcf-a/m:hook")!;
  assert(hook.descendants === 1 && hook.children[0].descendants === 0, "the calling step counts its folded target only; a folded target has none");
  assert(m.callers[1].descendants === 0 && root.children[0].descendants === 0, "a folded caller whose only target is the viewed workflow, and a leaf step, have none");
}

/* ── attached pills: collapsed first, unfolded last (stable otherwise) ── */
{
  const step = (id: string, label: string): ModuleInfo => ({ id, module: "hook", app: "webhook", label, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "webhook" });
  const lm: LinkMap = {
    workflows: [{ source: "ghl", refId: "V", name: "V" }, { source: "make", refId: "T1", name: "T1" }, { source: "make", refId: "T2", name: "T2" }],
    links: [
      { from: { source: "ghl", refId: "V", stepId: "v1" }, to: { source: "make", refId: "T1" }, kind: "webhook-call", status: "ok" },
      { from: { source: "ghl", refId: "V", stepId: "v1" }, to: { source: "make", refId: "T2" }, kind: "webhook-call", status: "ok" },
    ],
    unmatched: [],
    stats: { workflows: 3, links: 2, deadLinks: 0 },
  };
  const t = (name: string): ScenarioSummary => ({ name, totalModules: 1, appsUsed: ["webhook"], modules: [step(`${name}-1`, "hook")], connections: [] });
  const sums = new Map<WorkflowKey, SummaryEntry>([
    ["ghl:V", { state: "ok", summary: { name: "V", totalModules: 1, appsUsed: ["webhook"], modules: [step("v1", "fan out")], connections: [] } }],
    ["make:T1", { state: "ok", summary: t("T1") }],
    ["make:T2", { state: "ok", summary: t("T2") }],
  ]);
  const vv = { source: "ghl" as const, refId: "V" };
  const at = (expanded: Record<string, boolean>, summaries = sums) => buildMap({ viewed: vv, linkMap: lm, summaries, expanded, query: "" }).byId.get("wf:ghl:V/m:v1")!.children;
  assert(at({}).map((c) => c.ref?.refId).join(",") === "T1,T2", "both collapsed → link order (T1, T2)");
  assert(at({ "wf:ghl:V/m:v1/wf:make:T1": true }).map((c) => c.ref?.refId).join(",") === "T2,T1", "first attachment unfolded → it renders last, the folded sibling stays beside the step");
  assert(at({ "wf:ghl:V/m:v1/wf:make:T2": true }).map((c) => c.ref?.refId).join(",") === "T1,T2", "second attachment unfolded → order unchanged");
  const kids = at({ "wf:ghl:V/m:v1/wf:make:T1": true }, new Map([...sums].filter(([k]) => k !== "make:T1")));
  assert(kids.map((c) => c.ref?.refId).join(",") === "T2,T1" && kids[1].pill?.loading === true, "an unfolded pill still loading already sits last — no reorder when its summary lands");
}

/* ── chains: a sequence is parent → first step, then step → step (vertical) ── */
{
  const mods = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, module: `s${i + 1}`, app: "ghl", label: `Step ${i + 1}`, summary: "", ordinal: String(i + 1), depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: i === 0 ? "trigger" : "action" }) as ModuleInfo);
  const linear: ScenarioSummary = {
    name: "linear",
    totalModules: 9,
    appsUsed: ["ghl"],
    modules: mods(9),
    connections: Array.from({ length: 8 }, (_, i) => ({ from: `s${i + 1}`, to: `s${i + 2}`, kind: "sequence" as const })),
    issues: [],
  };
  const lv = { source: "ghl" as const, refId: "linear" };
  const lm = buildMap({
    viewed: lv,
    linkMap: { workflows: [{ source: "ghl", refId: "linear", name: "linear" }], links: [], unmatched: [], stats: { workflows: 1, links: 0, deadLinks: 0 } },
    summaries: new Map<WorkflowKey, SummaryEntry>([["ghl:linear", { state: "ok", summary: linear }]]),
    expanded: { "wf:ghl:linear": true },
    query: "",
    now: PROTOTYPE_NOW,
  });
  const root = lm.roots[0];
  assert(root.children.length === 9 && root.children.map((c) => c.name).join(",") === Array.from({ length: 9 }, (_, i) => `Step ${i + 1}`).join(","), "a linear workflow is one row of 9 in order");
  assert(root.children[0].chained !== true && root.children.slice(1).every((c) => c.chained), "every step after the first is chained");
  const fromPill = lm.pairs.filter((p) => p.from === root.id);
  const links = lm.pairs.filter((p) => p.anchor === "h" && p.from !== root.id);
  assert(fromPill.length === 1 && fromPill[0].to === root.children[0].id && fromPill[0].anchor === "h", "exactly one pair leaves the pill: to the first step, on the rail — the row starts at the pill");
  assert(links.length === 8 && links.every((p, i) => p.from === root.children[i].id && p.to === root.children[i + 1].id && p.kind === "tree"), "eight step → step rail links, in order, left to right");
  assert(lm.pairs.length === 9 && lm.pairs.every((p) => p.anchor === "h"), "no other pairs: a linear workflow is nothing but one straight row");
  /* prototype: the Make scenario chains 1 → 2 → 3(router) and route yes chains 4 → 5 */
  const pm = buildMap({ ...base, expanded: { ...initialExpanded(PROTOTYPE.linkMap, PROTOTYPE_VIEWED), "wf:ghl:pcf-a": true } });
  const sid = (id: string) => id.split("/").pop();
  const anchored = (a: EdgePair["anchor"]) => pm.pairs.filter((p) => p.kind === "tree" && p.anchor === a).map((p) => `${sid(p.from)}>${sid(p.to)}`).sort().join(" ");
  assert(anchored("h") === "m:1>m:2 m:2>m:3 m:4>m:5 route:3:0>m:4 route:3:1>m:6 wf:make:912>m:1", "prototype rows: the viewed workflow runs left to right — every chain link, plus the pill's and both branch lanes' links to their own first card");
  assert(anchored("v") === "m:s1>m:hook m:t1>m:s1 wf:ghl:pcf-a>m:t1", "the expanded caller is a connected workflow: its chain stacks under its pill, top to bottom, pill to first step included");
  assert(anchored("drop") === "", "no step of the viewed scenario calls anything, so nothing hangs from its row");
  assert(anchored(undefined) === "m:3>route:3:0 m:3>route:3:1 m:hook>wf:make:913", "the router fans to its branches unanchored, and the workflow the caller's webhook calls sits to the right of that step — below it is the caller's own column");
  assert(pm.flat.filter((n) => n.main).map((n) => sid(n.id)).join(" ") === "m:1 m:2 m:3 route:3:0 m:4 m:5 route:3:1 m:6" && pm.flat.every((n) => !n.main || n.stepRef?.key === "make:912"), "`main` marks exactly the viewed workflow's steps and branches — never a pill, never the caller's steps");
  const scen = find(pm.roots, (n) => n.id === "wf:make:912")!;
  assert(pm.pairs.filter((p) => p.from === scen.id).length === 1, "the scenario pill connects to its first module only");
}

/* ── viewed vs connected: isViewed + orritHref ── */
{
  const m = buildMap({ ...base, expanded: { ...initialExpanded(PROTOTYPE.linkMap, PROTOTYPE_VIEWED), "wf:ghl:pcf-a": true } });
  const viewedPills = m.flat.filter((n) => n.ref?.refId === "912");
  assert(viewedPills.length === 1 && viewedPills[0].isViewed === true && viewedPills[0].orritHref === undefined, "the viewed pill is flagged isViewed and has no Orrit link");
  assert(m.callers.every((r) => r.isViewed === undefined && r.orritHref === `/w/ghl/${r.ref!.refId}`), "connected caller pills link to their Orrit page");
  assert(m.byId.get("wf:ghl:pcf-a/m:hook/wf:make:913")?.orritHref === "/w/make/913", "a connected target pill links to its Orrit page");
  assert(m.byId.get("wf:ghl:pcf-a/m:t1")?.orritHref === undefined && m.flat.filter((n) => !n.pill).every((n) => n.orritHref === undefined), "steps and routes never carry a Orrit link — connected pills only");
  assert(m.byId.get("wf:make:912/m:3")?.orritHref === undefined && m.byId.get("wf:make:912/m:3/route:3:0")?.orritHref === undefined, "the viewed workflow's own steps and routes carry no Orrit link");
}

/* ── nativeUrl: pills carry their own, steps/routes inherit the owner's ── */
{
  const expanded = { ...initialExpanded(PROTOTYPE.linkMap, PROTOTYPE_VIEWED), "wf:ghl:pcf-a": true };
  const m = buildMap({ ...base, expanded });
  const scenario = find(m.roots, (n) => n.id === "wf:make:912");
  assert(scenario?.nativeUrl === "https://eu1.make.com/912/scenarios/912/edit", "attached Make pill carries its scenario's nativeUrl");
  const inside = scenario!.children.concat(scenario!.children.flatMap((c) => c.children)).filter((n) => !n.pill);
  assert(inside.length > 0 && inside.every((n) => n.nativeUrl === scenario!.nativeUrl), "steps and routes inherit the owning scenario's nativeUrl");
  const ghlStep = find(m.callers, (n) => n.id === "wf:ghl:pcf-a/m:hook");
  assert(m.callers[0].nativeUrl === null && ghlStep?.nativeUrl === null, "no URL in the summary → null on the pill and its steps (components fall back to the connector)");
  {
    // A folded pill never fetches its summary, so the card's editor link is
    // what the platform ↗ opens (GHL links need the connection's location).
    const withCard = buildMap({
      ...base,
      expanded,
      linkMap: {
        ...base.linkMap,
        workflows: base.linkMap.workflows.map((w) =>
          w.source === "ghl" && w.refId === m.callers[0].ref!.refId ? { ...w, nativeUrl: "https://app.gohighlevel.com/v2/location/loc/automation/workflow/x" } : w,
        ),
      },
    });
    assert(withCard.callers[0].nativeUrl === "https://app.gohighlevel.com/v2/location/loc/automation/workflow/x", "a folded pill takes its editor link from the link-map card");
  }
}

/* ── run replay overlay (run.ts): PROTOTYPE_TRACE over PROTOTYPE_RUN ── */
{
  const f = PROTOTYPE_RUN;
  const key = keyOf(f.viewed);
  const m = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: { "wf:ghl:pcf-a": true }, query: "", now: PROTOTYPE_NOW });
  const id = (stepId: string) => m.byStep.get(`${key}:${stepId}`)!.id;
  assert(m.roots[0].children.map((n) => n.name).join(",") === "gateway:CustomWebhook,google-sheets:filterRows,http:ActionSendData,builtin:BasicIfElse" && m.byId.get("wf:make:912/m:7/wf:make:913")?.parentId === id("7"), "PROTOTYPE_RUN: the viewed chain is 1 → 2 → 7 → 3 and make:913 hangs under module 7");
  const states = runStates(m, key, PROTOTYPE_TRACE);
  const viewedSteps = m.flat.filter((n) => n.kind === "step" && n.stepRef?.key === key);
  assert(viewedSteps.length === 7 && viewedSteps.every((n) => states.has(n.id)), "every rendered step of the viewed workflow has a run state");
  assert(states.get(id("4")) === "failed", "the failed module is `failed`");
  assert(["1", "2", "7", "3"].every((sid) => states.get(id(sid)) === "touched"), "the modules the run went through are `touched`");
  const router = m.byStep.get(`${key}:3`)!;
  const yes = router.children.find((c) => c.name === "yes")!;
  const no = router.children.find((c) => c.name === "no")!;
  assert(states.get(yes.id) === "touched", "a route with a touched (here: failed) child is `touched`");
  assert(states.get(no.id) === "untouched" && states.get(id("6")) === "untouched", "the untouched branch — its route and its step — is `untouched`");
  assert(states.get(id("5")) === "unknown", "a module outside coverage is `unknown`, never `untouched`");
  assert(states.get("wf:make:912/m:7/wf:make:913") === "reached", "the pill attached under a touched calling step is `reached`");
  /* Copies: states are resolved per step and spread to every rendered copy.
     The hub model renders each step once, so this guards the contract
     rather than showing two cards. */
  const perStep = new Map<string, Set<RunState | undefined>>();
  for (const n of viewedSteps) {
    const sid = n.stepRef!.stepId;
    (perStep.get(sid) ?? perStep.set(sid, new Set()).get(sid)!).add(states.get(n.id));
  }
  assert([...perStep].every(([sid, set]) => set.size === 1 && states.get(id(sid)) === [...set][0]), "every rendered copy of a step carries the state `byStep` resolves for it");
  const others = m.flat.filter((n) => (n.kind === "step" || n.kind === "route") && n.stepRef?.key !== key);
  assert(others.length > 0 && others.every((n) => !states.has(n.id)), "steps of other workflows (the expanded caller) carry no state");
  assert(m.byId.has("wf:ghl:pcf-a/m:hook/wf:make:913") && !states.has("wf:ghl:pcf-a/m:hook/wf:make:913") && !states.has("wf:make:912") && m.callers.every((c) => !states.has(c.id)), "pills not under a viewed step — the viewed root, the callers, a caller's target — carry no state");
  const dim = dimNodeIds(states);
  assert(dim.size === 3 && dim.has(id("6")) && dim.has(no.id) && dim.has(id("5")) && !dim.has(id("4")) && !dim.has(yes.id), "dimNodeIds = untouched ∪ unknown (route no, module 6, module 5)");
  assert(failedNodeIds(states).size === 1 && failedNodeIds(states).has(id("4")), "failedNodeIds = the failed module only");
  assert(runSummary(PROTOTYPE_TRACE) === "5 of 7 steps reached · 1 failed" && runUnchecked(PROTOTYPE_TRACE) === 1, "runSummary reads '5 of 7 steps reached · 1 failed'; one step unchecked");
  /* ── framing the run (runFocusRect): pure rect maths, no DOM ── */
  {
    const box = (x: number, y: number): FocusRect => ({ x, y, w: 200, h: 60 });
    const st = (e: [string, RunState][]) => new Map<string, RunState>(e);
    const rc = (e: [string, FocusRect][]) => new Map<string, FocusRect>(e);

    /* Nothing reached, or nothing measured: the camera is left alone. */
    assert(runFocusRect(st([]), rc([])) === null, "runFocusRect: an empty overlay never moves the camera");
    assert(
      runFocusRect(st([["a", "untouched"], ["b", "unknown"]]), rc([["a", box(0, 0)], ["b", box(400, 0)]])) === null,
      "runFocusRect: untouched and unchecked nodes never pull the camera — an all-unknown trace returns null"
    );
    assert(
      runFocusRect(st([["a", "touched"]]), rc([["b", box(0, 0)]])) === null,
      "runFocusRect: a reached node the map has not measured yet returns null (the caller retries next render)"
    );

    /* The union of the reached nodes, ignoring the ones that did not run. */
    const spread = runFocusRect(
      st([["a", "touched"], ["b", "warning"], ["c", "untouched"]]),
      rc([["a", box(100, 100)], ["b", box(500, 300)], ["c", box(9000, 9000)]])
    );
    assert(spread != null && spread.rect.x === 100 && spread.rect.y === 100, "runFocusRect: the frame starts at the top-left of the reached nodes");
    assert(spread!.rect.w === 600 && spread!.rect.h === 260, "runFocusRect: the frame spans the reached nodes only — the untouched node is outside it");
    assert(spread!.focusId === null && spread!.count === 2, "runFocusRect: with no failure the whole path is framed and nothing is singled out");

    /* Bounds: never tighter than 1:1, never past the map's own floor. */
    assert(spread!.maxZoom === RUN_FOCUS_MAX_ZOOM && RUN_FOCUS_MAX_ZOOM === 1, "runFocusRect: never zooms past 1:1 — a short run reads as centred, not filled");
    assert(spread!.minZoom === ZOOM_MIN, "runFocusRect: clamps to the map's own zoom floor");

    /* One reached node is centred at the same bounds, not blown up. */
    const single = runFocusRect(st([["a", "touched"]]), rc([["a", box(40, 40)]]));
    assert(single != null && single.count === 1 && single.rect.w === 200 && single.rect.h === 60, "runFocusRect: a single reached node frames that node");
    assert(single!.maxZoom === 1 && single!.padding > 0, "runFocusRect: a single node still caps at 1:1 with padding around it");

    /* A failure inside the spread limit: the whole path, failure included. */
    const withinLimit = runFocusRect(
      st([["a", "touched"], ["b", "failed"]]),
      rc([["a", box(0, 0)], ["b", box(600, 0)]])
    );
    assert(withinLimit!.focusId === null && withinLimit!.rect.w === 800, "runFocusRect: a compact run with a failure is framed whole — the failure is already inside it");

    /* A failure in a sprawling run: frame the failure, not the sprawl. */
    const far = runFocusRect(
      st([["a", "touched"], ["b", "failed"]]),
      rc([["a", box(0, 0)], ["b", box(RUN_FOCUS_SPREAD + 100, 0)]])
    );
    assert(far!.focusId === "b" && far!.rect.x === RUN_FOCUS_SPREAD + 100 && far!.rect.w === 200, "runFocusRect: past the spread limit a failed run frames the failure, not the whole path");

    /* Sprawl without a failure stays whole — there is nothing to single out. */
    const farOk = runFocusRect(
      st([["a", "touched"], ["b", "touched"]]),
      rc([["a", box(0, 0)], ["b", box(RUN_FOCUS_SPREAD + 100, 0)]])
    );
    assert(farOk!.focusId === null && farOk!.rect.w === RUN_FOCUS_SPREAD + 300, "runFocusRect: a sprawling run with no failure is still framed whole");
  }

  /* The terse replay banner reads "5/7 steps" off the same tally the sentence words. */
  const counts = runCounts(PROTOTYPE_TRACE);
  assert(counts.total === 7 && counts.reached === 5 && counts.failed === 1 && counts.warned === 0, "runCounts is the tally behind runSummary: 5 reached of 7, 1 failed, 0 warned");
  /* Normalisation: `touched` + status error is `failed`; a viewed step the trace does not list is `unknown` (so is its route). */
  const alt: ExecutionTrace = { ...PROTOTYPE_TRACE, nodes: PROTOTYPE_TRACE.nodes.filter((n) => n.nodeId !== "6").map((n) => (n.nodeId === "4" ? { ...n, state: "touched" } : n)) };
  const s2 = runStates(m, key, alt);
  assert(s2.get(id("4")) === "failed" && s2.get(id("6")) === "unknown" && s2.get(no.id) === "unknown", "`touched` + status error collapses to `failed`; an unlisted viewed step is `unknown`, and so is its route");
  const warn: ExecutionTrace = { ...PROTOTYPE_TRACE, nodes: PROTOTYPE_TRACE.nodes.map((n) => (n.nodeId === "7" ? { ...n, status: "warning", warning: "Retried once" } : n)) };
  assert(runStates(m, key, warn).get(id("7")) === "warning" && runStates(m, key, warn).get("wf:make:912/m:7/wf:make:913") === "reached" && runSummary(warn) === "5 of 7 steps reached · 1 failed · 1 with a warning", "a warning module is `warning`, still counts as reached, and its pill is still `reached`");
  const cold: ExecutionTrace = { ...PROTOTYPE_TRACE, nodes: PROTOTYPE_TRACE.nodes.map((n) => (n.nodeId === "7" ? { ...n, state: "untouched", status: null } : n)) };
  assert(runStates(m, key, cold).get("wf:make:912/m:7/wf:make:913") === "untouched", "a pill under an untouched calling step is `untouched` (grayed with it)");
  assert(runStates(m, key, null).size === 0 && runStates(m, key, { ...PROTOTYPE_TRACE, supported: false }).size === 0, "no trace, or an unsupported one, gives no states at all");
  /* The empty overlay is the old map: nothing stated, nothing dimmed, nothing ringed — the triage layer is invisible until a run is replayed. */
  const none = runStates(m, key, undefined);
  assert(none.size === 0 && dimNodeIds(none).size === 0 && failedNodeIds(none).size === 0 && m.flat.every((n) => !none.has(n.id)), "with no run replayed the overlay is empty: no node state, no dimmed ids, no failed ids");
  /* The plain prototype (module 7 absent, no attached pill) overlays the same trace. */
  const pm = buildMap({ ...base, expanded: {} });
  const ps = runStates(pm, key, PROTOTYPE_TRACE);
  const pid = (stepId: string) => pm.byStep.get(`${key}:${stepId}`)!.id;
  assert(pm.flat.filter((n) => n.kind === "step" && n.stepRef?.key === key).every((n) => ps.has(n.id)) && ps.get(pid("4")) === "failed" && ps.get(pid("6")) === "untouched" && ps.size === 8, "the trace also overlays the plain prototype: 6 steps + 2 routes stated, module 7 ignored");
}

/* ── related traces (run.ts): PROTOTYPE_RELATED_TRACE over the make:913 pill attached under module 7 ── */
{
  const f = PROTOTYPE_RUN;
  const key = keyOf(f.viewed);
  const sameStates = (a: ReadonlyMap<string, RunState>, b: ReadonlyMap<string, RunState>) => a.size === b.size && [...a].every(([id, s]) => b.get(id) === s);
  const pillId = "wf:make:912/m:7/wf:make:913";
  /* Unfolded: the callee's two steps render under the pill. */
  const m = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: { "wf:ghl:pcf-a": true, [pillId]: true }, query: "", now: PROTOTYPE_NOW });
  const s1 = m.byStep.get("make:913:1")!;
  const s2 = m.byStep.get("make:913:2")!;
  assert(s1.parentId === pillId && s2.stepRef?.key === "make:913", "the unfolded make:913 pill renders its webhook and sheet steps");
  const alone = runStates(m, key, PROTOTYPE_TRACE);
  assert(!alone.has(s1.id) && !alone.has(s2.id) && alone.get(pillId) === "reached", "without a related trace the callee's steps carry no state and its pill is `reached` through the calling step");
  const related: RelatedTraces = new Map([["make:913", PROTOTYPE_RELATED_TRACE]]);
  const both = runStates(m, key, PROTOTYPE_TRACE, related);
  assert(both.get(s1.id) === "touched" && both.get(s2.id) === "failed" && both.get(pillId) === "reached", "a related trace colours the attached pill's steps (webhook touched, sheet step failed) and keeps the pill `reached`");
  assert([...alone].every(([id, s]) => both.get(id) === s) && both.size === alone.size + 2, "the viewed workflow's states are untouched by the related overlay — only the callee's two steps are added");
  assert(failedNodeIds(both).size === 2 && failedNodeIds(both).has(s2.id) && dimNodeIds(both).size === dimNodeIds(alone).size, "failedNodeIds gains the related failed step; nothing else dims");
  assert(runSummary(PROTOTYPE_TRACE) === "5 of 7 steps reached · 1 failed", "runSummary stays per viewed workflow — the related run never folds into its counts");
  /* A related trace for a workflow that is not on the map is ignored, as is one for the viewed workflow itself. */
  const offMap: RelatedTraces = new Map([["make:999", PROTOTYPE_RELATED_TRACE], ["make:912", PROTOTYPE_RELATED_TRACE]]);
  assert(sameStates(runStates(m, key, PROTOTYPE_TRACE, offMap), alone), "a related trace for a workflow not on the map (or for the viewed one) changes nothing");
  /* No related traces at all — empty map, null, absent — is today's output. */
  assert(sameStates(runStates(m, key, PROTOTYPE_TRACE, new Map()), alone) && sameStates(runStates(m, key, PROTOTYPE_TRACE, null), alone), "no related traces → identical to the single-trace overlay");
  /* An unsupported related trace is ignored; a folded pill still reads `reached` from its own run even when the calling step never ran. */
  assert(sameStates(runStates(m, key, PROTOTYPE_TRACE, new Map([["make:913", { ...PROTOTYPE_RELATED_TRACE, supported: false }]])), alone), "an unsupported related trace is ignored");
  const cold: ExecutionTrace = { ...PROTOTYPE_TRACE, nodes: PROTOTYPE_TRACE.nodes.map((n) => (n.nodeId === "7" ? { ...n, state: "untouched", status: null } : n)) };
  const folded = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: {}, query: "", now: PROTOTYPE_NOW });
  assert(runStates(folded, key, cold).get(pillId) === "untouched" && runStates(folded, key, cold, related).get(pillId) === "reached", "a pill whose own run is traced is `reached` even under an untouched calling step (the run happened); without the trace it grays with the step");
  /* Other pills — the viewed root, the callers, a caller's target — still carry no state. */
  assert(m.byId.has("wf:ghl:pcf-a/m:hook/wf:make:913") && !both.has("wf:make:912") && m.callers.every((c) => !both.has(c.id)) && !both.has("wf:ghl:pcf-a/m:hook/wf:make:913"), "the related overlay adds no state to the viewed root, the callers, or Live A's own call to the related workflow");
}

/* ── projection overlay (projection/overlay.ts): PROTOTYPE_PROJECTION ──
   The engine's output is shaped as an ExecutionTrace precisely so the canvas
   needs no second code path. These assertions are what stops that drifting. */
{
  const f = PROTOTYPE_RUN;
  const key = keyOf(f.viewed);
  const m = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: { "wf:ghl:pcf-a": true }, query: "", now: PROTOTYPE_NOW });
  const asTrace = projectionAsTrace(PROTOTYPE_PROJECTION);
  const states = runStates(m, key, asTrace);
  const of = (stepId: string): RunState | null => states.get(m.byStep.get(`${key}:${stepId}`)!.id) ?? null;

  assert(of("1") === "touched" && of("3") === "touched", "a projection lights the path it would take through the same overlay as a recorded run");
  assert(of("4") === "untouched", "a step whose gate evaluated false is untouched — greyed, not failed");
  assert(of("5") === "unknown", "a step whose gate could not be evaluated is unknown, never untouched");
  assert(failedNodeIds(states).size === 0, "a projection never produces a failed node: `failed` means a run happened");
  assert(asTrace.nodes.every((n) => n.status === null), "every projected node carries a null status — success and failure are recorded-run words");
  assert(asTrace.entry === null && asTrace.related.length === 0, "a projection offers no recorded input and claims no related run");
  assert(dimNodeIds(states).size >= 2, "untouched and unknown steps dim under a projection exactly as under a run");
}

/* The captured workflow's one multi-step tile is a pair — the two lookups —
   and a pair never packs. The tile cases use the same response with that tile
   reaching one step further, to PACK_AT. */
const COLLAPSE_TILE3: ReadonlyMap<WorkflowKey, typeof COLLAPSE_SHAPES> = new Map([
  [
    keyOf(COLLAPSE_VIEWED) as WorkflowKey,
    {
      ...COLLAPSE_SHAPES,
      elements: COLLAPSE_SHAPES.elements.flatMap((e) => (e.kind !== "tile" ? [e] : e.nodeIds.join() === "p5,p6" ? [{ ...e, nodeIds: [...e.nodeIds, "p7"] }] : e.nodeIds.join() === "p7" ? [] : [e])),
    },
  ],
]);

/* ── the 119-step GoHighLevel workflow, drawn the way its editor draws it ─
   Nine head tiles and a nine-outcome router. Every outcome is its own card,
   side by side, named for itself — the way GoHighLevel's own editor shows a
   branch, and the founder's explicit direction: reaching `Canceled` must
   never mean clicking a pill under a card called `No-Showed`. Each card folds
   its own arm, so the canvas still lands on the workflow's shape.

   Folding is a MODEL operation: withheld steps never reach `flat`, `byId`,
   the pairs or the DOM, so tab order, edges, the LITE threshold and the
   layout weights all describe what is actually drawn. */
{
  const key = keyOf(COLLAPSE_VIEWED) as WorkflowKey;
  const base = { viewed: COLLAPSE_VIEWED, linkMap: COLLAPSE.linkMap, summaries: COLLAPSE.summaries, query: "", now: PROTOTYPE_NOW, shapes: COLLAPSE_SHAPE_MAP };
  const at = (m: ReturnType<typeof buildMap>, stepId: string) => m.byId.get(`wf:${key}/m:${stepId}`);
  const bandOf = (m: ReturnType<typeof buildMap>) => at(m, "p10")?.children ?? [];
  const cards = (m: ReturnType<typeof buildMap>) => m.flat.filter((n) => !n.pill);
  /** The steps the element tree says one arm member stands for, at any depth. */
  const memberOf = (head: string): string[] => {
    const find = (els: readonly ShapeElement[]): string[] | null => {
      for (const e of els) {
        const hit = e.members?.find((mm) => String(mm.id) === head);
        if (hit) return hit.nodeIds.map(String);
        const deeper = find(e.children ?? []);
        if (deeper) return deeper;
      }
      return null;
    };
    return find(COLLAPSE_SHAPES.elements) ?? [];
  };

  assert(COLLAPSE_SUMMARY.modules.length === 119, "the fixture is the measured workflow: 119 steps");

  const full = buildMap({ ...base, expanded: {}, layer: "steps" });
  assert(full.counts.rendered === 137 && full.counts.folded === 0 && full.counts.withheld === 0, "Steps draws all 119 steps and their 17 routes — 137 nodes, nothing withheld");

  /* Structure is the default, at every size. */
  const m = buildMap({ ...base, expanded: {} });
  assert(cards(m).length === 20 && m.counts.withheld === 108, "Structure draws 20 elements — the ten head steps, nine branch cards and the one step of the branch too small to fold — standing for 108 withheld steps");
  assert(m.counts.rendered === m.flat.length && m.counts.rendered * 6 < full.counts.rendered, "the scale heuristics (LITE_AT, ROOT_WINDOW_AT) read what is drawn, not the 137 it stands for — the reason folding is a model operation and not a display:none");
  assert(LITE_AT > m.counts.rendered, "so a workflow this size keeps its stagger and gliding instead of dropping them for nodes nobody drew");
  assert(m.flat.every((n) => m.byId.get(n.id) === n), "every node in `flat` is in `byId`: tabTarget can never point at something unrendered");
  assert(m.pairs.every((p) => m.byId.has(p.from) && m.byId.has(p.to)), "every edge pair has both ends rendered — nothing routes to a 0x0 box");

  /* A pair is two cards. Found by the founder on this workflow: the lookup
     and the setter after it read "2 steps", and pressing that expanded the
     whole workflow. Two steps are taken in at a glance; a card standing for
     them only costs a press. */
  const head = cards(m).slice(0, 10);
  assert(head.length === 10 && head.every((n) => n.kind === "step" && !n.pack), "the run-in is its ten steps, none of them standing for another");
  assert(head[4].name === "Look up closer Slack ID" && head[5].name === "Look up setter Slack ID" && m.byStep.has(`${key}:p6`) && !m.hiddenSteps.has(`${key}:p6`), "a two-step tile does not pack: the lookup and its setter are two cards, and neither holds the other");
  assert([...m.hiddenSteps.values()].every((r) => r !== layerReveal("steps")), "nothing anywhere is revealed by dropping to the finest rung: 'show me this step' is never answered by expanding the whole workflow");

  /* From PACK_AT steps a tile is one card, and it opens in place. */
  const shut = buildMap({ ...base, shapes: COLLAPSE_TILE3, expanded: {} });
  const tile = shut.flat.find((n) => n.pack)!;
  assert(PACK_AT === 3 && tile?.name === "Look up closer Slack ID" && tile.pack?.steps === 3 && tile.pack.lastId === "p7" && tile.pack.inPlace === true && tile.pack.open === false, "a three-step tile packs: one card saying 3 steps, which opens in place");
  assert(!shut.byStep.has(`${key}:p6`) && shut.hiddenSteps.get(`${key}:p6`) === armKey(key, "p5") && shut.hiddenSteps.get(`${key}:p7`) === armKey(key, "p5"), "the steps after it are held behind that card — a link to one opens that tile, never the whole workflow");
  assert(shut.pairs.some((p) => p.from === tile.id && shut.byId.get(p.to)?.stepRef?.stepId === "p8"), "and shut, the card connects straight to what the tile led to");
  const opened3 = buildMap({ ...base, shapes: COLLAPSE_TILE3, expanded: { [armKey(key, "p5")]: true } });
  const openTile = opened3.byId.get(tile.id)!;
  assert(openTile.pack?.open === true && openTile.pack.inPlace === true && opened3.flat.filter((n) => n.pack).length === 1, "an opened tile is still one card, and says it is open — its cap shows filled and folds the steps back");
  assert(opened3.byStep.has(`${key}:p6`) && opened3.byStep.has(`${key}:p7`) && !opened3.hiddenSteps.has(`${key}:p6`) && !opened3.hiddenSteps.has(`${key}:p7`), "with its steps drawn after it");
  assert(packedSteps(opened3, openTile).map((s) => s.stepRef?.stepId).join() === "p6,p7" && packedSteps(shut, tile).length === 0, "and the map can name exactly those steps — what folding it again takes away, so a selection among them returns to the card");
  assert(opened3.pairs.some((p) => p.from === tile.id && opened3.byId.get(p.to)?.stepRef?.stepId === "p6") && !opened3.pairs.some((p) => p.from === tile.id && opened3.byId.get(p.to)?.stepRef?.stepId === "p8"), "and the chain runs through them again instead of bridging past them");
  assert(opened3.counts.folded === shut.counts.folded && bandOf(opened3).every((c) => !c.fold?.open), "opening a tile opens nothing else");

  /* THE RULE: every arm of a fan-out is its own card. */
  const band = bandOf(m);
  assert(bandOf(full).length === 9 && band.length === 9, "the router has nine arms, and Structure draws nine cards — one per outcome, never fewer");
  assert(band.map((c) => c.name).join(" | ") === "No-Showed | Canceled | Reschedule | Payment = No | Passed to Setter | Fake or Duplicate | Payment = Yes | Paste-Values Only Placeholder | None", "each card is named for its own branch, alone, in the platform's own order");
  assert(band.every((c) => !c.fold || (c.fold.scope === "arm" && c.fold.count === 1 && c.fold.members.length === 0)), "no branch card stands for its siblings: every folded card covers exactly one arm and carries no member chips");
  assert(band.map((c) => c.fold?.steps ?? "drawn").join(",") === "12,12,12,12,10,10,36,4,drawn", "and each says how many steps ITS OWN arm has — four arms of 12 are four cards of 12, not one card claiming 48 — while the one-step None is simply drawn");
  assert(band.filter((c) => c.fold).every((c) => !c.fold?.open && c.children.length === 0 && c.descendants === 0), "every arm big enough to fold lands folded, with no weight: eight one-row cards, never a 101-node band");
  assert(band[8].name === "None" && !band[8].fold && band[8].children.length === 1 && !m.hiddenSteps.has(`${key}:i1`), `a branch under FOLD_AT (${FOLD_AT}) steps is never folded: None draws its one step, behind no card and held by nothing`);
  assert(new Set(COLLAPSE_SHAPES.elements.flatMap((e) => (e.kind === "fan" ? e.children ?? [] : [])).map((a) => a.signature?.hash)).size === 5, "the arms still have five distinct shapes — that grouping still exists, and the Overview counts it; it just is not how a branch is drawn");

  /* No synthetic nodes: a branch card is a route that already existed. */
  assert([...m.byId.keys()].every((id) => full.byId.has(id)), "grouping invents no id — every node drawn folded is one of the nodes drawn in full");
  assert(band[0].kind === "route" && band[0].stepRef?.stepId === "p10" && full.byId.get(band[0].id)?.stepRef?.stepId === "p10", "a branch card IS the route node, pointing at the router step exactly as in Steps: the sidebar payload is identical by construction");

  /* Opening a branch draws ALL of it. The founder's pick: one press on
     No-Showed shows the whole branch, the smaller branches inside it
     included, rather than a card for every level. `expanded` is tri-state
     per card — the reader's `true`, the reader's `false`, or absent, which
     under a card the reader opened means open. */
  const opened = buildMap({ ...base, expanded: { [armKey(key, "A1")]: true } });
  assert(bandOf(opened).length === 9 && bandOf(opened)[0].fold?.open === true && bandOf(opened)[0].children.length > 0, "opening No-Showed draws its steps — the other eight branches stay exactly as they were");
  const nestedA = opened.flat.filter((n) => n.fold && n.depth > band[0].depth);
  assert(nestedA.map((n) => n.fold!.armId).sort().join() === "An1,Ay1" && nestedA.every((n) => n.fold!.open), "a nested arm opens with its parent: both arms of the two-way branch inside No-Showed are drawn open");
  assert(memberOf("A1").every((s) => opened.byStep.has(`${key}:${s}`)) && ![...opened.hiddenSteps.keys()].some((k) => memberOf("A1").some((s) => k === `${key}:${s}`)), "one press shows the whole branch: every step No-Showed stands for is drawn, and none is held");
  assert(buildMap({ ...base, shapes: null, expanded: { [armKey(key, "A1")]: true } }).flat.filter((n) => n.fold && n.depth > band[0].depth).every((n) => n.fold!.open), "the graph fallback opens nested arms with their parent the same way");

  /* The reader's own fold inside it is kept. */
  const foldedInside = buildMap({ ...base, expanded: { [armKey(key, "A1")]: true, [armKey(key, "Ay1")]: false } });
  const armCard = (m: ReturnType<typeof buildMap>, head: string) => m.flat.find((n) => n.fold?.armId === head);
  assert(armCard(foldedInside, "Ay1")?.fold?.open === false && armCard(foldedInside, "An1")?.fold?.open === true && foldedInside.hiddenSteps.get(`${key}:${memberOf("Ay1")[1]}`) === armKey(key, "Ay1"), "folding a nested branch is the reader's own `false`: that branch folds and its sibling stays open");
  /* Folding No-Showed sets only its own key, so the reader's `false` inside
     it is still there when it opens again — which is `foldedInside` above. */
  const refolded = buildMap({ ...base, expanded: { [armKey(key, "A1")]: false, [armKey(key, "Ay1")]: false } });
  assert(armCard(refolded, "A1")?.fold?.open === false && !armCard(refolded, "Ay1") && refolded.hiddenSteps.get(`${key}:${memberOf("Ay1")[1]}`) === armKey(key, "A1"), "and it survives folding No-Showed: shut, the parent holds everything, and reopening it brings the nested fold back exactly as the reader left it");

  /* A sibling arm opens with its OWN steps. The element tree only recurses
     into a group's representative, so a sibling borrows that tree by position
     — and it must land on its own ids, never on the representative's. */
  const canceled = buildMap({ ...base, expanded: { [armKey(key, "B1")]: true } });
  assert(canceled.byStep.has(`${key}:B3`) && !canceled.byStep.has(`${key}:A3`), "opening Canceled draws Canceled's steps, not No-Showed's");
  const nestedB = canceled.flat.filter((n) => n.fold && n.depth > band[0].depth).map((n) => n.fold!.armId).sort().join(",");
  assert(nestedB === "Bn1,By1" && canceled.flat.filter((n) => n.fold && n.depth > band[0].depth).every((n) => n.fold!.open), "and opens Canceled's own nested branches with it — the borrowed tree is carried across to B's ids, not applied to A's");

  /* A link names a step; the map opens itself, one card per rebuild. */
  const hop = (want: string, from: Layer = "structure") => hopTo(base, key, want, from);
  const nested = hop("Ay4");
  assert(nested.hops === 1 && nested.trail.join() === armKey(key, "A1"), "a ?step= deep inside a folded branch converges in one rebuild: opening No-Showed opens the branch inside it too, and nothing else");
  assert(nested.drawn.every((c, i) => i === 0 || c > nested.drawn[i - 1]), "each hop draws strictly more, which is why it converges");
  assert(hop("Cy3").trail.join(" → ") === armKey(key, "C1"), "and into a sibling arm's nested branch it opens that arm's own card, which opens the rest of it");
  assert(hop("B1").hops === 1 && hop("B1").trail[0] === armKey(key, "B1"), "a link to the FIRST step of a branch resolves — the one step of an arm not drawn as a step card is still held, never reported missing");
  assert(!m.byStep.has(`${key}:nope`) && !m.hiddenSteps.has(`${key}:nope`), "a step this workflow does not have is in neither map — the host says so instead of the link doing nothing");

  /* Every step is drawn or held — the invariant behind every case above. */
  for (const layer of ["macro", "structure"] as Layer[])
    for (const shapes of [COLLAPSE_SHAPE_MAP, null]) {
      const mm = buildMap({ ...base, shapes, expanded: {}, layer });
      const orphans = COLLAPSE_SUMMARY.modules.filter((mod) => !mm.byStep.has(`${key}:${mod.id}`) && !mm.hiddenSteps.has(`${key}:${mod.id}`));
      assert(orphans.length === 0, `every step is drawn or held (${layer}, ${shapes ? "served" : "graph"}): a step in neither map is one a link falsely reports missing`);
    }

  /* Fold state is view state, and Collapse all / Expand all own it. */
  const allKeys = expandAllSnapshot(m, {});
  const all = buildMap({ ...base, expanded: allKeys });
  assert(Object.keys(allKeys).every((k) => m.flat.some((n) => n.fold && n.stepRef && armKey(n.stepRef.key, n.fold.armId) === k)), "Expand all is still one snapshot of the cards on screen — it names no card that is not drawn");
  assert(all.counts.rendered === full.counts.rendered && all.counts.folded === 0, "and each branch it opens opens whole, the same rule as a press — here that is the whole workflow");
  assert(buildMap({ ...base, expanded: {} }).counts.rendered === m.counts.rendered, "Collapse all ({}) puts every arm back");

  const found = buildMap({ ...base, expanded: {}, query: "Setter assigned" });
  assert(found.counts.folded === 0 && found.byStep.has(`${key}:A3`), "a filter unfolds every arm, so a step inside a folded branch is still findable");

  const a = buildMap({ ...base, expanded: {} });
  const b = buildMap({ ...base, expanded: {} });
  assert(a.flat.map((n) => n.id).join("|") === b.flat.map((n) => n.id).join("|") && a.counts.withheld === b.counts.withheld, "folding is deterministic: the same workflow folds the same way every time");
}

/* ── the two fold plans, and the gap between them ────────────────────────
   The element tree is the plan; the graph walk is what happens when it has
   not arrived. They are deliberately not equal — the fallback is coarser —
   and the point of these is that the coarser one is still correct. */
{
  const key = keyOf(COLLAPSE_VIEWED) as WorkflowKey;
  const base = { viewed: COLLAPSE_VIEWED, linkMap: COLLAPSE.linkMap, summaries: COLLAPSE.summaries, query: "", now: PROTOTYPE_NOW, expanded: {} };
  const served = buildMap({ ...base, shapes: COLLAPSE_SHAPE_MAP });
  const alone = buildMap({ ...base, shapes: null });

  assert(served.counts.rendered === 21 && alone.counts.rendered === 21 && served.flat.every((n) => alone.byId.has(n.id)), "the two plans share both floors, so with no tile of PACK_AT steps they draw the same 21 nodes");
  assert(alone.counts.withheld > 0 && alone.flat.some((n) => n.fold), "the fallback still folds arms, so a slow or absent endpoint costs detail and never the canvas");
  assert([served, alone].every((mm) => mm.flat.every((n) => !n.fold || n.fold.scope !== "arm" || n.fold.count === 1)), "and on either plan a branch card stands for one arm only — the element tree changes what is packed, never whether siblings merge");
  const tiled = buildMap({ ...base, shapes: COLLAPSE_TILE3 });
  assert(tiled.flat.filter((n) => n.pack).length === 1 && tiled.counts.rendered === 19 && alone.flat.every((n) => !n.pack), "what the tree adds at Structure is tiles: PACK_AT or more consecutive like steps as one card, which the graph alone cannot see — 19 nodes against its 21");
  const everything = buildMap({ ...base, shapes: null, layer: "steps" });
  assert(alone.flat.every((n) => everything.byId.has(n.id)) && served.flat.every((n) => everything.byId.has(n.id)), "neither plan invents a node: every id either draws is one the full canvas already has");

  /* The tree is read, not re-derived: each member of a group becomes its own
     card, and each card's size is that member's own span. */
  const tree = COLLAPSE_SHAPES.elements.find((e) => e.kind === "fan")!;
  const armEl = (tree.children ?? []).find((c) => c.count === 4)!;
  for (const mem of armEl.members!) {
    const card = served.flat.find((n) => n.fold?.armId === String(mem.id));
    assert(card?.fold?.steps === mem.count && card.fold.count === 1, `the ${mem.label} card's size is its own member's span (${mem.count}), read straight from the element tree`);
  }
  assert(armEl.nodeIds.every((nid) => served.hiddenSteps.has(`${key}:${String(nid)}`)), "every node the tree places behind those four arms is held, and the map can say which card holds it");
  assert(COLLAPSE_SHAPES.shapeVersion >= 5 && COLLAPSE_SHAPES.scope === "colocated", "the fixture is a captured response, not a hand-written one — it carries the algorithm's own version and scope");

  /* The fallback's own contract, at the function. Its one real hazard is a
     rejoin: two arms meeting again, where folding one must not withhold what
     the other still needs. */
  const rejoin: ScenarioSummary = {
    name: "rejoin",
    totalModules: 8,
    appsUsed: ["ghl"],
    modules: ["r", "a1", "a2", "a3", "b1", "b2", "b3", "tail"].map((mid) => ({ id: mid, module: "x", app: "ghl", label: mid, ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: mid === "r" ? "router" : "action" }) as ModuleInfo),
    connections: [
      { from: "r", to: "a1", kind: "branch", label: "left" },
      { from: "a1", to: "a2", kind: "sequence" },
      { from: "a2", to: "a3", kind: "sequence" },
      { from: "a3", to: "tail", kind: "sequence" },
      { from: "r", to: "b1", kind: "branch", label: "right" },
      { from: "b1", to: "b2", kind: "sequence" },
      { from: "b2", to: "b3", kind: "sequence" },
      { from: "b3", to: "tail", kind: "sequence" },
    ],
  };
  const rp = planFolds(rejoin, "ghl:rejoin" as WorkflowKey, {}, "structure", new Set());
  assert(rp.folds.get("a1")?.steps === 3 && rp.folds.get("b1")?.steps === 3, "on the graph alone each arm stands for its own three steps");
  assert(!rp.dropped.has("tail") && !rp.reveals.has("tail"), "the step both arms reach is never withheld by either — a fold hides only what nothing else needs");
  assert(planFolds({ ...rejoin, connections: rejoin.connections.slice(0, 2) }, "ghl:rejoin" as WorkflowKey, {}, "structure", new Set()).folds.size === 0, `on the graph alone an arm under FOLD_AT (${FOLD_AT}) is drawn — the fallback has no shape to fold it by, so it folds on size or not at all`);
  const rm = buildMap({ viewed: { source: "ghl", refId: "rejoin" }, linkMap: null, summaries: new Map([["ghl:rejoin" as WorkflowKey, { state: "ok", summary: rejoin } as SummaryEntry]]), expanded: {}, query: "", now: PROTOTYPE_NOW });
  assert(rm.byStep.has("ghl:rejoin:tail"), "so the shared tail is still on the canvas with both arms folded");

  /* The same floor on both plans. Found by the founder on a live workflow,
     where the element tree folded "Yes - Setter name" into a "2 steps" card
     that the graph walk would have drawn. */
  const pairArm: ScenarioSummary = {
    name: "pair-arm",
    totalModules: 6,
    appsUsed: ["ghl"],
    modules: ["r", "a1", "a2", "b1", "b2", "b3"].map((mid) => ({ id: mid, module: "x", app: "ghl", label: mid, ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: mid === "r" ? "router" : "action" }) as ModuleInfo),
    connections: [
      { from: "r", to: "a1", kind: "branch", label: "two" },
      { from: "a1", to: "a2", kind: "sequence" },
      { from: "r", to: "b1", kind: "branch", label: "three" },
      { from: "b1", to: "b2", kind: "sequence" },
      { from: "b2", to: "b3", kind: "sequence" },
    ],
  };
  const armOf = (ids: string[], label: string): ShapeElement => ({
    kind: "arm",
    target: "ghl",
    count: 1,
    depth: 1,
    nodeIds: ids,
    representative: ids[0],
    members: [{ id: ids[0], label, nodeIds: ids, count: ids.length }],
    children: ids.map((i) => ({ kind: "tile", target: "ghl", count: 1, depth: 1, nodeIds: [i] })),
  });
  const pairKey = "ghl:pair-arm" as WorkflowKey;
  const pairShapes: WorkflowShapes = {
    ...COLLAPSE_SHAPES,
    groups: [],
    nodeCount: 6,
    fanOutCount: 1,
    hiddenCount: 3,
    elements: [
      { kind: "tile", target: "ghl", count: 1, depth: 0, nodeIds: ["r"] },
      { kind: "fan", target: "ghl", count: 2, depth: 0, nodeIds: ["r"], children: [armOf(["a1", "a2"], "two"), armOf(["b1", "b2", "b3"], "three")] },
    ],
  };
  for (const shapes of [new Map([[pairKey, pairShapes]]), null]) {
    const pm = buildMap({ viewed: { source: "ghl", refId: "pair-arm" }, linkMap: null, summaries: new Map([[pairKey, { state: "ok", summary: pairArm } as SummaryEntry]]), expanded: {}, query: "", now: PROTOTYPE_NOW, shapes });
    const [two, three] = pm.byId.get(`wf:${pairKey}/m:r`)!.children;
    assert(!two.fold && pm.byStep.has(`${pairKey}:a2`) && !pm.hiddenSteps.has(`${pairKey}:a2`), `a 2-step arm never folds (${shapes ? "element tree" : "graph alone"}): both of its steps are drawn`);
    assert(three.fold?.steps === 3 && !three.fold.open && pm.hiddenSteps.get(`${pairKey}:b2`) === armKey(pairKey, "b1"), `while its 3-step sibling folds as before (${shapes ? "element tree" : "graph alone"})`);
  }

  /* A singleton arm is still one card: grouping needs two members, drawing
     does not. This is the term that made an earlier build miss by two. */
  const singles = (tree.children ?? []).filter((c) => c.count === 1);
  assert(singles.length === 3 && singles.some((c) => c.nodeIds.length === 1), "three of the nine outcomes are shapes that occur once, and one of them is a single step");
  assert(singles.every((c) => c.nodeIds.length < FOLD_AT || served.flat.some((n) => n.fold?.armId === String(c.members![0].id))), "each big enough to fold is its own card anyway: the floor counts an arm's own steps, never how often its shape occurs");
}

/* ── the ladder: macro, structure, steps ──────────────────────────────────
   Three rungs of description, climbed deliberately. The macro rung answers
   "what IS this workflow" in four elements by withholding most of it — that
   is the point of it, not a limitation — and every rung is a model
   operation, so nothing at any rung counts, measures or tab-stops on a node
   it is not drawing. */
{
  const key = keyOf(COLLAPSE_VIEWED) as WorkflowKey;
  const base = { viewed: COLLAPSE_VIEWED, linkMap: COLLAPSE.linkMap, summaries: COLLAPSE.summaries, query: "", now: PROTOTYPE_NOW, shapes: COLLAPSE_SHAPE_MAP, expanded: {} };
  const rung = (layer: Layer) => buildMap({ ...base, layer });
  const macro = rung("macro");
  const structure = rung("structure");
  const steps = rung("steps");
  const cards = (m: ReturnType<typeof buildMap>) => m.flat.filter((n) => !n.pill).map((n) => n.name);

  assert(cards(macro).length === 4 && cards(structure).length === 20 && cards(steps).length === 136, "the ladder measured on the 119-step workflow: 4 elements, 20, 136");
  assert(cards(macro).join(" · ") === "Survey submitted · Clear PCF fields · Appointment outcome? · 9 outcomes", "macro is four elements: what starts it, what it prepares, the decision, and everything past the decision");
  assert(macro.counts.withheld === 116 && macro.pairs.every((p) => macro.byId.has(p.from) && macro.byId.has(p.to)), "it stands for 116 withheld steps and every edge it draws has both ends on the canvas");

  /* A trigger keeps its own card; the run after it does not. */
  const packed = macro.flat.find((n) => n.pack)!;
  assert(packed.name === "Clear PCF fields" && packed.pack?.steps === 8 && packed.pack.lastId === "p9", "the run-in packs into its first step — 8 steps, ending where the decision begins");
  assert(packed.pack.inPlace === undefined && packed.pack.open === undefined, "a run pack is not a tile: its chip still descends to Structure, and nothing in `expanded` opens it in place");
  assert(macro.flat[1].name === "Survey submitted" && !macro.flat[1].pack, "the trigger is never packed into the run after it: what starts a workflow is the one question every platform answers the same way");
  const bridged = macro.pairs.find((p) => p.from === packed.id);
  assert(bridged && macro.byId.get(bridged.to)?.name === "Appointment outcome?" && bridged.anchor === "h", "and the packed card connects straight to what the run led to — one rail link, not a dangling stub");

  /* The whole fan-out as one element — a count and a variety, never a sameness. */
  const band = macro.flat.find((n) => n.fold?.scope === "band")!;
  assert(band.fold?.count === 9 && band.fold.patterns === 5 && band.fold.totalSteps === 109, "the band card stands for all nine outcomes, which the element tree says are five distinct shapes, over 109 steps");
  assert(band.name === "9 outcomes" && band.desc === "5 patterns · 109 steps", "so it says how many and how many shapes — it never claims the nine do the same thing");
  assert(band.children.length === 0 && band.descendants === 0, "and it carries no weight: the macro band lays out as one row, not as a 109-node one");

  /* Node identity across a rung change — what makes descending readable. */
  assert(band.id === structure.flat.find((n) => n.fold?.scope === "arm")!.id, "the macro card and Structure's first branch card are the SAME node: descending is eight branches appearing beside a card that stays put");
  assert(macro.flat.every((n) => structure.byId.has(n.id)) && structure.flat.every((n) => steps.byId.has(n.id)), "every card on a coarse rung exists on the finer one, with the same id — a rung invents nothing and renames nothing");
  assert(band.stepRef?.stepId === "p10" && steps.byId.get(band.id)?.stepRef?.stepId === "p10", "and it still points at the real router step, so its panel is the same at every rung");

  /* A link names a step; the map descends to it, one level at a time. */
  const hop = (want: string, from: Layer) => hopTo(base, key, want, from);
  assert(hop("p5", "macro").trail.join(" → ") === layerReveal("structure"), "a ?step= into a packed run descends one rung, and stops there");
  assert(hop("Ay4", "macro").trail.join(" → ") === `${layerReveal("structure")} → ${armKey(key, "A1")}`, "three levels down it takes two moves — the rung, then the branch's card, which opens whole. Never a jump to the whole workflow");
  assert(hop("B2", "macro").trail.join(" → ") === `${layerReveal("structure")} → ${armKey(key, "B1")}`, "and into a sibling branch: descend, then open that branch's own card — there is no group to pull it out of first");
  assert(hop("nope", "macro").hops === -1 && !macro.hiddenSteps.has(`${key}:nope`), "a step the workflow does not have is held by nothing at any rung — the host says so instead of the link doing nothing");
  assert(revealLayer(armKey(key, "A1")) === null && revealLayer(layerReveal("macro")) === "macro", "a reveal says plainly whether it is a rung or a card");

  /* Zoom is not the ladder. */
  assert(rung("macro").counts.rendered !== rung("structure").counts.rendered, "the rungs differ in what they draw…");
  assert(JSON.stringify(cards(rung("macro"))) === JSON.stringify(cards(macro)), "…and a rung is a pure function of the layer: nothing about the camera reaches the model, so zooming can never change what is shown");

  /* A query drops to the finest rung, whatever the reader was on. */
  const searched = buildMap({ ...base, layer: "macro", query: "Setter assigned" });
  assert(searched.byStep.has(`${key}:A3`) && searched.counts.withheld === 0, "a filter searches every step from any rung — nothing can hide from a query");
}

/* ── connections: drawn beside the step that makes them, or not at all ────
   Found by the founder on live data: five branches call one Make scenario,
   and the canvas showed ONE pill for it — beside whichever calling branch
   happened to be rendered first. Open a different branch and the pill jumped
   there; the branch it left showed no connection at all. A connection that
   appears and disappears with an unrelated branch's fold state is simply a
   wrong answer about the user's workflow.

   The rule now: a downstream workflow pill exists exactly beside a rendered
   step that calls it — one pill per call site, per distinct target — and
   nowhere else. Not on a folded card, not on the trigger, not under a folded
   workflow. */
{
  const key = keyOf(COLLAPSE_VIEWED) as WorkflowKey;
  const heads = ["A1", "B1", "C1", "D1", "e1", "f1", "g1", "h1", "i1"];
  const openAll = Object.fromEntries(heads.map((h) => [armKey(key, h), true]));
  const base = { viewed: COLLAPSE_VIEWED, linkMap: COLLAPSE_LINKED.linkMap, summaries: COLLAPSE_LINKED.summaries, query: "", now: PROTOTYPE_NOW, shapes: COLLAPSE_SHAPE_MAP };
  const pills = (m: ReturnType<typeof buildMap>) => m.flat.filter((n) => n.pill && n.parentId);
  const sites = (m: ReturnType<typeof buildMap>) =>
    pills(m).map((n) => `${n.ref!.refId}@${m.byId.get(n.parentId!)?.stepRef?.stepId}`).sort().join(" ");

  /* Every call site, open. */
  const open = buildMap({ ...base, expanded: openAll });
  assert(sites(open) === "912@A2 912@B2 912@C2 912@D2 913@e1 913@f1 914@p1 915@g5 916@p9", "with every branch open there is one pill per call site: make:912 beside all FOUR branches that call it, make:913 beside both — never one pill for the first caller");
  assert(pills(open).filter((n) => n.ref!.refId === "912").every((n, _i, all) => new Set(all.map((x) => x.id)).size === all.length), "four call sites are four distinct ids, keyed by the step that makes the call");
  assert(pills(open).find((n) => n.ref!.refId === "912")!.id === `wf:${key}/m:p10/route:p10:0/m:A2/wf:make:912`, "a pill's id is its calling step's id plus its target: path-based, so it survives its own branch opening and folding");

  /* Every call site, folded. */
  const folded = buildMap({ ...base, expanded: {} });
  assert(sites(folded) === "914@p1 916@p9", "with every branch folded only two pills remain: the trunk's own call, and the one link whose calling step does not exist");
  assert(folded.flat.filter((n) => n.fold && !n.fold.open).every((n) => n.children.length === 0), "no folded card carries a pill — what a branch connects to is part of that branch, and reads as such when it is opened");
  assert(!pills(folded).some((n) => ["912", "913", "915"].includes(n.ref!.refId)), "and a call made from inside a folded branch is nowhere on the canvas — not on its card, not on the trigger");

  /* The genuinely-missing step is the only thing the entry node still holds. */
  const entry = folded.byId.get(`wf:${key}/m:p1`)!;
  const orphan = entry.children.find((c) => c.ref?.refId === "914")!;
  assert(orphan?.pill?.unresolvedStep === true && orphan.desc.includes("calling step not captured"), "a link whose calling step is not in the workflow still hangs off the entry, and still says so");
  assert(pills(open).filter((n) => n.pill?.unresolvedStep).map((n) => n.ref!.refId).join(",") === "914", "and it is the ONLY pill that ever claims that — a step that exists and is merely folded never does");

  /* A pill never depends on a sibling branch. */
  const aOnly = buildMap({ ...base, expanded: { [armKey(key, "A1")]: true } });
  const aAndB = buildMap({ ...base, expanded: { [armKey(key, "A1")]: true, [armKey(key, "B1")]: true } });
  /* Keyed by No-Showed's route: every pill inside that branch lives under it. */
  const underA = (m: ReturnType<typeof buildMap>) => pills(m).filter((n) => n.id.includes("/route:p10:0/")).map((n) => n.id).join(",");
  assert(underA(aOnly) !== "" && underA(aOnly) === underA(aAndB) && underA(aAndB) === underA(open), "No-Showed's connections are identical whether Canceled is folded, open, or every other branch is open — the founder's exact failure");
  assert(sites(aAndB) === "912@A2 912@B2 914@p1 916@p9", "opening Canceled adds Canceled's own pill beside it, and moves nobody else's");

  /* A pill keeps its id across its own branch folding and reopening. */
  const reopened = buildMap({ ...base, expanded: { [armKey(key, "A1")]: true } });
  assert(underA(reopened) === underA(aOnly), "fold No-Showed and reopen it: the same pill comes back with the same id, so a selection or an expanded pill survives");

  /* A call from an arm's own first step — the step its folded card stands for. */
  const eOpen = buildMap({ ...base, expanded: { [armKey(key, "e1")]: true } });
  assert(sites(eOpen).includes("913@e1") && !sites(folded).includes("913@e1"), "a call from the first step of a branch appears when that branch opens, beside that step, and not before");

  /* Macro draws no branch at all, so it draws none of their calls. */
  const macro = buildMap({ ...base, expanded: openAll, layer: "macro" });
  assert(sites(macro) === "914@p1 916@p9", "the Overview withholds every branch, so it carries only the trunk's call and the unresolved one — whatever the branches were left as below it");

  /* The graph fallback agrees exactly. */
  assert(sites(buildMap({ ...base, shapes: null, expanded: openAll })) === sites(open) && sites(buildMap({ ...base, shapes: null, expanded: {} })) === sites(folded), "the graph fallback produces the identical set of call sites, open and folded");

  /* A scenario called from several steps is several pills, but drawn open at one. */
  const scenarioSummaries = new Map([...COLLAPSE_LINKED.summaries, ["make:912" as WorkflowKey, { state: "ok", summary: SCENARIO } as SummaryEntry]]);
  const pillAt = (step: string) => `wf:${key}/m:p10/route:p10:${"ABCD".indexOf(step[0])}/m:${step}/wf:make:912`;
  const both = buildMap({ ...base, summaries: scenarioSummaries, expanded: { ...openAll, [pillAt("A2")]: true, [pillAt("B2")]: true } });
  assert(both.flat.filter((n) => n.ref?.refId === "912" && n.pill?.open).length === 1, "asked to open make:912 at two call sites, the map draws its steps once — a 102-module scenario repeated five times would be illegible on its own");
  assert(both.flat.filter((n) => n.ref?.refId === "912" && n.pill).length === 4, "…while all four pills stay: the connection is never hidden to keep the map small");
  assert(both.byId.get(pillAt("A2"))?.pill?.open === true && both.byId.get(pillAt("B2"))?.pill?.open === false, "and when state asks for several, the first in build order is the one drawn — deterministic, and WorkflowMap makes a click move it");

  /* Unique ids everywhere — a duplicate would silently overwrite in byId. */
  for (const mm of [open, folded, aAndB, both]) assert(mm.flat.length === mm.byId.size, "no two nodes share an id: every pill is its own node, so none can overwrite another in byId");

  /* Every other copy says where the open one is — a persistent mark, not a
     passing cue, because the reader who notices a copy closed is usually
     someone scrolling back ten seconds later, not someone watching it go. */
  const copyAt = (mm: ReturnType<typeof buildMap>, step: string) => mm.flat.find((c) => c.ref?.refId === "912" && mm.byId.get(c.parentId!)?.stepRef?.stepId === step)!;
  /* The label is the same shut or open, so the open copy is marked here from its state. */
  const chips = (mm: ReturnType<typeof buildMap>) => ["A2", "B2", "C2", "D2"].map((st) => `${st}:${copyAt(mm, st) ? `${pillChip(copyAt(mm, st))}${copyAt(mm, st).pill?.open ? " (open)" : ""}` : "—"}`).join(" ");
  const build = (e: Record<string, boolean>) => buildMap({ ...base, summaries: scenarioSummaries, expanded: e });

  let state: Record<string, boolean> = { ...openAll };
  const none = build(state);
  assert(chips(none) === "A2:6 modules B2:6 modules C2:6 modules D2:6 modules", "with no copy open, every copy offers its modules");
  state = withPillOpen(state, copyAt(none, "A2"), true);
  const atA = build(state);
  assert(chips(atA) === "A2:6 modules (open) B2:↗ open in No-Showed C2:↗ open in No-Showed D2:↗ open in No-Showed", "open it in No-Showed and every other copy names where it is — by branch, the way a reader remembers where they left it");
  assert(copyAt(atA, "B2").pill!.openAt!.id === copyAt(atA, "A2").id, "and points at that exact copy by id");
  state = withPillOpen(state, copyAt(atA, "C2"), true);
  const atC = build(state);
  assert(chips(atC) === "A2:↗ open in Reschedule B2:↗ open in Reschedule C2:6 modules (open) D2:↗ open in Reschedule", "clicking a copy that reads 'open in No-Showed' opens it THERE — the latest request wins, and No-Showed's copy now names Reschedule");
  assert(atC.flat.filter((c) => c.ref?.refId === "912" && c.pill?.open).length === 1, "still exactly one copy open");
  state = withPillOpen(state, copyAt(atC, "C2"), false);
  assert(chips(build(state)) === "A2:6 modules B2:6 modules C2:6 modules D2:6 modules", "hide the open copy and every other resets to its plain count — no chip goes on naming a copy that is closed");
  state = { ...withPillOpen(state, copyAt(atC, "A2"), true), [armKey(key, "A1")]: false };
  const branchShut = build(state);
  assert(!copyAt(branchShut, "A2") && chips(branchShut) === "A2:— B2:6 modules C2:6 modules D2:6 modules", "fold the whole No-Showed BRANCH while its copy is open: the others reset too — a chip only ever names a copy that is actually drawn");
  const reopened2 = build({ ...state, [armKey(key, "A1")]: true });
  assert(chips(reopened2) === "A2:6 modules (open) B2:↗ open in No-Showed C2:↗ open in No-Showed D2:↗ open in No-Showed", "and reopen the branch: the copy comes back open with the same id, and the others name it again");
  const far = { ...copyAt(atA, "B2") };
  assert(pillChip(far)?.startsWith("↗") === true, "the far-zoom glyph for that state is ↗, the sibling of the existing ↺");

  /* "open in Canceled" is an offer to open it here, so only a copy that CAN
     open here makes it. A workflow with no step content cannot; forced open
     at one copy through raw state, the others keep saying what is wrong
     rather than offering a click that does nothing. */
  const stepless = new Map([...COLLAPSE_LINKED.summaries, ["make:912" as WorkflowKey, { state: "error", error: "not-captured", stepsUnavailable: true } as SummaryEntry]]);
  const forced = buildMap({ ...base, summaries: stepless, expanded: { ...openAll, [pillAt("A2")]: true } });
  const steplessCopies = forced.flat.filter((c) => c.ref?.refId === "912");
  assert(steplessCopies.length === 4 && steplessCopies.every((c) => !c.pill?.openAt), "a copy that cannot open here never offers to — no 'open in …' on a step-less workflow, whatever the other copies are doing");
  assert(steplessCopies.filter((c) => !c.pill?.open).every((c) => pillChip(c) === "steps unavailable"), "it goes on saying what is actually wrong with it instead");
}

/* ── no edge can outlive the nodes it joins ───────────────────────────────
   The measure hook silently skips a pair whose `rectOf` is null, which would
   leave that path holding its previous coordinates — a line frozen where the
   nodes used to be. So the model must never emit one. It cannot by
   construction: tree pairs are pushed during the walk, from a node that is
   being walked to a child about to be, and cross pairs are filtered against
   `byId` after it. This exercises that across every rung and every state a
   reader can put the canvas in. */
{
  const key = keyOf(COLLAPSE_VIEWED) as WorkflowKey;
  const seed = { viewed: COLLAPSE_VIEWED, linkMap: COLLAPSE_LINKED.linkMap, summaries: COLLAPSE_LINKED.summaries, now: PROTOTYPE_NOW };
  const states: Record<string, boolean>[] = [
    {},
    { [armKey(key, "A1")]: true },
    { [armKey(key, "C1")]: true },
    { [armKey(key, "A1")]: true, [armKey(key, "Ay1")]: true, [armKey(key, "B1")]: true, [armKey(key, "By1")]: true },
    { [armKey(key, "g1")]: true },
    /* A copy open, and state asking for two — the one-open-copy rule. */
    { ...Object.fromEntries(["A1", "B1", "C1", "D1"].map((h) => [armKey(key, h), true])), [`wf:${key}/m:p10/route:p10:0/m:A2/wf:make:912`]: true },
    { ...Object.fromEntries(["A1", "B1", "C1", "D1"].map((h) => [armKey(key, h), true])), [`wf:${key}/m:p10/route:p10:0/m:A2/wf:make:912`]: true, [`wf:${key}/m:p10/route:p10:2/m:C2/wf:make:912`]: true },
  ];
  /* What each step really calls, straight from the link map — the truth the
     canvas has to match, computed without going anywhere near the model. */
  const calls = new Map<string, Set<string>>();
  const known = new Set(COLLAPSE_SUMMARY.modules.map((mod) => String(mod.id)));
  const unresolvedTargets = new Set<string>();
  for (const l of COLLAPSE_LINKED.linkMap.links) {
    if (keyOf(l.from) !== key) continue;
    const sid = String(l.from.stepId);
    if (!known.has(sid)) unresolvedTargets.add(keyOf(l.to));
    else (calls.get(sid) ?? calls.set(sid, new Set()).get(sid)!).add(keyOf(l.to));
  }
  const entryStep = "p1";

  let checked = 0;
  for (const layer of ["macro", "structure", "steps"] as const)
    for (const shapes of [COLLAPSE_SHAPE_MAP, null])
      for (const query of ["", "Slack"]) {
        /* Per drawn calling step, its pill ids — compared across states below. */
        const bySiteAcrossStates = new Map<string, string>();
        for (const expanded of states) {
          const m = buildMap({ ...seed, shapes, layer, query, expanded });
          const where = `layer=${layer} shapes=${shapes ? "served" : "graph"} query=${query || "none"} state=${Object.keys(expanded).length}`;
          const dangling = m.pairs.filter((p) => !m.byId.has(p.from) || !m.byId.has(p.to));
          assert(dangling.length === 0, `no dangling pair: ${where}`);
          const orphanFlat = m.flat.filter((n) => n.parentId != null && !m.byId.has(n.parentId));
          assert(orphanFlat.length === 0, `every rendered node's parent is rendered too: ${where}`);

          /* Unique ids — a duplicate would silently overwrite in byId. */
          assert(m.flat.length === m.byId.size, `no two nodes share an id: ${where}`);

          /* Every drawn calling step carries exactly one pill per distinct
             target it calls — under a filter, never more than that. */
          let siteOk = true;
          for (const n of m.flat) {
            if (n.kind !== "step" || n.stepRef?.key !== key) continue;
            const expect = new Set(calls.get(n.stepRef.stepId) ?? []);
            if (n.stepRef.stepId === entryStep) for (const t of unresolvedTargets) expect.add(t);
            const got = n.children.filter((c) => c.pill).map((c) => keyOf(c.ref!));
            if (new Set(got).size !== got.length) siteOk = false;
            if (query ? got.some((t) => !expect.has(t)) : got.length !== expect.size || got.some((t) => !expect.has(t))) siteOk = false;
            if (!query && got.length) {
              const ids = n.children.filter((c) => c.pill).map((c) => c.id).sort().join(",");
              const prior = bySiteAcrossStates.get(n.stepRef.stepId);
              if (prior !== undefined && prior !== ids) siteOk = false;
              bySiteAcrossStates.set(n.stepRef.stepId, ids);
            }
          }
          assert(siteOk, `every drawn calling step carries exactly one pill per distinct target it calls, identical whatever its sibling branches are doing: ${where}`);

          /* Nothing hangs where no call is made. */
          const pillsHere = m.flat.filter((n) => n.pill && n.parentId);
          assert(
            pillsHere.every((pl) => {
              const parent = m.byId.get(pl.parentId!);
              if (parent?.kind !== "step" || parent.stepRef?.key !== key) return false;
              const t = keyOf(pl.ref!);
              return !!calls.get(parent.stepRef.stepId)?.has(t) || (parent.stepRef.stepId === entryStep && unresolvedTargets.has(t));
            }),
            `every pill sits beside a drawn step that really makes that call — none on a card, a trigger that does not call it, or a withheld caller: ${where}`,
          );
          assert(m.flat.every((n) => !(n.fold && !n.fold.open) || n.children.length === 0), `no folded card carries anything, pills included: ${where}`);

          /* The anchor contract, exactly as edge-fix builds against it. The
             viewed workflow: a rail link joins two cards of one row and always
             lands on a step; a drop leaves one of its steps for a pill hanging
             below. A connected workflow: the same links run down its column.
             A fan-out to its branches, a lane of its own, a pill beside a
             connected step, and cross pairs never carry one. */
          const node = (id: string) => m.byId.get(id)!;
          assert(
            m.pairs.every((pr) => {
              if (pr.kind !== "tree") return pr.anchor === undefined;
              const from = node(pr.from);
              const to = node(pr.to);
              const first = from.children.find((k) => k.kind === "step") === to;
              if (pr.anchor === "h") return flowsRight(from) && to.kind === "step" && (to.chained || first);
              if (pr.anchor === "v") return !flowsRight(from) && to.kind === "step" && (to.chained || (first && stacksChain(from)));
              if (pr.anchor === "drop") return flowsRight(from) && from.kind === "step" && !!to.pill;
              return to.kind === "route" || (!!to.pill && !flowsRight(from)) || (to.kind === "step" && (!first || (!flowsRight(from) && !stacksChain(from))));
            }),
            `every edge carries the anchor its place calls for — "h" along a row of the viewed workflow, "v" down a connected workflow's column, "drop" onto a pill below a main step, none for a branch, a lane of its own or a cross pair: ${where}`,
          );
          assert(m.flat.every((n) => !(n.pill && !n.pill.open) || n.children.length === 0), `no folded workflow pill carries a downstream pill: ${where}`);

          /* Exactly one copy of a workflow is open, and every other copy names
             it; with none open, no copy claims one is. */
          const copies = new Map<string, MapNode[]>();
          for (const n of m.flat) if (n.pill && n.ref && !n.pill.pinned) (copies.get(keyOf(n.ref)) ?? copies.set(keyOf(n.ref), []).get(keyOf(n.ref))!).push(n);
          let copiesOk = true;
          for (const group of copies.values()) {
            const opened = group.filter((c) => c.pill!.open);
            if (opened.length > 1) copiesOk = false;
            for (const c of group) {
              if (c.pill!.open || c.pill!.cycle || c.pill!.unavailable || c.pill!.error) continue;
              if (opened.length === 1 ? c.pill!.openAt?.id !== opened[0].id : c.pill!.openAt !== undefined) copiesOk = false;
            }
          }
          assert(copiesOk, `at most one copy of a workflow is open, every other copy names that one, and none names a copy that is not open: ${where}`);
          assert(reachable(m).length === 0, `every card is reachable with the arrow keys from the first one: ${where}`);
          checked++;
        }
      }
  assert(checked === 84, "…over all 84 combinations of rung, plan source, filter and expansion state");
}

/* ── what a reader lands on ───────────────────────────────────────────────
   A workflow opens on its shape. The reader opens what they choose to open,
   and nothing they did on a previous visit — or on a previous workflow —
   changes what they land on. This regressed once: resolving a `?step=` could
   move the rung, the rung was a stored preference, and one deep link left
   every workflow fully expanded for that viewer from then on. */
{
  const key = keyOf(COLLAPSE_VIEWED) as WorkflowKey;
  const base = { viewed: COLLAPSE_VIEWED, linkMap: COLLAPSE.linkMap, summaries: COLLAPSE.summaries, query: "", now: PROTOTYPE_NOW, shapes: COLLAPSE_SHAPE_MAP };

  /* The landing state, stated as the default rather than passed in: what
     `buildMap` does with no layer and nothing expanded IS what a visit with
     no `?step=` sees. */
  const landing = buildMap({ ...base, expanded: {} });
  assert(landing.flat.filter((n) => !n.pill).length === 20, "a plain visit lands on 20 elements — the shape, not the steps");
  assert(landing.counts.folded === 8 && landing.counts.withheld === 108, "with the eight branches big enough to fold folded, and 108 steps standing behind their cards");
  assert(landing.flat.every((n) => !n.fold?.open && !n.pack?.open), "nothing is open on arrival: a fold that opened itself would be a canvas that expanded without being asked");
  assert(landing.flat.filter((n) => n.fold || n.pack).length === 8, "and every card that stands for more than itself — those eight branches — offers the control that opens it");

  /* Resolving a deep link opens exactly what stands in the way — and only
     for that visit. Nothing it does is a setting. */
  const viaLink = buildMap({ ...base, expanded: { [armKey(key, "A1")]: true } });
  const band = viaLink.byId.get(`wf:${key}/m:p10`)!.children;
  assert(band.filter((c) => c.fold && !c.fold.open).length === 7, "a link that opened one branch leaves the other seven that fold folded");
  assert(viaLink.flat.filter((n) => n.fold && n.depth > band[0].depth).every((n) => n.fold!.open) && viaLink.counts.withheld < landing.counts.withheld && viaLink.counts.withheld > 0, "and the branch it opened is open whole, the way a press opens it — never the whole workflow");
  assert(buildMap({ ...base, expanded: {} }).counts.rendered === landing.counts.rendered, "and the next visit lands on the shape again — a navigation move is never a preference");
}

/* ── a connected workflow opens whole ─────────────────────────────────────
   The founder's pick: a pill opens the way GoHighLevel's editor shows a
   workflow — all of it, no branch left folded inside, whatever its platform.
   The rung describes the viewed workflow; a workflow the reader opened is
   drawn because they asked for it. Here the 119-step workflow is the
   connected one: a small host calls it from its one action, and it calls out
   to Make from its own branches (COLLAPSE_LINKED). */
{
  const pcf = keyOf(COLLAPSE_VIEWED) as WorkflowKey;
  const hostRef = { source: "ghl" as const, refId: "host" };
  const host: ScenarioSummary = {
    name: "Host",
    totalModules: 2,
    appsUsed: ["ghl"],
    modules: [
      { id: "t", module: "trigger", app: "ghl", label: "Form submitted", ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "trigger" } as ModuleInfo,
      { id: "call", module: "add_to_workflow", app: "ghl", label: "Add to PCF", ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "action" } as ModuleInfo,
    ],
    connections: [{ from: "t", to: "call", kind: "sequence" }],
  };
  const linkMap: LinkMap = {
    ...COLLAPSE_LINKED.linkMap,
    workflows: [...COLLAPSE_LINKED.linkMap.workflows, { source: "ghl", refId: "host", name: "Host", stepCount: 2 }],
    links: [...COLLAPSE_LINKED.linkMap.links, { from: { ...hostRef, stepId: "call", stepName: "Add to PCF" }, to: { source: "ghl", refId: "pcf-119" }, kind: "subflow", status: "ok" }],
  };
  const hostOnly = new Map<WorkflowKey, SummaryEntry>([["ghl:host" as WorkflowKey, { state: "ok", summary: host }]]);
  const both = new Map<WorkflowKey, SummaryEntry>([...hostOnly, [pcf, { state: "ok", summary: COLLAPSE_SUMMARY }]]);
  const pillId = `wf:ghl:host/m:call/wf:${pcf}`;
  const seed = { viewed: hostRef, linkMap, query: "", now: PROTOTYPE_NOW, shapes: COLLAPSE_SHAPE_MAP };
  const inPcf = (n: MapNode) => n.stepRef?.key === pcf;

  /* Opened before its summary arrives: nothing to draw yet. */
  const clicked = buildMap({ ...seed, summaries: hostOnly, expanded: { [pillId]: true } });
  assert(clicked.byId.get(pillId)?.pill?.loading === true && clicked.wanted.includes(pcf), "a pill opened before its steps have loaded asks for them");

  /* Arrived: the same `expanded`, no second press, and every arm is open. */
  for (const layer of ["structure", "macro"] as Layer[]) {
    const arrived = buildMap({ ...seed, summaries: both, expanded: { [pillId]: true }, layer });
    const folds = arrived.flat.filter((n) => inPcf(n) && n.fold);
    assert(folds.length > 0 && folds.every((n) => n.fold!.scope === "arm" && n.fold!.open), `once they arrive its branches are drawn open, with no second press (${layer}) — each still carries the card that folds it again`);
    assert(COLLAPSE_SUMMARY.modules.every((mod) => arrived.byStep.has(`${pcf}:${mod.id}`)) && ![...arrived.hiddenSteps.keys()].some((k) => k.startsWith(`${pcf}:`)), `all 119 of its steps are drawn and none is held (${layer}): the rung describes the viewed workflow, not one the reader opened`);
    const nestedPills = arrived.flat.filter((n) => n.pill && n.id !== pillId && n.id.startsWith(`${pillId}/`));
    assert(nestedPills.length > 0 && nestedPills.every((n) => !n.pill!.open), `workflows it calls stay shut until clicked (${layer}): opening one workflow never opens another`);
  }

  /* The reader's fold inside it is theirs to keep, as in the viewed workflow. */
  const folded = buildMap({ ...seed, summaries: both, expanded: { [pillId]: true, [armKey(pcf, "A1")]: false } });
  assert(folded.flat.find((n) => inPcf(n) && n.fold?.armId === "A1")?.fold?.open === false && folded.flat.filter((n) => inPcf(n) && n.fold && n.fold.armId !== "A1").every((n) => n.fold!.open), "folding one of its branches folds that one and leaves the rest open");

  /* The viewed workflow is unchanged by any of it. */
  const viewedHost = buildMap({ ...seed, viewed: COLLAPSE_VIEWED, summaries: both, expanded: {} });
  assert(viewedHost.counts.folded === 8, "while the same workflow, viewed, still lands at Structure with its top-level branches folded");

  /* Which way each line runs follows whose flow it is in. */
  const sid = (id: string) => id.split("/").slice(-1)[0];
  const opened = buildMap({ ...seed, summaries: both, expanded: { [pillId]: true } });
  const anchorOf = (m: ReturnType<typeof buildMap>, from: string, to: string) => m.pairs.find((p) => p.kind === "tree" && sid(p.from) === from && sid(p.to) === to);
  assert(anchorOf(opened, "m:call", `wf:${pcf}`)?.anchor === "drop" && anchorOf(opened, "m:t", "m:call")?.anchor === "h", "the host is the viewed workflow: its row runs right, and the workflow its step calls hangs below that step");
  const pcfPill = opened.byId.get(pillId)!;
  const column = chainsOf(pcfPill)[0];
  assert(stacksChain(pcfPill) && anchorOf(opened, `wf:${pcf}`, "m:p1")?.anchor === "v" && column.slice(1).every((s, i) => opened.pairs.find((p) => p.from === column[i].id && p.to === s.id)?.anchor === "v"), `the called workflow runs down its own column: pill to first step, then step to step, every link "v"`);
  assert(anchorOf(opened, "m:p9", "wf:make:916")?.anchor === undefined && viewedHost.pairs.find((p) => sid(p.from) === "m:p9" && sid(p.to) === "wf:make:916")?.anchor === "drop", "a pill called from its trunk sits to the right of the step with no anchor — the same call, viewed, hangs below as a drop");

  /* Only the trunk runs down. A branch lane runs right wherever it sits —
     the founder's pick, to spend width instead of height. */
  const noShowed = opened.byId.get(`${pillId}/m:p10/route:p10:0`)!;
  assert(!!opened.byId.get(`${pillId}/m:p10`)?.down && !flowsRight(opened.byId.get(`${pillId}/m:p10`)!), "the connected workflow's trunk runs down, the Condition at its foot included");
  assert(flowsRight(noShowed) && !noShowed.down && noShowed.children.filter((k) => k.kind === "step").every((k) => flowsRight(k)), "while its branches run right: a branch card, then its steps beside it, never stacked under it");
  assert(anchorOf(opened, "route:p10:0", "m:A1")?.anchor === "h" && anchorOf(opened, "m:A1", "m:A2")?.anchor === "h" && anchorOf(opened, "m:A2", "wf:make:912")?.anchor === "drop", "so a branch inside a connected workflow is linked like the main flow's: along its rail, with what a step calls hanging below it");

  /* Two entries into one step: the entries keep to a column on the pill's
     right, so only the shared step's own chain stacks. */
  const twoEntry: ScenarioSummary = {
    name: "Two entries",
    totalModules: 4,
    appsUsed: ["ghl"],
    modules: [
      { id: "t1", module: "trigger", app: "ghl", label: "Form", ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "trigger" } as ModuleInfo,
      { id: "t2", module: "trigger", app: "ghl", label: "Survey", ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "trigger" } as ModuleInfo,
      { id: "a", module: "tag", app: "ghl", label: "Tag", ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "action" } as ModuleInfo,
      { id: "b", module: "email", app: "ghl", label: "Email", ordinal: null, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false, kind: "action" } as ModuleInfo,
    ],
    connections: [
      { from: "t1", to: "a", kind: "sequence" },
      { from: "t2", to: "a", kind: "sequence" },
      { from: "a", to: "b", kind: "sequence" },
    ],
  };
  const twoKey = "ghl:two-entry" as WorkflowKey;
  const twoMap: LinkMap = { ...linkMap, workflows: [...linkMap.workflows, { source: "ghl", refId: "two-entry", name: "Two entries", stepCount: 4 }], links: [{ from: { ...hostRef, stepId: "call", stepName: "Add to PCF" }, to: { source: "ghl", refId: "two-entry" }, kind: "subflow", status: "ok" }] };
  const twoPill = `wf:ghl:host/m:call/wf:${twoKey}`;
  const two = buildMap({ ...seed, linkMap: twoMap, summaries: new Map([...hostOnly, [twoKey, { state: "ok", summary: twoEntry } as SummaryEntry]]), expanded: { [twoPill]: true } });
  const twoNode = two.byId.get(twoPill)!;
  assert(chainsOf(twoNode).length === 2 && twoNode.joins.length === 1 && !stacksChain(twoNode) && two.pairs.filter((p) => p.from === twoPill).every((p) => p.anchor === undefined), `a connected workflow with two entries keeps them in a column to its pill's right, linked as before — no "v" out of the pill`);
  assert(stacksChain(twoNode.joins[0]) && anchorOf(two, "m:a", "m:b")?.anchor === "v" && !flowsRight(twoNode.joins[0]), "while the step both entries reach stacks its own chain under it");
  assert(reachable(opened).length === 0 && reachable(two).length === 0, "and the arrow keys reach every card of both, down columns and across to what they call");
}

/* ── a fan-out sits in the middle of its branches ─────────────────────────
   Every fan-out, in the main flow or a connected workflow, is centred on its
   rail by count: half its branches over the rail, the rest from the rail
   down, the middle one on the rail when there is one. */
{
  const split = (n: number) => fanSplit(n);
  assert(split(1).above === 0 && split(1).onRail, "a single branch sits on the rail");
  assert(split(2).above === 1 && !split(2).onRail, "two branches: one above, one below, the rail between them");
  assert(split(3).above === 1 && split(3).onRail && split(9).above === 4 && split(9).onRail, "an odd count puts the middle branch on the rail — the Condition's nine outcomes fan four above, four below");
  assert(split(4).above === 2 && !split(4).onRail, "an even count splits evenly around the rail");
}

/* ── arrow keys follow the picture ─────────────────────────────────────────
   Along the viewed workflow's rows with ←/→, between its lanes with ↑/↓ and
   ↓ into what a step calls; down a connected workflow's column with ↑/↓ and
   across to what a step calls with →/←. Opening and folding stay the hook's
   (→ on a shut card, ← on an open one), so these are the moves alone. */
{
  const sid = (n: MapNode | null) => (n ? n.id.split("/").slice(-1)[0] : "none");
  const go = (m: ReturnType<typeof buildMap>, id: string, key: Arrow) => sid(arrowTarget(m, m.byId.get(id)!, key));

  /* The prototype hub: the viewed scenario's row, a caller's column beside it. */
  const pm = buildMap({ ...base, expanded: { ...initialExpanded(PROTOTYPE.linkMap, PROTOTYPE_VIEWED), "wf:ghl:pcf-a": true } });
  const v = "wf:make:912";
  assert(go(pm, v, "ArrowRight") === "m:1" && go(pm, `${v}/m:1`, "ArrowRight") === "m:2" && go(pm, `${v}/m:2`, "ArrowLeft") === "m:1" && go(pm, `${v}/m:1`, "ArrowLeft") === v, "→ and ← walk the viewed row: pill, first step, next step, and back");
  assert(go(pm, `${v}/m:3`, "ArrowRight") === "route:3:0" && go(pm, `${v}/m:3/route:3:0`, "ArrowLeft") === "m:3", "past a fan-out → reaches its first branch, on the main row, and ← returns to the fan-out");
  assert(go(pm, `${v}/m:3/route:3:0`, "ArrowDown") === "route:3:1" && go(pm, `${v}/m:3/route:3:0/m:5`, "ArrowDown") === "route:3:1" && go(pm, `${v}/m:3/route:3:1/m:6`, "ArrowUp") === "route:3:0", "↓ and ↑ move between branches, from the branch card or from anywhere along its lane");
  assert(go(pm, `${v}/m:1`, "ArrowUp") === "none" && go(pm, `${v}/m:3/route:3:1`, "ArrowDown") === "none", "and do nothing past the first and last lane — the callers block is beside the tree, not above it");
  assert(go(pm, "wf:ghl:pcf-a", "ArrowDown") === "m:t1" && go(pm, "wf:ghl:pcf-a/m:t1", "ArrowDown") === "m:s1" && go(pm, "wf:ghl:pcf-a/m:t1", "ArrowUp") === "wf:ghl:pcf-a", "a caller is a connected workflow: ↓ and ↑ walk its column, pill first");
  assert(go(pm, "wf:ghl:pcf-a/m:hook", "ArrowRight") === "wf:make:913" && go(pm, "wf:ghl:pcf-a/m:hook/wf:make:913", "ArrowLeft") === "m:hook" && go(pm, "wf:ghl:pcf-a/m:hook/wf:make:913", "ArrowUp") === "m:hook", "→ enters what a connected step calls, beside it, and ← or ↑ returns to that step");
  assert(go(pm, "wf:ghl:pcf-a/m:hook", "ArrowDown") === "wf:ghl:pcf-b" && go(pm, "wf:ghl:pcf-b", "ArrowUp") === "wf:ghl:pcf-a", "past the end of a caller's column ↓ goes on to the next caller");
  assert(go(pm, v, "ArrowLeft") === "wf:ghl:pcf-a" && go(pm, "wf:ghl:pcf-a", "ArrowRight") === v, "← from the viewed pill reaches the callers block, and → from an open caller comes back");

  /* The 119-step workflow calling out to Make, with No-Showed open. */
  const key = keyOf(COLLAPSE_VIEWED) as WorkflowKey;
  const lm = buildMap({ viewed: COLLAPSE_VIEWED, linkMap: COLLAPSE_LINKED.linkMap, summaries: COLLAPSE_LINKED.summaries, query: "", now: PROTOTYPE_NOW, shapes: COLLAPSE_SHAPE_MAP, expanded: { [armKey(key, "A1")]: true } });
  const w = `wf:${key}`;
  const ns = `${w}/m:p10/route:p10:0`;
  assert(go(lm, `${w}/m:p9`, "ArrowDown") === "wf:make:916" && go(lm, `${w}/m:p9/wf:make:916`, "ArrowUp") === "m:p9" && go(lm, `${w}/m:p9/wf:make:916`, "ArrowLeft") === "m:p9", "↓ drops into the workflow a main step calls, and ↑ or ← climbs back to the step");
  assert(go(lm, `${ns}/m:A2`, "ArrowDown") === "wf:make:912" && go(lm, `${ns}/m:A2/wf:make:912`, "ArrowDown") === "route:p10:1", "inside a branch too; and ↓ past what hangs there goes on to the next branch");
  assert(go(lm, `${ns}/m:A3/route:A3:1`, "ArrowDown") === "route:p10:1" && go(lm, `${ns}/m:A3/route:A3:1`, "ArrowUp") === "route:A3:0", "a nested branch steps to its sibling, and past its last climbs out to the next outer branch");
  for (const m of [pm, lm]) assert(reachable(m).length === 0, "every card is reachable with the arrow keys from the first one");
}

console.log(`\n${checks} model checks pass.`);
