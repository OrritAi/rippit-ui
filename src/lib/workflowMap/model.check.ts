/*
 * Model assertions — `pnpm check:map`.
 * Runs with `node --experimental-strip-types`, so this file, model.ts and the
 * fixture use relative `.ts` imports and `import type` only through `@/`.
 */
import { buildMap, expandAllSnapshot, initialExpanded, keyOf, pillChip, rootOf, viewedPillId } from "./model.ts";
import { dimNodeIds, failedNodeIds, runCounts, runFocusRect, runStates, runSummary, runUnchecked, RUN_FOCUS_MAX_ZOOM, RUN_FOCUS_SPREAD, type FocusRect, type RelatedTraces, type RunState } from "./run.ts";
import { ZOOM_MIN } from "./tokens.ts";
import { PROTOTYPE, PROTOTYPE_NOW, PROTOTYPE_PROJECTION, PROTOTYPE_RELATED_TRACE, PROTOTYPE_RUN, PROTOTYPE_TRACE, PROTOTYPE_VIEWED, big } from "./fixtures/prototype.ts";
import { projectionAsTrace } from "../projection/overlay.ts";
import type { ExecutionTrace, LinkMap, ModuleInfo, ScenarioSummary } from "@/app/lib/api";
import type { MapNode, SummaryEntry, WorkflowKey } from "./types.ts";

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const find = (nodes: MapNode[], pred: (n: MapNode) => boolean): MapNode | undefined => {
  for (const n of nodes) {
    if (pred(n)) return n;
    const c = find(n.children, pred);
    if (c) return c;
  }
  return undefined;
};

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
  assert(m.callers[0].children.map((c) => c.id).join(",") === "wf:ghl:pcf-a/wf:make:913", "a folded caller still shows its OTHER targets under it (make:913), never the viewed one");
  assert(m.callers.slice(1).every((c) => c.children.length === 0), "callers whose only target is the viewed workflow show nothing under them");
  assert(viewedPill.children.length === 3, "scenario shows a 3-step column (webhook, filterRows, BasicIfElse)");
  const router = m.byId.get("wf:make:912/m:3");
  assert(router?.children.length === 2 && router.children.every((c) => c.kind === "route"), "BasicIfElse fans out into two route nodes");
  assert(router.children[0].name === "route · yes" && router.children[1].name === "route · no", "route labels come from the branch edges");
  assert(router.children[0].children.length === 2 && router.children[1].children.length === 1, "route columns carry their branch steps");
  assert(router.children[0].id === "wf:make:912/m:3/route:3:0", "route ids are path-based and index-free");
  const other = m.byId.get("wf:ghl:pcf-a/wf:make:913");
  assert(other?.pill?.open === false && pillChip(other) === "+ expand", "the other scenario stays folded with '+ expand'");
  assert(m.callers[0].meta === "last run 2h ago", "pill meta line is the card's last run, no provider prefix");
  assert(m.callers[3].status === "off" && m.callers[0].status === "ok", "status dot follows isActive");
  assert(m.counts.connected === 4 && m.counts.matchedRoots === 5, "connected = callers ∪ direct targets; matchedRoots counts the root and the callers");
  assert(m.counts.openPills === 1, "counts.openPills counts open pills actually rendered (only the viewed one)");
  assert(m.pairs.filter((p) => p.kind === "tree").length === m.flat.length - 1 - m.callers.length, "one tree pair per visible parent→child (roots and callers have none)");
  assert(m.pairs.find((p) => p.to === router.id)?.depth === 0 && m.pairs.find((p) => p.to === router.children[0].id)?.depth === 1, "pair depth is the parent's depth");
  assert(rootOf(router.id) === "wf:make:912" && rootOf("wf:ghl:pcf-a/wf:make:913") === "wf:ghl:pcf-a", "rootOf() strips to the top-level row id (viewed root or caller)");
  assert(m.byStep.get("make:912:3") === router, "byStep resolves '<key>:<stepId>' to the first rendered step");
  assert(m.wanted.length === 0, "nothing wanted when every open pill is loaded");
  assert(viewedPillId(m, PROTOTYPE_VIEWED) === viewedPill.id, "viewedPillId finds the viewed root");
  assert(m.flat[0] === m.callers[0] && m.flat.indexOf(viewedPill) === m.flat.length - 1 - viewedPill.descendants, "flat order: callers block first (left), then the viewed tree");
  const all = buildMap({ ...base, expanded: expandAllSnapshot(m, expanded) });
  assert(all.callers.every((c) => c.pill?.open) && all.byId.get("wf:ghl:pcf-a/wf:make:913")?.parentId === "wf:ghl:pcf-a/m:hook" && !("wf:make:912" in expandAllSnapshot(m, expanded)), "expand-all opens the callers (913 moves under POST webhook) and never touches the viewed pill");
  /* unfolding caller 0: its chain renders in the block and the cross edge starts at POST webhook */
  const opened = buildMap({ ...base, expanded: { ...expanded, "wf:ghl:pcf-a": true } });
  const hook = opened.byId.get("wf:ghl:pcf-a/m:hook");
  assert(hook?.parentId === "wf:ghl:pcf-a/m:s1" || hook?.parentId === "wf:ghl:pcf-a", "an expanded caller renders its chain inside the block");
  assert(opened.pairs.some((p) => p.kind === "join" && p.from === hook!.id && p.to === "wf:make:912") && !opened.pairs.some((p) => p.kind === "join" && p.from === "wf:ghl:pcf-a"), "the cross edge now starts at the step that calls the viewed workflow");
  assert(opened.flat.filter((n) => n.ref?.refId === "912").length === 1 && hook!.attachedRefs.map((r) => r.refId).join(",") === "913", "the viewed workflow is still rendered once — the calling step attaches only its other target");
  assert(opened.byStep.get("make:912:3")?.id === router.id, "viewed ids are unchanged by the caller's toggle (deep links survive)");
  assert(opened.callers[0].descendants === 4, "the expanded caller's subtree counts its 3 steps + the 913 pill");
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
  assert(m.roots[0].children.map((c) => c.name).join(",") === "h1,h2,h3" && m.pairs.filter((p) => p.anchor === "v").length === 2, "the viewed chain renders as a vertical chain");
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
  const expanded = { "wf:ghl:pcf-a/wf:make:913": true };
  const m = buildMap({ ...base, summaries, expanded });
  const p = m.byId.get("wf:ghl:pcf-a/wf:make:913");
  assert(m.wanted.includes("make:913") && p?.pill?.loading === true && pillChip(p) === "loading", "open + no entry → key in wanted, pill loading");
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
  const m = buildMap({ viewed, linkMap, summaries, expanded: { "wf:ghl:B/wf:ghl:A": true }, query: "" });
  assert(m.roots.length === 1 && m.roots[0].id === "wf:ghl:B" && m.callers.length === 1 && m.callers[0].id === "wf:ghl:A", "B is the root; its caller A sits in the block");
  const aUnderB = m.byId.get("wf:ghl:B/wf:ghl:A");
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
  const r = buildMap({ viewed: { source: "ghl", refId: "V" }, linkMap: ring, summaries: ringSummaries, expanded: { "wf:ghl:V/wf:ghl:X": true, "wf:ghl:V/wf:ghl:X/wf:ghl:Y": true }, query: "" });
  const back = r.byId.get("wf:ghl:V/wf:ghl:X/wf:ghl:Y/wf:ghl:X");
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
  assert(b.children.length === 2 && b.children[0].name === "route · Yes" && b.children[1].name === "route · B", "branch: 'route · <label>', else 'route · B' for GHL");
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
  assert(root.pill?.unavailable === true && root.pill.open && root.children.length === 2 && root.children.every((c) => c.ref), "stepsUnavailable → outgoing targets hang directly off the pill");
  assert(pillChip(root) === "steps unavailable" && root.childCount === 2, "unavailable chip + childCount from the card");
}

/* ── big(): LITE / windowing thresholds ── */
{
  const f = big(300);
  assert(f.linkMap.workflows.length === 302 && f.linkMap.links.length === 375, "big(300) synthesises 300 callers (every 4th fans out to both scenarios)");
  const m = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: initialExpanded(f.linkMap, f.viewed), query: "", now: PROTOTYPE_NOW });
  assert(m.roots.length === 1 && m.callers.length === 300 && m.callers.every((c) => !c.pill?.open) && m.counts.openPills === 1, "one viewed root, 300 folded callers in the block");
  assert(m.pairs.filter((p) => p.kind === "join").length === 300 && m.callers.filter((c) => c.children.length === 1).length === 75, "300 join edges into the viewed pill; every 4th caller also shows its other target (913)");
  const opened = buildMap({ viewed: f.viewed, linkMap: f.linkMap, summaries: f.summaries, expanded: expandAllSnapshot(m, {}), query: "", now: PROTOTYPE_NOW });
  assert(opened.counts.rendered > 150 && opened.callers.every((c) => c.pill?.open) && opened.flat.filter((n) => n.ref?.refId === "912").length === 1, "expand-all on the big fixture crosses LITE_AT, opens every caller, and the viewed workflow still renders once");
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
  assert(at({ "wf:ghl:V/wf:make:T1": true }).map((c) => c.ref?.refId).join(",") === "T2,T1", "first attachment unfolded → it renders last, the folded sibling stays beside the step");
  assert(at({ "wf:ghl:V/wf:make:T2": true }).map((c) => c.ref?.refId).join(",") === "T1,T2", "second attachment unfolded → order unchanged");
  const kids = at({ "wf:ghl:V/wf:make:T1": true }, new Map([...sums].filter(([k]) => k !== "make:T1")));
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
  assert(root.children.length === 9 && root.children.map((c) => c.name).join(",") === Array.from({ length: 9 }, (_, i) => `Step ${i + 1}`).join(","), "a linear workflow is one column of 9 in order");
  assert(root.children[0].chained !== true && root.children.slice(1).every((c) => c.chained), "every step after the first is chained");
  const fromPill = lm.pairs.filter((p) => p.from === root.id);
  const vertical = lm.pairs.filter((p) => p.anchor === "v");
  assert(fromPill.length === 1 && fromPill[0].to === root.children[0].id, "exactly one pair leaves the pill: to the first step");
  assert(vertical.length === 8 && vertical.every((p, i) => p.from === root.children[i].id && p.to === root.children[i + 1].id && p.kind === "tree"), "eight vertical step → step pairs in order");
  assert(lm.pairs.length === 9, "no other pairs");
  /* prototype: the Make scenario chains 1 → 2 → 3(router) and route yes chains 4 → 5 */
  const pm = buildMap({ ...base, expanded: { ...initialExpanded(PROTOTYPE.linkMap, PROTOTYPE_VIEWED), "wf:ghl:pcf-a": true } });
  const sid = (id: string) => id.split("/").pop();
  const v = pm.pairs.filter((p) => p.anchor === "v").map((p) => `${sid(p.from)}>${sid(p.to)}`).sort().join(" ");
  assert(v === "m:1>m:2 m:2>m:3 m:4>m:5 m:s1>m:hook m:t1>m:s1", "prototype chains: GHL t1→s1→hook, Make 1→2→3, route yes 4→5; routes still fan from the router");
  const scen = find(pm.roots, (n) => n.id === "wf:make:912")!;
  assert(pm.pairs.filter((p) => p.from === scen.id).length === 1, "the scenario pill connects to its first module only");
}

/* ── viewed vs connected: isViewed + orritHref ── */
{
  const m = buildMap({ ...base, expanded: { ...initialExpanded(PROTOTYPE.linkMap, PROTOTYPE_VIEWED), "wf:ghl:pcf-a": true } });
  const viewedPills = m.flat.filter((n) => n.ref?.refId === "912");
  assert(viewedPills.length === 1 && viewedPills[0].isViewed === true && viewedPills[0].orritHref === undefined, "the viewed pill is flagged isViewed and has no Orrit link");
  assert(m.callers.every((r) => r.isViewed === undefined && r.orritHref === `/w/ghl/${r.ref!.refId}`), "connected caller pills link to their Orrit page");
  assert(m.byId.get("wf:ghl:pcf-a/wf:make:913")?.orritHref === "/w/make/913", "a connected target pill links to its Orrit page");
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
  assert(m.roots[0].children.map((n) => n.name).join(",") === "gateway:CustomWebhook,google-sheets:filterRows,http:ActionSendData,builtin:BasicIfElse" && m.byId.get("wf:make:912/wf:make:913")?.parentId === id("7"), "PROTOTYPE_RUN: the viewed chain is 1 → 2 → 7 → 3 and make:913 hangs under module 7");
  const states = runStates(m, key, PROTOTYPE_TRACE);
  const viewedSteps = m.flat.filter((n) => n.kind === "step" && n.stepRef?.key === key);
  assert(viewedSteps.length === 7 && viewedSteps.every((n) => states.has(n.id)), "every rendered step of the viewed workflow has a run state");
  assert(states.get(id("4")) === "failed", "the failed module is `failed`");
  assert(["1", "2", "7", "3"].every((sid) => states.get(id(sid)) === "touched"), "the modules the run went through are `touched`");
  const router = m.byStep.get(`${key}:3`)!;
  const yes = router.children.find((c) => c.name === "route · yes")!;
  const no = router.children.find((c) => c.name === "route · no")!;
  assert(states.get(yes.id) === "touched", "a route with a touched (here: failed) child is `touched`");
  assert(states.get(no.id) === "untouched" && states.get(id("6")) === "untouched", "the untouched branch — its route and its step — is `untouched`");
  assert(states.get(id("5")) === "unknown", "a module outside coverage is `unknown`, never `untouched`");
  assert(states.get("wf:make:912/wf:make:913") === "reached", "the pill attached under a touched calling step is `reached`");
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
  assert(!states.has("wf:ghl:pcf-a/wf:make:913") && !states.has("wf:make:912") && m.callers.every((c) => !states.has(c.id)), "pills not under a viewed step — the viewed root, the callers, a caller's target — carry no state");
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
  assert(runStates(m, key, warn).get(id("7")) === "warning" && runStates(m, key, warn).get("wf:make:912/wf:make:913") === "reached" && runSummary(warn) === "5 of 7 steps reached · 1 failed · 1 with a warning", "a warning module is `warning`, still counts as reached, and its pill is still `reached`");
  const cold: ExecutionTrace = { ...PROTOTYPE_TRACE, nodes: PROTOTYPE_TRACE.nodes.map((n) => (n.nodeId === "7" ? { ...n, state: "untouched", status: null } : n)) };
  assert(runStates(m, key, cold).get("wf:make:912/wf:make:913") === "untouched", "a pill under an untouched calling step is `untouched` (grayed with it)");
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
  const pillId = "wf:make:912/wf:make:913";
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
  assert(!both.has("wf:make:912") && m.callers.every((c) => !both.has(c.id)) && !both.has("wf:ghl:pcf-a/wf:make:913"), "the related overlay adds no state to the viewed root, the callers, or a caller's copy of the related workflow's pill");
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

console.log(`\n${checks} model checks pass.`);
