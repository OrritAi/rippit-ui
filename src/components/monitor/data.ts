/*
 * Monitor fixtures + theme tables, ported from the design handoff
 * (Orrit Monitor v5). Real-data integration points: node metrics /
 * payloads (per-run API), feed (run event stream), timeline buckets
 * (aggregation query), pulse triggering (per real execution).
 */

import type { ProviderId } from "@/lib/connectors/types";

export type NodeStatus = "ok" | "warn" | "err" | "off";

export interface MonitorNode {
  id: string;
  cx: number;
  cy: number;
  icon: string;
  col: string;
  name: string;
  sub: string;
  /** Platform the node lives in; defaults to "make" when omitted. */
  provider?: ProviderId;
  ms: number;
  msLabel?: string;
  status: NodeStatus;
  m: { avg: string; p95: string; ops: string; cost: string; err: string };
  payload: Record<string, unknown>;
  config: [string, string][];
  runs?: { c: string; t: string; dur: string; ago: string }[];
}

export interface MonitorEdge {
  id: number;
  from: string;
  to: string;
  t0: number;
  t1: number;
  hot?: boolean;
}

export interface WorkflowRow {
  name: string;
  plats: string;
  ops: string;
  st: NodeStatus;
  spark: number[];
}

export interface FeedEntry {
  c: string;
  t: string;
  d: string;
}

export const CYCLE = 7; // seconds, master pulse cycle (÷ simSpeed)
export const WORLD = { w: 1560, h: 740 };
export const PANEL = { left: 276, right: 356, top: 60, bottom: 128 };
export const TILT_DEG = 55;
export const COS_TILT = 0.5736;

/** JS-side theme tokens (everything else lives in CSS variables). */
export const JS_THEMES = {
  dark: {
    edgeBase: "rgba(255,255,255,.12)",
    drift: "rgba(255,255,255,.35)",
    halo: "#ffffff",
    core: "#ffffff",
    ring: "#f4f4f5",
    sparkA: "#f4f4f5",
    spark: "rgba(161,161,170,.3)",
    ambient: "rgba(0,0,0,.55)",
  },
  light: {
    edgeBase: "rgba(0,0,0,.14)",
    drift: "rgba(0,0,0,.35)",
    halo: "#18181b",
    core: "#18181b",
    ring: "#18181b",
    sparkA: "#18181b",
    spark: "rgba(0,0,0,.18)",
    ambient: "rgba(0,0,0,.18)",
  },
};

/* Status colors reference the theme tokens: `dot` is the graphic role,
   `color` the readable-text role (see globals.css). */
export const ST: Record<
  NodeStatus,
  { dot: string; label: string; color: string; bg: string; border: string }
> = {
  ok: {
    dot: "var(--ok)",
    label: "Healthy",
    color: "var(--ok-text)",
    bg: "color-mix(in srgb, var(--ok) 10%, transparent)",
    border: "color-mix(in srgb, var(--ok) 30%, transparent)",
  },
  warn: {
    dot: "var(--warn)",
    label: "Retrying",
    color: "var(--warn-text)",
    bg: "color-mix(in srgb, var(--warn) 10%, transparent)",
    border: "color-mix(in srgb, var(--warn) 32%, transparent)",
  },
  err: {
    dot: "var(--err)",
    label: "Failing",
    color: "var(--err-text)",
    bg: "color-mix(in srgb, var(--err) 10%, transparent)",
    border: "color-mix(in srgb, var(--err) 32%, transparent)",
  },
  off: {
    dot: "var(--off)",
    label: "Paused",
    color: "var(--off-text)",
    bg: "color-mix(in srgb, var(--off) 10%, transparent)",
    border: "color-mix(in srgb, var(--off) 30%, transparent)",
  },
};

export const NODES: MonitorNode[] = [
  {
    id: "fb",
    cx: 156,
    cy: 352,
    icon: "FB",
    col: "#3b82f6",
    name: "Facebook Lead Ad",
    sub: "Webhook · trigger",
    ms: 0,
    msLabel: "hook",
    status: "ok",
    m: { avg: "18ms", p95: "40ms", ops: "214", cost: "$0.00", err: "0%" },
    payload: {
      lead_id: 238471,
      form: "Summer Promo — IG",
      name: "Jordan Miles",
      email: "jordan@northbeam.co",
      utm_source: "ig_story",
    },
    config: [
      ["Endpoint", "/hook/fb-leads"],
      ["Auth", "HMAC sha256"],
      ["Dedupe", "lead_id"],
      ["Queue", "instant"],
    ],
  },
  {
    id: "parse",
    cx: 396,
    cy: 352,
    icon: "M",
    col: "#8b5cf6",
    name: "Parse & Validate",
    sub: "Make · JSON parse",
    ms: 112,
    status: "ok",
    m: { avg: "112ms", p95: "340ms", ops: "214", cost: "$0.21", err: "0%" },
    payload: { valid: true, fields_mapped: 12, dropped: 0, schema: "lead.v3" },
    config: [
      ["Schema", "lead.v3"],
      ["On invalid", "route to DLQ"],
      ["Trim fields", "true"],
      ["Timeout", "10s"],
    ],
  },
  {
    id: "ai",
    cx: 636,
    cy: 232,
    icon: "AI",
    col: "#14b8a6",
    name: "AI Enrich Lead",
    sub: "OpenAI · gpt-4o",
    ms: 812,
    status: "ok",
    m: { avg: "812ms", p95: "2.1s", ops: "214", cost: "$1.84", err: "0.5%" },
    payload: {
      intent: "high",
      score: 0.87,
      company: "Northbeam Co",
      size: "11-50",
      note: "Asked about onboarding pricing",
    },
    config: [
      ["Model", "gpt-4o"],
      ["Max tokens", "2,048"],
      ["Temp", "0.2"],
      ["Fallback", "gpt-4o-mini"],
    ],
  },
  {
    id: "router",
    cx: 886,
    cy: 352,
    icon: "R",
    col: "#64748b",
    name: "Router",
    sub: "Make · 3 routes",
    ms: 4,
    status: "ok",
    m: { avg: "4ms", p95: "9ms", ops: "214", cost: "$0.11", err: "0%" },
    payload: { route: "qualified", matched: "score >= 0.7", fallthrough: false },
    config: [
      ["Route 1", "score >= 0.7 → GHL"],
      ["Route 2", "always → Sheets"],
      ["Route 3", "always → Slack"],
      ["Order", "parallel"],
    ],
  },
  {
    id: "contact",
    cx: 1156,
    cy: 192,
    icon: "HL",
    col: "#0ea5e9",
    name: "Create Contact",
    sub: "GHL · contacts.upsert",
    provider: "ghl",
    ms: 340,
    status: "ok",
    m: { avg: "340ms", p95: "900ms", ops: "186", cost: "$0.37", err: "1.1%" },
    payload: {
      contact_id: "ghl_8f3k2",
      created: true,
      dedupe: "email",
      tags: ["ig-lead", "summer-promo"],
    },
    config: [
      ["Location", "Northbeam · main"],
      ["Dedupe key", "email"],
      ["Source", "fb_lead_ad"],
      ["Owner", "round-robin"],
    ],
  },
  {
    id: "pipeline",
    cx: 1426,
    cy: 162,
    icon: "HL",
    col: "#0ea5e9",
    name: "Add to Pipeline",
    sub: "GHL · New Lead stage",
    provider: "ghl",
    ms: 288,
    status: "ok",
    m: { avg: "288ms", p95: "710ms", ops: "186", cost: "$0.37", err: "0.4%" },
    payload: {
      pipeline: "Sales",
      stage: "New Lead",
      value: "$1,200",
      owner: "Alicia R.",
    },
    config: [
      ["Pipeline", "Sales"],
      ["Stage", "New Lead"],
      ["Opportunity value", "$1,200 default"],
      ["Notify owner", "true"],
    ],
  },
  {
    id: "sms",
    cx: 1426,
    cy: 332,
    icon: "HL",
    col: "#0ea5e9",
    name: "SMS Welcome",
    sub: "GHL · Twilio SMS",
    provider: "ghl",
    ms: 1900,
    msLabel: "1.9s",
    status: "warn",
    m: { avg: "1.9s", p95: "4.2s", ops: "186", cost: "$0.86", err: "3.2%" },
    payload: {
      contact: "Jordan Miles",
      phone: "+1 (415) 555-0132",
      template: "welcome_v2",
      status: "rate_limited",
      retry: { attempt: 3, max: 5, next_in: "42s" },
      provider: "twilio",
    },
    config: [
      ["From", "+1 (415) 555-0199"],
      ["Template", "welcome_v2"],
      ["Retry policy", "5× · exp backoff"],
      ["Timeout", "30s"],
    ],
    runs: [
      { c: "#f59e0b", t: "#4,391 · retrying 3/5", dur: "1.9s", ago: "18s" },
      { c: "#22c55e", t: "#4,388 · sent", dur: "1.2s", ago: "4m" },
      { c: "#22c55e", t: "#4,384 · sent", dur: "1.1s", ago: "9m" },
      { c: "#ef4444", t: "#4,379 · timeout", dur: "30s", ago: "26m" },
      { c: "#22c55e", t: "#4,375 · sent", dur: "1.3s", ago: "31m" },
    ],
  },
  {
    id: "sheets",
    cx: 1156,
    cy: 472,
    icon: "GS",
    col: "#22c55e",
    name: "Log to Sheets",
    sub: "Sheets · append row",
    ms: 460,
    status: "ok",
    m: { avg: "460ms", p95: "1.2s", ops: "214", cost: "$0.21", err: "0%" },
    payload: { sheet: "Leads 2026", row: 1847, range: "A1847:K1847" },
    config: [
      ["Spreadsheet", "Leads 2026"],
      ["Worksheet", "raw"],
      ["Mode", "append"],
      ["Value input", "USER_ENTERED"],
    ],
  },
  {
    id: "slack",
    cx: 1156,
    cy: 632,
    icon: "#",
    col: "#d946ef",
    name: "Notify #leads",
    sub: "Slack · chat.post",
    ms: 190,
    status: "ok",
    m: { avg: "190ms", p95: "410ms", ops: "214", cost: "$0.21", err: "0%" },
    payload: { channel: "#leads", ts: "1755100212.0031", blocks: 4 },
    config: [
      ["Channel", "#leads"],
      ["As", "Orrit bot"],
      ["Blocks", "lead card v2"],
      ["Thread", "none"],
    ],
  },
];

export const EDGES: MonitorEdge[] = [
  { id: 0, from: "fb", to: "parse", t0: 0, t1: 0.6 },
  { id: 1, from: "parse", to: "ai", t0: 0.6, t1: 1.2 },
  { id: 2, from: "ai", to: "router", t0: 1.2, t1: 1.9 },
  { id: 3, from: "router", to: "contact", t0: 1.9, t1: 2.5 },
  { id: 4, from: "contact", to: "pipeline", t0: 2.5, t1: 3.1 },
  { id: 5, from: "contact", to: "sms", t0: 2.5, t1: 3.2, hot: true },
  { id: 6, from: "router", to: "sheets", t0: 1.9, t1: 2.6 },
  { id: 7, from: "router", to: "slack", t0: 1.9, t1: 2.7 },
];

export const WFS: WorkflowRow[] = [
  {
    name: "Lead Capture → Nurture",
    plats: "Make · GHL",
    ops: "1,284",
    st: "warn",
    spark: [5, 8, 6, 10, 12, 9, 14, 11, 13, 10, 14, 12],
  },
  {
    name: "Abandoned Cart Recovery",
    plats: "Make · Stripe",
    ops: "862",
    st: "ok",
    spark: [4, 6, 8, 7, 9, 6, 8, 10, 7, 9, 8, 11],
  },
  {
    name: "Client Onboarding",
    plats: "GHL · Slack",
    ops: "316",
    st: "ok",
    spark: [3, 4, 3, 5, 6, 4, 5, 7, 5, 6, 4, 6],
  },
  {
    name: "Invoice Chaser",
    plats: "Make · QuickBooks",
    ops: "—",
    st: "off",
    spark: [2, 2, 3, 2, 2, 3, 2, 2, 2, 3, 2, 2],
  },
];

export const FEED_INITIAL: FeedEntry[] = [
  { c: "#f59e0b", t: "SMS Welcome · retry 3/5", d: "queued" },
  { c: "#22c55e", t: "Run #4,391 · completed", d: "6.1s" },
  { c: "#22c55e", t: "Slack notify · #leads", d: "190ms" },
  { c: "#a1a1aa", t: "AI Enrich · 1,204 tokens", d: "812ms" },
  { c: "#22c55e", t: "Sheets append · row 1,847", d: "460ms" },
  { c: "#22c55e", t: "Run #4,390 · completed", d: "5.9s" },
];

export const FEED_OK: FeedEntry[] = [
  { c: "#22c55e", t: "Run #4,392 · completed", d: "5.8s" },
  { c: "#a1a1aa", t: "AI Enrich · 1,180 tokens", d: "790ms" },
  { c: "#22c55e", t: "Contact upsert · dedupe hit", d: "340ms" },
  { c: "#f59e0b", t: "SMS Welcome · retry 4/5", d: "queued" },
  { c: "#22c55e", t: "Slack notify · #leads", d: "186ms" },
  { c: "#22c55e", t: "Sheets append · row 1,849", d: "455ms" },
  { c: "#a1a1aa", t: 'Router · route "qualified"', d: "4ms" },
  { c: "#22c55e", t: "Run #4,393 · completed", d: "6.2s" },
];

export const FEED_BAD: FeedEntry[] = [
  { c: "#ef4444", t: "SMS Welcome · rate_limited", d: "failed" },
  { c: "#22c55e", t: "Run #4,392 · partial", d: "5.8s" },
  { c: "#ef4444", t: "SMS Welcome · retries exhausted", d: "failed" },
  { c: "#a1a1aa", t: "AI Enrich · 1,180 tokens", d: "790ms" },
  { c: "#ef4444", t: "Twilio 429 · too many requests", d: "30s" },
  { c: "#22c55e", t: "Sheets append · row 1,849", d: "455ms" },
  { c: "#f59e0b", t: "DLQ · 12 messages queued", d: "—" },
  { c: "#22c55e", t: "Slack notify · #leads", d: "186ms" },
];

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export interface JsonRow {
  pad: number;
  k: string;
  sep: string;
  v: string;
  c: string;
}

/** Flatten a payload object into syntax-colored rows (per handoff). */
export function flattenJson(
  obj: Record<string, unknown>,
  depth = 0,
  out: JsonRow[] = []
): JsonRow[] {
  Object.entries(obj).forEach(([k, v]) => {
    const pad = 14 + depth * 14;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push({ pad, k, sep: ": ", v: "{", c: "var(--jpunc)" });
      flattenJson(v as Record<string, unknown>, depth + 1, out);
      out.push({ pad, k: "", sep: "", v: "}", c: "var(--jpunc)" });
    } else {
      let s: string;
      let c: string;
      if (Array.isArray(v)) {
        s = JSON.stringify(v);
        c = "var(--jstr)";
      } else if (typeof v === "string") {
        s = `"${v}"`;
        c = "var(--jstr)";
      } else if (typeof v === "number") {
        s = String(v);
        c = "var(--jnum)";
      } else if (typeof v === "boolean") {
        s = String(v);
        c = "var(--jbool)";
      } else {
        s = "null";
        c = "var(--jpunc)";
      }
      out.push({ pad, k, sep: ": ", v: s, c });
    }
  });
  return out;
}
