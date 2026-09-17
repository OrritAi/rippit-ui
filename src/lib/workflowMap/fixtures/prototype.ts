import type { Connection, ExecutionPayload, ExecutionTrace, LinkMap, ModuleInfo, Projection, ScenarioSummary, WorkflowCard, WorkflowLink, WorkflowShapes } from "@/app/lib/api";
import { COLLAPSE_SHAPES as CAPTURED_SHAPES } from "./collapseShapes.ts";
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

/* ── COLLAPSE — the 119-step GoHighLevel workflow ─────────────────────
   The workflow the whole legibility measurement is built from
   ("PCF Submitted → Update Data Compiler - Slack"): a ten-step run into a
   nine-outcome router, where four arms are byte-identical, two more match
   each other, and three are singletons. Modelled, not captured — the step
   counts, arm shapes and branch labels are the measured ones, so the fold
   and group behaviour can be asserted without a database.

     10 steps  survey submitted → … → enrol → router
     ×4 · 12   No-Showed | Canceled | Reschedule | Payment = No
     ×2 · 10   Passed to Setter | Fake or Duplicate
        36     Payment = Yes
         4     Paste-Values Only Placeholder
         1     None                                        = 119 steps

   The ×4 arm carries a nested two-way branch, so opening its card leaves
   two folded arms inside it — the "one level per rebuild" path a `?step=`
   deep link into a collapsed arm has to walk. */

const ghlStep = (id: string, module: string, label: string, ordinal: string, kind = "action"): ModuleInfo =>
  step(id, "ghl", module, "", { kind, ordinal, source: "ghl", label } as Partial<ModuleInfo>);

/** A linear run of `n` steps under `prefix`, cycling a module vocabulary. */
function runOf(prefix: string, n: number, vocab: [string, string][], from: string, ordinal: string, offset = 0): { modules: ModuleInfo[]; connections: Connection[]; last: string } {
  const modules: ModuleInfo[] = [];
  const connections: Connection[] = [];
  let prev = from;
  for (let i = 0; i < n; i++) {
    const [module, label] = vocab[(i + offset) % vocab.length];
    const id = `${prefix}${i + 1}`;
    modules.push(ghlStep(id, module, `${label}${vocab.length > 1 || n === 1 ? "" : ` ${i + 1}`}`, `${ordinal}.${i + 1}`));
    connections.push({ from: prev, to: id, kind: i === 0 ? "branch" : "sequence" });
    prev = id;
  }
  return { modules, connections, last: prev };
}

/** Label, step count, and where in the vocabulary the arm starts. Two arms
 *  with the same size AND the same offset are byte-identical, which is how
 *  the measured [4, 2, 1, 1, 1] shape distribution is reproduced — the
 *  signature reads topology and target token, so nothing but a genuinely
 *  identical sequence groups. */
const OUTCOMES: [string, number, number][] = [
  ["No-Showed", 12, 0],
  ["Canceled", 12, 0],
  ["Reschedule", 12, 0],
  ["Payment = No", 12, 0],
  ["Passed to Setter", 10, 1],
  ["Fake or Duplicate", 10, 1],
  ["Payment = Yes", 36, 2],
  ["Paste-Values Only Placeholder", 4, 3],
  ["None", 1, 4],
];

const SHAPED_VOCAB: [string, string][] = [
  ["google_sheets", "Append row → PCF sheet"],
  ["webhook", "POST to Data Compiler"],
  ["slack_message", "Post to #closers"],
  ["add_notes", "Note the outcome"],
  ["update_contact_field", "Stamp the outcome"],
  ["wait", "Wait 5 minutes"],
];

function collapseSummary(): ScenarioSummary {
  const modules: ModuleInfo[] = [
    ghlStep("p1", "survey_submitted", "Survey submitted", "", "trigger"),
    ghlStep("p2", "clear_fields", "Clear PCF fields", "1"),
    ghlStep("p3", "wait", "Wait 1 minute", "2"),
    ghlStep("p4", "update_contact_field", "Stamp submitted_at", "3"),
    ghlStep("p5", "google_sheets", "Look up closer Slack ID", "4"),
    ghlStep("p6", "google_sheets", "Look up setter Slack ID", "5"),
    ghlStep("p7", "update_contact_field", "Update contact fields", "6"),
    ghlStep("p8", "wait", "Wait 30 seconds", "7"),
    ghlStep("p9", "add_contact_tag", "Enrol in Data Compiler", "8"),
    ghlStep("p10", "if_else", "Appointment outcome?", "9", "router"),
  ];
  const connections: Connection[] = [];
  for (let i = 0; i < 9; i++) connections.push({ from: `p${i + 1}`, to: `p${i + 2}`, kind: "sequence" });

  OUTCOMES.forEach(([label, size, offset], arm) => {
    const letter = String.fromCharCode(65 + arm);
    const ord = `9.${letter}`;
    if (size === 12) {
      /* head → webhook → nested two-way branch (6 steps / 3 steps). */
      modules.push(
        ghlStep(`${letter}1`, "google_sheets", "Append row → PCF sheet", `${ord}.1`),
        ghlStep(`${letter}2`, "webhook", "POST to Data Compiler", `${ord}.2`),
        ghlStep(`${letter}3`, "if_else", "Setter assigned?", `${ord}.3`, "router"),
      );
      connections.push(
        { from: "p10", to: `${letter}1`, kind: "branch", label },
        { from: `${letter}1`, to: `${letter}2`, kind: "sequence" },
        { from: `${letter}2`, to: `${letter}3`, kind: "sequence" },
      );
      const yes = runOf(`${letter}y`, 6, SHAPED_VOCAB.slice(2), `${letter}3`, `${ord}.3.A`);
      const no = runOf(`${letter}n`, 3, SHAPED_VOCAB.slice(2), `${letter}3`, `${ord}.3.B`);
      yes.connections[0].label = "yes";
      no.connections[0].label = "no";
      modules.push(...yes.modules, ...no.modules);
      connections.push(...yes.connections, ...no.connections);
      return;
    }
    const run = runOf(letter.toLowerCase(), size, SHAPED_VOCAB, "p10", ord, offset);
    run.connections[0].label = label;
    modules.push(...run.modules);
    connections.push(...run.connections);
  });

  return {
    name: "PCF Submitted → Update Data Compiler - Slack",
    totalModules: modules.length,
    appsUsed: ["ghl"],
    modules,
    connections,
    nativeUrl: "https://app.gohighlevel.com/v2/location/loc1/automation/workflows/pcf-119",
    issues: [],
  };
}

export const COLLAPSE_SUMMARY: ScenarioSummary = collapseSummary();
export const COLLAPSE_VIEWED: WorkflowRef = { source: "ghl", refId: "pcf-119" };

/** The captured `GET …/shapes?scope=colocated` response for it — the real
 *  algorithm's answer, in `fixtures/collapseShapes.ts`, not a hand-written
 *  guess. Nine head tiles and five arms: 119 steps as 14 elements. */
export { COLLAPSE_SHAPES } from "./collapseShapes.ts";

/** The workflow on its own — no callers, no cross-platform links, so the
 *  canvas is exactly the fold behaviour and nothing else. */
export const COLLAPSE: PrototypeFixture = {
  viewed: COLLAPSE_VIEWED,
  linkMap: {
    workflows: [ghlCard("pcf-119", COLLAPSE_SUMMARY.name, COLLAPSE_SUMMARY.modules.length, 2 * H)],
    links: [],
    unmatched: [],
    assetLinks: [],
    stats: { workflows: 1, links: 0, deadLinks: 0 },
  },
  summaries: new Map<WorkflowKey, SummaryEntry>([["ghl:pcf-119", { state: "ok", summary: COLLAPSE_SUMMARY }]]),
};

/** Keyed the way `buildMap` wants it. */
export const COLLAPSE_SHAPE_MAP: ReadonlyMap<WorkflowKey, WorkflowShapes> = new Map([["ghl:pcf-119" as WorkflowKey, CAPTURED_SHAPES]]);

/* ── COLLAPSE_LINKED — the same workflow, calling out from its branches ──
   The shape the founder hit on live data: the webhooks that call another
   platform sit INSIDE router arms, and several arms call the SAME scenario.
   On the real workflow five arms call one Make scenario and two call
   another; the canvas used to draw one pill per scenario, for whichever
   calling arm happened to be rendered first, so a connection appeared and
   vanished depending on whether an unrelated branch was open.

   So this fixture has several call sites per target, and every kind of place
   a call can come from:
     A2 B2 C2 D2 → make:912   four arms, one scenario (mid-arm webhooks)
     e1 f1       → make:913   two arm HEADS — the step a folded card stands for
     g5          → make:915   a subflow from deep inside a long arm
     p9          → make:916   the trunk, which is always drawn
     (missing)   → make:914   a step this workflow does not have
   Fully open that is nine pills. Fully folded it is two: the trunk's, and the
   one that genuinely has no calling step to hang beside. */

const linkedCard = (refId: string, name: string): WorkflowCard =>
  makeCard(refId, name, 2, 2 * H);

const callFrom = (stepId: string, stepName: string, refId: string, kind: "webhook-call" | "subflow" = "webhook-call"): WorkflowLink => ({
  from: { source: "ghl", refId: "pcf-119", stepId, stepName },
  to: { source: "make", refId },
  kind,
  status: "ok",
});

export const COLLAPSE_LINKED: PrototypeFixture = {
  viewed: COLLAPSE_VIEWED,
  linkMap: {
    workflows: [
      ghlCard("pcf-119", COLLAPSE_SUMMARY.name, COLLAPSE_SUMMARY.modules.length, 2 * H),
      linkedCard("912", "CP - pcf_data - Clear GHL Fields"),
      linkedCard("913", "CP - pcf_data - Clear GHL Fields - Unsuccessful Calls"),
      linkedCard("914", "CP - pcf_data - Orphan"),
      linkedCard("915", "CP - pcf_data - Payment Received"),
      linkedCard("916", "PCF Submitted - update Pipeline"),
    ],
    links: [
      callFrom("A2", "POST to Data Compiler", "912"),
      callFrom("B2", "POST to Data Compiler", "912"),
      callFrom("C2", "POST to Data Compiler", "912"),
      callFrom("D2", "POST to Data Compiler", "912"),
      callFrom("e1", "POST to Data Compiler", "913"),
      callFrom("f1", "POST to Data Compiler", "913"),
      callFrom("g5", "Post to #closers", "915", "subflow"),
      callFrom("p9", "Enrol in Data Compiler", "916", "subflow"),
      callFrom("deleted-step", "Gone", "914"),
    ],
    unmatched: [],
    assetLinks: [],
    stats: { workflows: 6, links: 9, deadLinks: 0 },
  },
  summaries: new Map<WorkflowKey, SummaryEntry>([["ghl:pcf-119", { state: "ok", summary: COLLAPSE_SUMMARY }]]),
};
