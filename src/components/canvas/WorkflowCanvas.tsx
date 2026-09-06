"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { fetchWorkflowRefs, type AssetRef } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";
import { appName } from "@/lib/apps";
import { kindLabel } from "@/components/shared/AssetsSection";
import ScenarioCanvas from "./ScenarioCanvas";

/** Highlight matching steps without removing the paths that explain them. */
export function WorkflowCanvas({ provider, workflowId, revision, ...canvas }: ComponentProps<typeof ScenarioCanvas> & {
  provider: ProviderId; workflowId: string; revision: number;
}) {
  const [software, setSoftware] = useState("");
  const [trigger, setTrigger] = useState("");
  const [asset, setAsset] = useState("");
  const [refs, setRefs] = useState<AssetRef[]>([]);
  const [refsState, setRefsState] = useState("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    fetchWorkflowRefs(provider, workflowId).then(({ refs }) => {
      if (active) { setRefs(refs); setRefsState("ready"); }
    }).catch(() => { if (active) setRefsState("error"); });
    return () => { active = false; };
  }, [provider, workflowId, revision, retry]);
  const softwareOptions = [...new Set(canvas.modules.filter(m => m.kind !== "portal").map(m => m.app))].sort();
  const triggers = canvas.modules.filter(m => m.kind === "trigger");
  const triggerOptions = [...new Map(triggers.map(m => [m.module, m.label || m.summary || "Workflow trigger"])).entries()];
  const assetOptions = (() => {
    const entries = new Map<string, { label: string; nodes: Set<string> }>();
    for (const ref of refs) {
      if (ref.dynamic) continue;
      const key = JSON.stringify([ref.kind, ref.value]);
      const label = ref.label && ref.label !== ref.value ? ref.label : `${kindLabel(ref.kind)} — name unavailable`;
      const entry = entries.get(key) ?? { label, nodes: new Set<string>() };
      if (ref.node_id != null) entry.nodes.add(String(ref.node_id));
      entries.set(key, entry);
    }
    // Distinguish unresolved or duplicate names using the owning step, never an
    // ID. Count labels BEFORE mutating any — mutating inside the scan made the
    // second of each duplicate pair keep its bare, ambiguous name.
    const labelCounts = new Map<string, number>();
    for (const e of entries.values()) labelCounts.set(e.label, (labelCounts.get(e.label) ?? 0) + 1);
    for (const entry of entries.values()) {
      if ((labelCounts.get(entry.label) ?? 0) > 1 || entry.label.includes("name unavailable")) {
        const step = canvas.modules.find(m => entry.nodes.has(String(m.id)));
        if (step) entry.label += ` · ${step.label || step.summary || "Referenced step"}${step.ordinal ? ` (step ${step.ordinal})` : ""}`;
      }
    }
    return entries;
  })();
  // A trigger filter should surface the trigger AND the path it starts, not
  // leave a lone trigger node lit over a greyed workflow. Walk sequence/branch
  // edges forward from every matching trigger.
  const downstreamOf = (seedIds: Set<string>): Set<string> => {
    const reached = new Set(seedIds);
    const adj = new Map<string, string[]>();
    for (const c of canvas.connections) {
      (adj.get(String(c.from)) ?? adj.set(String(c.from), []).get(String(c.from))!).push(String(c.to));
    }
    const stack = [...seedIds];
    while (stack.length) {
      const id = stack.pop()!;
      for (const next of adj.get(id) ?? []) {
        if (!reached.has(next)) { reached.add(next); stack.push(next); }
      }
    }
    return reached;
  };

  const active = !!(software || trigger || asset);
  let matches: Set<string> | null = null;
  if (active) {
    let ids = new Set(canvas.modules.filter(m =>
      (!software || m.app === software) &&
      (!asset || assetOptions.get(asset)?.nodes.has(String(m.id)))
    ).map(m => String(m.id)));
    if (trigger) {
      const triggerNodes = new Set(canvas.modules
        .filter(m => m.kind === "trigger" && m.module === trigger)
        .map(m => String(m.id)));
      const started = downstreamOf(triggerNodes);
      // Intersect with software/asset matches when those are also active.
      ids = (software || asset) ? new Set([...ids].filter(id => started.has(id))) : started;
    }
    matches = ids;
  }
  const cls = "max-w-56 rounded-control border border-line bg-panel px-2 py-1.5 text-[12px] text-t1";
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2" aria-label="Canvas filters">
      <label className="text-[11px] text-t2">Software <select aria-label="Filter by software" className={cls} value={software} onChange={e => setSoftware(e.target.value)}><option value="">All software</option>{softwareOptions.map(app => <option key={app} value={app}>{appName(app)}</option>)}</select></label>
      <label className="text-[11px] text-t2">Trigger <select aria-label="Filter by trigger type" className={cls} value={trigger} onChange={e => setTrigger(e.target.value)}><option value="">All trigger types</option>{triggerOptions.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label>
      <label className="text-[11px] text-t2">Asset <select aria-label="Filter by asset" className={cls} value={asset} onChange={e => setAsset(e.target.value)} disabled={refsState !== "ready"}><option value="">{refsState === "loading" ? "Loading assets…" : refsState === "error" ? "Assets unavailable" : "All assets"}</option>{[...assetOptions].map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}</select></label>
      {refsState === "error" && <button type="button" className="text-[12px] underline" onClick={() => setRetry(n => n + 1)}>Retry assets</button>}
      {active && <><button type="button" className="text-[12px] underline" onClick={() => { setSoftware(""); setTrigger(""); setAsset(""); }}>Clear filters</button><span role="status" className="text-[12px] text-t2">{matches?.size} matching steps · other steps dimmed for context</span></>}
    </div>
    <div className="relative min-h-0 flex-1"><ScenarioCanvas {...canvas} matchingNodeIds={matches} /></div>
  </div>;
}
