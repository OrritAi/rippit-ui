"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchGraph, fetchViews, GraphData } from "@/app/lib/api";
import { parseWorkflowId, workflowHref, WorkflowRef } from "@/lib/portals";
import { isProviderId, providerColor } from "@/lib/connectors";
import { useTags } from "@/components/tags/tags-context";
import { TagFilter, matchesTags } from "@/components/tags/TagFilter";
import { SaveViewButton } from "@/components/shared/SaveViewButton";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { Segmented } from "@/components/shared/Segmented";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorCard } from "@/components/shared/ErrorCard";
import { SystemMap, cardId } from "@/components/map/SystemMap";
import { Legend } from "@/components/canvas/Legend";

/* Node-level view renders at most this many auto-selected workflows; bigger
   estates pick a linked set (readability — see rippit-docs/integrations/connector-model.md). */
const DETAIL_AUTO_MAX = 12;

type Mode = "workflows" | "nodes";

/*
 * /map — the system map. ?mode=workflows|nodes, ?focus=make:912,ghl:wf1
 * (node-level linked set), ?view=<saved view id>. Legacy /unified params
 * (view=detail) are honoured.
 */
export default function MapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { linkMap, connections, loading: connectionsLoading, refresh } = useConnections();
  const legacy = searchParams.get("view");
  const [mode, setMode] = useState<Mode>(searchParams.get("mode") === "nodes" || legacy === "detail" ? "nodes" : "workflows");
  const focus = useMemo<WorkflowRef[]>(() => {
    const raw = searchParams.get("focus") ?? "";
    return raw
      .split(",")
      .map((t) => parseWorkflowId(t.trim()))
      .filter((r): r is WorkflowRef => !!r && isProviderId(r.source));
  }, [searchParams]);
  const [graph, setGraph] = useState<{ key: string; data?: GraphData; error?: string } | null>(null);
  const [showAssets, setShowAssets] = useState(false);
  const { tags: allTags } = useTags();
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [changedOnly, setChangedOnly] = useState(false);
  const [linkedChoice, setLinkedChoice] = useState<boolean | null>(null);
  const viewId = legacy && legacy !== "detail" && legacy !== "list" && legacy !== "map" ? legacy : searchParams.get("view") && !["detail", "list", "map"].includes(searchParams.get("view")!) ? searchParams.get("view") : null;

  useEffect(() => {
    document.title = "System map — Rippit";
  }, []);

  useEffect(() => {
    if (!viewId) return;
    let live = true;
    fetchViews()
      .then((d) => {
        const v = d.views.find((x) => x.id === viewId && x.kind === "unified");
        if (!v || !live) return;
        const f = v.filters as { tags?: string[]; linkedOnly?: boolean; showAssets?: boolean; changedOnly?: boolean; mode?: string };
        if (f.tags) setTagFilter(f.tags);
        if (typeof f.linkedOnly === "boolean") setLinkedChoice(f.linkedOnly);
        if (typeof f.showAssets === "boolean") setShowAssets(f.showAssets);
        if (typeof f.changedOnly === "boolean") setChangedOnly(f.changedOnly);
        if (f.mode === "detail" || f.mode === "nodes") setMode("nodes");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [viewId]);

  const linkedOnly = linkedChoice ?? (linkMap ? linkMap.stats.links > 0 : true);
  const focusKey = focus.map((f) => `${f.source}:${f.refId}`).join(",");

  useEffect(() => {
    if (mode !== "nodes") return;
    let live = true;
    fetchGraph(focus)
      .then((d) => live && setGraph({ key: focusKey, data: d }))
      .catch((e: Error) => live && setGraph({ key: focusKey, error: e.message }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, focusKey]);
  const graphCurrent = graph && graph.key === focusKey ? graph : null;

  const linked = useMemo(() => {
    const s = new Set<string>();
    for (const l of linkMap?.links ?? []) {
      s.add(cardId(l.from));
      s.add(cardId(l.to));
    }
    return s;
  }, [linkMap]);
  const assetLinked = useMemo(() => {
    const s = new Set<string>();
    for (const a of linkMap?.assetLinks ?? []) for (const w of a.workflows) s.add(cardId(w));
    return s;
  }, [linkMap]);

  const workflows = useMemo(() => {
    if (!linkMap) return [];
    let ws = linkMap.workflows.filter((w) => matchesTags(w.tags, tagFilter) && (!changedOnly || (w.changedSince?.count ?? 0) > 0));
    if (linkedOnly) ws = ws.filter((w) => linked.has(cardId(w)) || (showAssets && assetLinked.has(cardId(w))));
    return ws;
  }, [linkMap, tagFilter, changedOnly, linkedOnly, linked, showAssets, assetLinked]);

  const setModeAndUrl = (m: Mode) => {
    setMode(m);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", m);
    url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", url.toString());
  };

  if (connectionsLoading && !linkMap) return <LoadingState message="Loading system map…" />;
  if (!linkMap && connections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-card border border-line bg-panel p-6 text-center shadow-[var(--shadow-card)] backdrop-blur-[14px] anim-fade-up">
          <h1 className="mb-1.5 text-[15px] font-semibold">Nothing connected yet</h1>
          <p className="mb-4 text-[13px] text-t2">The system map shows how your automations link across platforms. Connect Make or HighLevel to populate it.</p>
          <Link href="/settings/connections" className="text-[13px] font-semibold text-t1 underline-offset-4 hover:underline">
            Open Settings
          </Link>
        </div>
      </div>
    );
  }
  if (!linkMap) return <ErrorCard title="Failed to load system map" message="The cross-platform link map couldn’t be fetched." onRetry={refresh} />;

  const tooMany = graphCurrent?.data && focus.length === 0 && graphCurrent.data.groups.length > DETAIL_AUTO_MAX;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-[46px] flex-none items-center gap-2.5 border-b border-line px-3">
        <h1 className="text-[13.5px] font-semibold tracking-[-0.01em]">System map</h1>
        <div className="flex-1" />
        {mode === "workflows" && (
          <>
            {(linkMap.assetLinks?.length ?? 0) > 0 && (
              <Segmented label="Shared assets" value={showAssets ? "on" : "off"} options={[{ value: "off", label: "Calls" }, { value: "on", label: `+ Assets (${linkMap.assetLinks!.length})` }]} onChange={(v) => setShowAssets(v === "on")} />
            )}
            <Segmented label="Workflow filter" value={linkedOnly ? "linked" : "all"} options={[{ value: "linked", label: "Linked only" }, { value: "all", label: `All (${linkMap.stats.workflows})` }]} onChange={(v) => setLinkedChoice(v === "linked")} />
            {allTags.length > 0 && <TagFilter tags={allTags} selected={tagFilter} onChange={setTagFilter} />}
            {linkMap.workflows.some((w) => (w.changedSince?.count ?? 0) > 0) && (
              <Segmented label="Changed filter" value={changedOnly ? "changed" : "any"} options={[{ value: "any", label: "Any" }, { value: "changed", label: "Changed" }]} onChange={(v) => setChangedOnly(v === "changed")} />
            )}
            <SaveViewButton kind="unified" filters={{ tags: tagFilter, linkedOnly, showAssets, changedOnly, mode }} />
          </>
        )}
        <Segmented label="Granularity" value={mode} options={[{ value: "workflows", label: "Workflows" }, { value: "nodes", label: "Nodes" }]} onChange={setModeAndUrl} />
      </div>

      <div className="relative min-h-0 flex-1">
        {mode === "workflows" && <SystemMap mode="workflows" linkMap={linkMap} workflows={workflows} showAssets={showAssets} graph={null} />}
        {mode === "nodes" &&
          (graphCurrent?.data ? (
            graphCurrent.data.groups.length === 0 || tooMany ? (
              <div className="flex h-full items-center justify-center p-4">
                <div className="max-w-md rounded-card border border-line bg-panel p-6 text-center shadow-[var(--shadow-card)] anim-fade-up">
                  <h2 className="mb-1.5 text-[15px] font-semibold">{graphCurrent.data.groups.length === 0 ? "No linked set to show" : "Pick a linked set"}</h2>
                  <p className="text-[13px] text-t2">
                    {graphCurrent.data.groups.length === 0
                      ? "The node-level view composes workflows that call each other. Open a workflow with cross-platform links and use “View linked set”, or connect more platforms."
                      : `${graphCurrent.data.groups.length} linkable workflows is too many to read at node level. Open one of them and use “View linked set” to see just its neighbourhood.`}
                  </p>
                  {graphCurrent.data.groups.length > 0 && (
                    <ul className="mt-3 flex max-h-[40vh] flex-wrap justify-center gap-1.5 overflow-auto">
                      {graphCurrent.data.groups.map((g) => (
                        <li key={g.id}>
                          <Link href={workflowHref({ source: g.source, refId: g.refId })} className="flex items-center gap-1.5 rounded-full border border-line bg-pill px-2.5 py-1 text-[11px] font-semibold text-t2 hover:text-t1">
                            <span aria-hidden="true" className="size-[7px] rounded-[2px]" style={{ background: providerColor(g.source) }} />
                            <span className="max-w-[200px] text-left [overflow-wrap:anywhere]">{g.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <SystemMap key={`nodes:${focusKey}`} mode="nodes" linkMap={linkMap} workflows={workflows} showAssets={false} graph={graphCurrent.data} />
            )
          ) : graphCurrent?.error ? (
            <ErrorCard title="Failed to compose the linked set" message={graphCurrent.error} onRetry={() => setGraph(null)} />
          ) : (
            <LoadingState message="Composing linked workflows…" />
          ))}
        <div className="absolute bottom-8 left-3 z-[2]">
          <Legend />
        </div>
        {mode === "workflows" && focus.length > 0 && (
          <button type="button" onClick={() => router.push(`/map?mode=nodes&focus=${encodeURIComponent(focusKey)}`)} className="absolute left-3 top-3 z-[2] rounded-full border border-line bg-glass px-2.5 py-1 text-[11px] font-semibold text-t2 backdrop-blur-[8px] hover:text-t1">
            Show this linked set at node level →
          </button>
        )}
      </div>
    </div>
  );
}
