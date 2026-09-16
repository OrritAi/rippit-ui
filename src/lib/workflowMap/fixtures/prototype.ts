import type { ExecutionPayload, ExecutionTrace, LinkMap, ModuleInfo, Projection, ScenarioSummary, WorkflowCard, WorkflowLink } from "@/app/lib/api";
import type { SummaryEntry, WorkflowKey, WorkflowRef } from "../types";

/*
 * The design handoff's demo data ("Workflow Map v7.dc.html": ROOTS, SCENARIO,
 * SCENARIO2) as a fake link map + summaries, so the dev harness at
 * /w/preview can be compared against the prototype at the same viewport.
 *
 * Shape: four GHL callers (`ghl:pcf-a…d`) each POST a webhook to `make:912`
 * from their "POST webhook" step; Live A's webhook also fans out to
 * `make:913` (the prototype's hookNode(…, extra) on the first root).
 * `make:912` carries the router with two labelled routes.
 *
 * Only `import type` here — model.check.ts loads this under
 * `node --experimental-strip-types`, which cannot resolve `@/` value imports.
 */

/** Fixed clock so relative times ("last run 2h ago") are deterministic. */
export const PROTOTYPE_NOW = Date.UTC(2026, 8, 9, 12, 0, 0);
const H = 3_600_000;
const D = 24 * H;
const at = (msAgo: number) => new Date(PROTOTYPE_NOW - msAgo).toISOString();

export const PROTOTYPE_VIEWED: WorkflowRef = { source: "make", refId: "912" };

const capture = { state: "current" as const, at: at(2 * H), attemptedAt: at(2 * H), error: null, deletedUpstreamAt: null };

const ghlCard = (refId: string, name: string, stepCount: number, lastRunAgo: number, active = true): WorkflowCard => ({
  source: "ghl",
  refId,
  name,
  status: active ? "published" : "paused",
  isActive: active,
  stepCount,
  talksToGhl: true,
  issueCounts: { error: 0, warn: 0, info: 0 },
  lastRun: { status: "success", at: at(lastRunAgo) },
  capture,
});

const makeCard = (refId: string, name: string, stepCount: number, lastRunAgo: number): WorkflowCard => ({
  source: "make",
  refId,
  name,
  status: "active",
  isActive: true,
  stepCount,
  talksToGhl: true,
  issueCounts: { error: 0, warn: 0, info: 0 },
  lastRun: { status: "success", at: at(lastRunAgo) },
  capture,
});

const step = (
  id: string | number,
  app: string,
  label: string,
  summary: string,
  extra: Partial<ModuleInfo> = {}
): ModuleInfo => ({
  id,
  module: label,
  app,
  label,
  summary,
  ordinal: null,
  depth: 0,
  x: null,
  y: null,
  hasFilter: false,
  filterName: null,
  hasErrorHandler: false,
  ...extra,
});

/* ── SCENARIO — make:912 ─────────────────────────────────────────────── */

export const SCENARIO: ScenarioSummary = {
  name: "CP - pcf_data - Clear GHL Fields",
  totalModules: 6,
  appsUsed: ["webhook", "google-sheets", "builtin", "ghl", "utils"],
  modules: [
    step(1, "webhook", "gateway:CustomWebhook", "Receive webhook", { kind: "webhook", ordinal: "1", hookId: 912001, source: "make" }),
    step(2, "google-sheets", "google-sheets:filterRows", "Search rows → pcf_data_u…", { kind: "module", ordinal: "2", source: "make" }),
    step(3, "builtin", "builtin:BasicIfElse", "Flow control · Basic If Else. Fires at position 3.", { kind: "router", ordinal: "3", source: "make" }),
    step(4, "ghl", "ghl:updateContact", "Clear PCF custom fields", { kind: "module", ordinal: "3.1.1", source: "make" }),
    step(5, "google-sheets", "google-sheets:updateRow", "Mark row cleared", { kind: "module", ordinal: "3.1.2", source: "make" }),
    step(6, "utils", "tools:SetVariable", "Flag missing row", { kind: "module", ordinal: "3.2.1", source: "make" }),
  ],
  connections: [
    { from: 1, to: 2, kind: "sequence" },
    { from: 2, to: 3, kind: "sequence" },
    { from: 3, to: 4, kind: "branch", label: "yes" },
    { from: 4, to: 5, kind: "sequence" },
    { from: 3, to: 6, kind: "branch", label: "no" },
  ],
  nativeUrl: "https://eu1.make.com/912/scenarios/912/edit",
  issues: [],
};

/* ── SCENARIO_RUN — make:912 with an HTTP step that calls make:913 ──────
   The run-replay harness: the chain 1 → 2 → 7 → 3 (router) with the same
   yes / no routes, and a webhook-call link from module 7 to make:913 so a
   pill hangs under a viewed step (→ "reached" in PROTOTYPE_TRACE). */

export const SCENARIO_RUN: ScenarioSummary = {
  ...SCENARIO,
  totalModules: 7,
  appsUsed: ["webhook", "google-sheets", "http", "builtin", "ghl", "utils"],
  modules: [
    SCENARIO.modules[0],
    SCENARIO.modules[1],
    step(7, "http", "http:ActionSendData", "POST audit log → Log Unsuccessful", { kind: "module", ordinal: "3", source: "make" }),
    { ...SCENARIO.modules[2], ordinal: "4" },
    { ...SCENARIO.modules[3], ordinal: "4.1.1" },
    { ...SCENARIO.modules[4], ordinal: "4.1.2" },
    { ...SCENARIO.modules[5], ordinal: "4.2.1" },
  ],
  connections: [
    { from: 1, to: 2, kind: "sequence" },
    { from: 2, to: 7, kind: "sequence" },
    { from: 7, to: 3, kind: "sequence" },
    { from: 3, to: 4, kind: "branch", label: "yes" },
    { from: 4, to: 5, kind: "sequence" },
    { from: 3, to: 6, kind: "branch", label: "no" },
  ],
};

/* ── SCENARIO2 — make:913 ────────────────────────────────────────────── */

export const SCENARIO2: ScenarioSummary = {
  name: "CP - pcf_data - Log Unsuccessful",
  totalModules: 2,
  appsUsed: ["webhook", "google-sheets"],
  modules: [
    step(1, "webhook", "gateway:CustomWebhook", "Receive webhook", { kind: "webhook", ordinal: "1", hookId: 913001, source: "make" }),
    step(2, "google-sheets", "google-sheets:addRow", "Append row → audit_log", { kind: "module", ordinal: "2", source: "make" }),
  ],
  connections: [{ from: 1, to: 2, kind: "sequence" }],
  nativeUrl: "https://eu1.make.com/913/scenarios/913/edit",
  issues: [],
};

/* ── ROOTS — the four GHL callers ─────────────────────────────────────── */

const HOOK_DESC = "Sends the payload to every connected workflow — webhooks can fan out to multiple.";

/** A GHL workflow: trigger → (middle step) → "POST webhook". */
function ghlSummary(name: string, trigger: [string, string], middle: [string, string, string] | null): ScenarioSummary {
  const modules: ModuleInfo[] = [
    step("t1", "ghl", trigger[0], trigger[1], { kind: "trigger", source: "ghl" }),
  ];
  const connections: ScenarioSummary["connections"] = [];
  let prev = "t1";
  if (middle) {
    modules.push(step("s1", middle[0], middle[1], middle[2], { kind: "action", ordinal: "1", source: "ghl" }));
    connections.push({ from: prev, to: "s1", kind: "sequence" });
    prev = "s1";
  }
  modules.push(step("hook", "webhook", "POST webhook", HOOK_DESC, { kind: "webhook", ordinal: middle ? "2" : "1", source: "ghl" }));
  connections.push({ from: prev, to: "hook", kind: "sequence" });
  return { name, totalModules: modules.length, appsUsed: [...new Set(modules.map((m) => m.app))], modules, connections, issues: [] };
}

export const ROOTS: { card: WorkflowCard; summary: ScenarioSummary; targets: WorkflowRef[] }[] = [
  {
    card: ghlCard("pcf-a", "PCF Submitted → Update Data — Live A", 3, 2 * H),
    summary: ghlSummary("PCF Submitted → Update Data — Live A", ["Form submitted", "Trigger · PCF intake form"], ["builtin", "Filter", "Call status = unsuccessful"]),
    targets: [PROTOTYPE_VIEWED, { source: "make", refId: "913" }],
  },
  {
    card: ghlCard("pcf-b", "PCF Submitted → Update Data — Live B", 3, 18 * H),
    summary: ghlSummary("PCF Submitted → Update Data — Live B", ["Pipeline stage changed", "Trigger · stage → Unsuccessful"], ["utils", "Set variables", "Normalize contact fields"]),
    targets: [PROTOTYPE_VIEWED],
  },
  {
    card: ghlCard("pcf-c", "PCF Submitted → Update Data — Live C", 3, 3 * D),
    summary: ghlSummary("PCF Submitted → Update Data — Live C", ["Appointment status", "Trigger · call marked no-show"], ["http", "Lookup contact", "GET contact by phone"]),
    targets: [PROTOTYPE_VIEWED],
  },
  {
    card: ghlCard("pcf-d", "TEST PCF Submitted → Update Data", 2, 27 * D, false),
    summary: ghlSummary("TEST PCF Submitted → Update Data", ["Form submitted", "Trigger · test intake form"], null),
    targets: [PROTOTYPE_VIEWED],
  },
];

export interface PrototypeFixture {
  viewed: WorkflowRef;
  linkMap: LinkMap;
  /** Every workflow loaded, as the store would hold them after a full wave. */
  summaries: Map<WorkflowKey, SummaryEntry>;
}

function assemble(roots: typeof ROOTS, scenario: ScenarioSummary = SCENARIO, extraLinks: WorkflowLink[] = []): PrototypeFixture {
  const workflows: WorkflowCard[] = [
    ...roots.map((r) => r.card),
    makeCard("912", scenario.name, scenario.modules.length, 27 * D),
    makeCard("913", SCENARIO2.name, SCENARIO2.modules.length, 2 * H),
  ];
  const links: WorkflowLink[] = [
    ...roots.flatMap((r) =>
      r.targets.map((t) => ({
        from: { source: "ghl" as const, refId: r.card.refId, stepId: "hook", stepName: "POST webhook" },
        to: { source: t.source, refId: t.refId, hookId: t.refId === "912" ? 912001 : 913001 },
        kind: "webhook-call" as const,
        status: "ok" as const,
      }))
    ),
    ...extraLinks,
  ];
  const summaries = new Map<WorkflowKey, SummaryEntry>();
  for (const r of roots) summaries.set(`ghl:${r.card.refId}`, { state: "ok", summary: r.summary });
  summaries.set("make:912", { state: "ok", summary: scenario });
  summaries.set("make:913", { state: "ok", summary: SCENARIO2 });
  return {
    viewed: PROTOTYPE_VIEWED,
    linkMap: {
      workflows,
      links,
      unmatched: [],
      assetLinks: [],
      stats: { workflows: workflows.length, links: links.length, deadLinks: 0 },
    },
    summaries,
  };
}

/** The prototype as shipped: 4 callers, 2 scenarios. */
export const PROTOTYPE: PrototypeFixture = assemble(ROOTS);

/** The prototype with SCENARIO_RUN viewed: module 7 calls make:913, so the
 *  viewed workflow has an attached pill of its own (run replay harness). */
export const PROTOTYPE_RUN: PrototypeFixture = assemble(ROOTS, SCENARIO_RUN, [
  {
    from: { source: "make", refId: "912", stepId: "7", stepName: "POST audit log → Log Unsuccessful" },
    to: { source: "make", refId: "913", hookId: 913001 },
    kind: "webhook-call",
    status: "ok",
  },
]);

/* ── PROTOTYPE_TRACE — a failed run of SCENARIO_RUN ────────────────────
   1 → 2 → 7 → 3 ran; the "yes" route's first step (4) failed; 5 sits after
   it and was never checked (coverage cut-off → unknown, partial); the "no"
   route (6) is inside coverage with no module row → untouched. The pill
   under module 7 reads "reached". */

export const PROTOTYPE_TRACE: ExecutionTrace = {
  supported: true,
  execution: {
    executionId: "e12",
    status: "error",
    startedAt: at(2 * H),
    durationMs: 1840,
    operations: 5,
    errorName: "DataError",
    errorMessage: "Missing column: pcf_status",
    causeModuleId: "4",
    causeModule: { name: "Clear PCF custom fields", appName: "ghl" },
    causeSource: "module_logs",
    meta: {},
  },
  nodes: [
    { nodeId: "1", state: "touched", status: "success", bundles: 1, warning: null, error: null },
    { nodeId: "2", state: "touched", status: "success", bundles: 1, warning: null, error: null },
    { nodeId: "7", state: "touched", status: "success", bundles: 1, warning: null, error: null },
    { nodeId: "3", state: "touched", status: "success", bundles: 1, warning: null, error: null },
    { nodeId: "4", state: "failed", status: "error", bundles: 0, warning: null, error: "Missing column: pcf_status" },
    { nodeId: "5", state: "unknown", status: null, bundles: null, warning: null, error: null },
    { nodeId: "6", state: "untouched", status: null, bundles: 0, warning: null, error: null },
  ],
  partial: true,
  coverage: { checked: 6, total: 7, fetchedAt: at(0) },
  entry: { nodeId: "1", kind: "webhook", payloadAvailable: true, source: "hook_log" },
  related: [
    { provider: "make", workflowExternalId: "913", workflowName: SCENARIO2.name, executionId: "e9", startedAt: at(2 * H - 12_000), status: "error", via: "email" },
  ],
  links: {
    history: "https://eu1.make.com/912/scenarios/912/logs",
    execution: "https://eu1.make.com/912/scenarios/912/logs/e12",
    editor: "https://eu1.make.com/912/scenarios/912/edit",
  },
  notes: ["Make reports each module's status and bundle count here; a step's own input and output are read separately, on demand, and never stored."],
  refreshing: false,
  rateLimited: true,
  retryAfter: 42,
};

/* ── PROTOTYPE_PROJECTION — a typed input over the same workflow ──────
   The same seven steps, but nothing ran: `status` is null everywhere, node 4
   is `untouched` because its gate evaluated false rather than because it
   failed, and node 5 is `unknown` because nothing supplies the step it reads.
   Its job in `check:map` is to prove the overlay renders a projection through
   the recorded-run code path without ever producing a failure. */
export const PROTOTYPE_PROJECTION: Projection = {
  supported: true,
  nodes: [
    { nodeId: "1", state: "touched", gate: null },
    { nodeId: "2", state: "touched", gate: null },
    { nodeId: "7", state: "touched", gate: null },
    { nodeId: "3", state: "touched", gate: null },
    {
      nodeId: "4",
      state: "untouched",
      gate: {
        evaluated: false,
        label: "Only big deals",
        reason: null,
        operands: [{ operator: "number:gte", left: 400, right: "1000", verdict: false }],
      },
    },
    { nodeId: "5", state: "unknown", gate: { evaluated: null, label: null, reason: "depends on the output of step 4, which Orrit cannot compute", operands: [], blockedBy: "4" } },
    { nodeId: "6", state: "untouched", gate: null },
  ],
  fields: {},
  frames: {},
  partial: true,
  notes: ["Projected by Orrit — no run happened."],
  projection: {
    source: "typed",
    inputHash: null,
    overrides: [],
    runBlueprintAt: null,
    unresolvedCount: 1,
    visitCap: 3,
  },
};

/* ── PROTOTYPE_RELATED_TRACE — the related run of make:913 (e9) ───────
   PROTOTYPE_TRACE.related names it: the callee SCENARIO2 ran for the same
   record 12 s earlier and failed at its sheet step (2). With the make:913
   pill unfolded, the overlay colours its two steps from this trace and the
   pill's meta line reads "ran 2h ago · failed". */

export const PROTOTYPE_RELATED_TRACE: ExecutionTrace = {
  supported: true,
  execution: {
    executionId: "e9",
    status: "error",
    startedAt: at(2 * H - 12_000),
    durationMs: 640,
    operations: 2,
    errorName: "DataError",
    errorMessage: "Sheet not found: audit_log",
    causeModuleId: "2",
    causeModule: { name: "google-sheets:addRow", appName: "google-sheets" },
    causeSource: "module_logs",
    meta: {},
  },
  nodes: [
    { nodeId: "1", state: "touched", status: "success", bundles: 1, warning: null, error: null },
    { nodeId: "2", state: "failed", status: "error", bundles: 0, warning: null, error: "Sheet not found: audit_log" },
  ],
  partial: false,
  coverage: { checked: 2, total: 2, fetchedAt: at(0) },
  entry: { nodeId: "1", kind: "webhook", payloadAvailable: true, source: "hook_log" },
  related: [],
  links: {
    history: "https://eu1.make.com/913/scenarios/913/logs",
    execution: "https://eu1.make.com/913/scenarios/913/logs/e9",
    editor: "https://eu1.make.com/913/scenarios/913/edit",
  },
  notes: [],
  refreshing: false,
  rateLimited: false,
  retryAfter: null,
};

/** What "Load input" hands back in the harness (the API's shape, no network). */
export const PROTOTYPE_PAYLOAD: ExecutionPayload = {
  supported: true,
  available: true,
  source: "hook_log",
  capturedAt: at(2 * H),
  request: {
    method: "POST",
    url: "hook.eu1.make.com/…q7fb8",
    query: {},
    headers: { "content-type": "application/json", authorization: "<redacted>" },
    body: { email: "ana@example.com", contact_id: "ve9EPM428h8vShlRW1KT", call_status: "unsuccessful" },
  },
  bytes: 212,
  truncated: false,
  note: "Fetched from Make just now and shown once — Orrit does not store run data.",
};

/** `n` callers cloned from the four roots — exercises LITE and root windowing. */
export function big(n: number): PrototypeFixture {
  const roots: typeof ROOTS = [];
  for (let i = 0; i < n; i++) {
    const base = ROOTS[i % ROOTS.length];
    const refId = `pcf-${i + 1}`;
    const name = `${base.card.name.replace(/ — Live [A-D]$/, "")} — Live ${i + 1}`;
    roots.push({
      card: { ...base.card, refId, name },
      summary: { ...base.summary, name },
      targets: base.targets,
    });
  }
  return assemble(roots);
}

/** The viewed scenario with a router fanning out to `n` routes of one step
 *  each — the tall-column case (a parent centred against a long column,
 *  near-vertical edges), for the geometry and layout checks. */
export function tall(n: number): PrototypeFixture {
  const modules: ModuleInfo[] = [
    step(1, "webhook", "gateway:CustomWebhook", "Receive webhook", { kind: "webhook", ordinal: "1", hookId: 912001, source: "make" }),
    step(2, "builtin", "builtin:BasicRouter", `Router · ${n} routes`, { kind: "router", ordinal: "2", source: "make" }),
  ];
  const connections: ScenarioSummary["connections"] = [{ from: 1, to: 2, kind: "sequence" }];
  for (let i = 0; i < n; i++) {
    const id = 100 + i;
    modules.push(step(id, i % 3 === 0 ? "ghl" : i % 3 === 1 ? "slack" : "google-sheets", `Route ${i + 1} action`, `Does thing ${i + 1} for this route.`, { kind: "module", ordinal: `2.${i + 1}.1`, source: "make" }));
    connections.push({ from: 2, to: id, kind: "branch", label: `route ${i + 1}` });
  }
  const scenario: ScenarioSummary = {
    ...SCENARIO,
    name: `CP - pcf_data - Router ×${n}`,
    totalModules: modules.length,
    appsUsed: ["webhook", "builtin", "ghl", "slack", "google-sheets"],
    modules,
    connections,
  };
  return assemble(ROOTS, scenario);
}
