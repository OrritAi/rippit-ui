"use client";

import { CircleCheck, CircleDashed, CircleSlash } from "lucide-react";
import type { CoverageState } from "@/app/lib/api";

/*
 * Coverage chips — one per facet, stating what Orrit has for this funnel.
 * The reason sits in the tooltip. `compact` drops the card frame for a
 * view bar or a list card; the labels stay so the state is never a bare icon.
 */

const LABEL: Record<string, string> = {
  // graph facets
  workflowStructure: "Workflows",
  pageNavigation: "Pages",
  pageContent: "Screenshots",
  surveyLogic: "Survey logic",
  browserTracking: "Browser tracking",
  serverConversions: "Server conversions",
  runtimeDelivery: "Runtime delivery",
  // list facets
  pages: "Pages",
  screenshots: "Screenshots",
  automations: "Workflows",
  tracking: "Tracking",
};

const STATE_LABEL: Record<CoverageState["state"], string> = {
  captured: "captured",
  partial: "partially captured",
  "not-captured": "not captured",
};

export function CoverageChips({ coverage, compact = false, className = "" }: { coverage: Record<string, CoverageState>; compact?: boolean; className?: string }) {
  const entries = Object.entries(coverage);
  if (entries.length === 0) return null;
  const chips = entries.map(([facet, state]) => (
    <span
      key={facet}
      title={state.reason ?? `${LABEL[facet] ?? facet}: ${STATE_LABEL[state.state]}`}
      className={`inline-flex items-center gap-1 rounded-full border border-line2 text-t2 ${compact ? "px-1.5 py-[2px] text-[10px]" : "px-2.5 py-1 text-[11px]"}`}
    >
      <CoverageIcon state={state.state} />
      {LABEL[facet] ?? facet}
      <span className="sr-only">: {STATE_LABEL[state.state]}</span>
    </span>
  ));
  if (compact) return <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>{chips}</span>;
  return <div className={`flex flex-wrap gap-2 rounded-card border border-line bg-panel p-3 ${className}`}>{chips}</div>;
}

function CoverageIcon({ state }: { state: CoverageState["state"] }) {
  if (state === "captured") return <CircleCheck aria-hidden="true" className="size-3 text-ok-text" />;
  if (state === "partial") return <CircleDashed aria-hidden="true" className="size-3 text-warn-text" />;
  return <CircleSlash aria-hidden="true" className="size-3 text-t3" />;
}
