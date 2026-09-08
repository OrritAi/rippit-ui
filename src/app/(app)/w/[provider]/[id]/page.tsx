"use client";

import { useState, useEffect, useCallback, useMemo, use } from "react";
import { useSearchParams, notFound } from "next/navigation";
import Link from "next/link";
import { Activity, HeartPulse, History, Info, MessageSquare, NotebookPen } from "lucide-react";
import { fetchExecutions, fetchComments, fetchWorkflowChanges, markWorkflowSeen, setWatch } from "@/app/lib/api";
import type { Connection, ExecutionsResponse, Issue, ModuleInfo, NodeId, Tag, WorkflowChanges } from "@/app/lib/api";
import { getConnector, isProviderId } from "@/lib/connectors";
import type { WorkflowData } from "@/lib/connectors/types";
import { parsePortalId, parseLinkedNodeId, withPortals, expandLinked, WorkflowRef, type LinkedExpansion } from "@/lib/portals";
import { useConnections, useWorkflowIndex } from "@/components/app/ConnectionsProvider";
import { useAuth } from "@/components/app/AuthProvider";
import { usePaletteScope } from "@/components/palette/palette-context";
import { WorkflowCanvas } from "@/components/canvas/WorkflowCanvas";
import { ActionBar, type DockTool } from "@/components/canvas/ActionBar";
import { ConnectedChips } from "@/components/canvas/ConnectedChips";
import { CaptureNotice } from "@/components/shared/CaptureBadge";
import { DockHost, DockTitle } from "@/components/canvas/DockHost";
import { NodeInspector } from "@/components/canvas/NodeInspector";
import { HealthBody } from "@/components/canvas/HealthBody";
import { StatusLine } from "@/components/canvas/StatusLine";
import { Legend } from "@/components/canvas/Legend";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorCard } from "@/components/shared/ErrorCard";
import { RunsBody, relativeTime } from "@/components/shared/RunsPanel";
import { ChangesBody } from "@/components/shared/ChangesPanel";
import { CommentsThread } from "@/components/shared/CommentsSection";
import { NotesBody, useWorkflowMeta } from "@/components/shared/OwnerNotes";
import { InfoBody } from "@/components/shared/InfoPanel";
import { writeStored, readStored, type RecentEntry } from "@/lib/stored";

/*
 * Workflow canvas view: action bar · connected chips · banner slot · canvas
 * · status line · one right dock (node inspector | info | changes |
 * comments | runs | notes). `?step=` is the only URL state (opens the
 * inspector); `?node=` is read as an alias. Esc closes the dock.
 */
export default function WorkflowPage({ params }: { params: Promise<{ provider: string; id: string }> }) {
  const { provider, id } = use(params);
  if (!isProviderId(provider)) notFound();
  const connector = getConnector(provider);

  const searchParams = useSearchParams();
  const requestedStep = searchParams.get("step") ?? searchParams.get("node");
  const { user } = useAuth();
  const { linkMap, connections } = useConnections();
  const index = useWorkflowIndex();

  const [data, setData] = useState<WorkflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // The single dock occupant.
  const [tool, setTool] = useState<DockTool | null>(null);
  // Portals expanded inline on the canvas (keyed by portal id), plus the linked
  // workflow summaries loaded for them.
  const [expandedPortals, setExpandedPortals] = useState<Set<string>>(new Set());
  const [linkedSummaries, setLinkedSummaries] = useState<Record<string, { modules: ModuleInfo[]; connections: Connection[] }>>({});
  const [selectedId, setSelectedId] = useState<NodeId | null>(null);
  const [nodeDetail, setNodeDetail] = useState<unknown | null>(null);
  const [nodeError, setNodeError] = useState(false);
  const [nodeLoading, setNodeLoading] = useState(false);

  const [runs, setRuns] = useState<ExecutionsResponse | null>(null);
  const [changes, setChanges] = useState<WorkflowChanges | null>(null);
  const [wfTags, setWfTags] = useState<Tag[] | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [wfOpenComments, setWfOpenComments] = useState(0);
  const [commentGen, setCommentGen] = useState(0);
  const [zoom, setZoom] = useState(1);
  const { meta: wfMeta, setMeta: setWfMeta } = useWorkflowMeta(provider, id);

  const self: WorkflowRef = useMemo(() => ({ source: provider, refId: id }), [provider, id]);
  const myCard = useMemo(() => linkMap?.workflows.find((w) => w.source === provider && w.refId === id) ?? null, [linkMap, provider, id]);
  const indexEntry = useMemo(() => index.find((w) => w.provider === provider && w.refId === id) ?? null, [index, provider, id]);
  const connection = useMemo(() => connections.find((c) => c.id === indexEntry?.connectionId) ?? connections.find((c) => c.provider === provider) ?? null, [connections, indexEntry, provider]);
  const accountTitle = `${connector.shortLabel} · ${connection?.displayName ?? connector.label}`;

  /* ---------- loads ---------- */

  useEffect(() => {
    setLoading(true);
    setError("");
    connector
      .loadWorkflow(id)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, id, reloadKey]);

  // Load the linked workflow behind each expanded portal (once) for inline
  // rendering; a failed load quietly collapses that portal.
  useEffect(() => {
    for (const pid of expandedPortals) {
      if (linkedSummaries[pid]) continue;
      const ref = parsePortalId(pid);
      if (!ref) continue;
      getConnector(ref.source)
        .loadWorkflow(ref.refId)
        .then((wd) => setLinkedSummaries((m) => ({ ...m, [pid]: wd.summary })))
        .catch(() => setExpandedPortals((s) => { const n = new Set(s); n.delete(pid); return n; }));
    }
  }, [expandedPortals, linkedSummaries]);

  useEffect(() => {
    if (myCard) setWfTags(myCard.tags ?? []);
  }, [myCard]);

  // Runs up front (Make): the canvas marks the failing module, the inspector
  // shows workflow-level runtime, the action bar shows last run.
  useEffect(() => {
    if (provider !== "make") return;
    let live = true;
    fetchExecutions(provider, id)
      .then((d) => live && setRuns(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [provider, id, reloadKey]);

  useEffect(() => {
    if (!data) return;
    document.title = `${data.summary.name} — Rippit`;
    const prev = readStored<RecentEntry[]>("rippit.recent", []);
    const next: RecentEntry[] = [{ provider, id, name: data.summary.name, at: Date.now() }, ...prev.filter((r) => !(r.provider === provider && r.id === id))].slice(0, 8);
    writeStored("rippit.recent", next);
    window.dispatchEvent(new Event("rippit:recent"));
  }, [data, provider, id]);

  useEffect(() => {
    let live = true;
    Promise.all([fetchComments({ prefix: `node:${provider}:${id}:` }), fetchComments({ target: `wf:${provider}:${id}` })])
      .then(([nodes, wf]) => {
        if (!live) return;
        const byNode: Record<string, number> = {};
        for (const [key, c] of Object.entries(nodes.counts)) {
          const nodeId = key.slice(`node:${provider}:${id}:`.length);
          if (c.open > 0) byNode[nodeId] = c.open;
        }
        setCommentCounts(byNode);
        setWfOpenComments(wf.counts[`wf:${provider}:${id}`]?.open ?? 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [provider, id, commentGen]);

  useEffect(() => {
    let live = true;
    fetchWorkflowChanges(provider, id)
      .then((d) => {
        if (!live) return;
        const lastSeen = d.lastSeenAt;
        setChanges({ ...d, changes: d.changes.map((c) => ({ ...c, unseen: !lastSeen || c.detectedAt > lastSeen })) });
        markWorkflowSeen(provider, id).catch(() => {});
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [provider, id, reloadKey]);

  /* ---------- derived canvas data ---------- */

  const changedNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of changes?.changes ?? []) {
      if (!c.unseen) continue;
      if (c.nodeId) s.add(String(c.nodeId));
      const ids = c.after?.nodeIds;
      if (Array.isArray(ids)) for (const n of ids) s.add(String(n));
    }
    return s;
  }, [changes]);

  const runtimeIssueByNode = useMemo(() => {
    const latest = runs?.executions?.[0];
    if (!latest || latest.status !== "error" || !latest.causeModuleId) return new Map<string, Issue>();
    return new Map<string, Issue>([
      [
        String(latest.causeModuleId),
        {
          code: "last-run-failed",
          severity: "error",
          provider,
          workflowExternalId: id,
          nodeId: latest.causeModuleId,
          message: `Last run failed here${latest.errorMessage ? `: ${latest.errorMessage}` : ""}`,
          data: { executionId: latest.executionId, startedAt: latest.startedAt, runtime: true },
        },
      ],
    ]);
  }, [runs, provider, id]);

  // Everything the Health dock lists: structural issues from the sync plus
  // the failing-module issue from the latest run, worst handled by the dock.
  const healthIssues = useMemo(() => [...runtimeIssueByNode.values(), ...(data?.summary.issues ?? [])], [data, runtimeIssueByNode]);

  const capture = useMemo(
    () => linkMap?.workflows.find((w) => w.source === self.source && String(w.refId) === String(self.refId))?.capture,
    [linkMap, self]
  );

  const canvasData = useMemo(() => {
    if (!data) return null;
    const base = withPortals(data.summary, linkMap, self);
    const hasComments = Object.keys(commentCounts).length > 0;
    const overlaid =
      runtimeIssueByNode.size === 0 && changedNodeIds.size === 0 && !hasComments
        ? base
        : {
            ...base,
            modules: base.modules.map((m) => {
              const extra = runtimeIssueByNode.get(String(m.id));
              const changed = changedNodeIds.has(String(m.id));
              const cc = commentCounts[String(m.id)];
              if (!extra && !changed && !cc) return m;
              const existing = (m.issues ?? []).filter((i) => i.code !== "last-run-failed");
              return { ...m, ...(changed ? { changed: true } : {}), ...(cc ? { commentCount: cc } : {}), ...(extra ? { issues: [extra, ...existing] } : {}) };
            }),
          };
    // Append the steps of any inline-expanded linked workflow.
    const expansions = [...expandedPortals]
      .map((pid) => {
        const ref = parsePortalId(pid);
        const summary = linkedSummaries[pid];
        return ref && summary ? { ref, modules: summary.modules, connections: summary.connections } : null;
      })
      .filter((e): e is LinkedExpansion => e !== null);
    return expandLinked(overlaid, expansions);
  }, [data, linkMap, self, runtimeIssueByNode, changedNodeIds, commentCounts, expandedPortals, linkedSummaries]);

  // Per-step run line: only what we actually know (the failing module).
  const runStats = useMemo(() => {
    const latest = runs?.executions?.[0];
    if (!latest || latest.status !== "error" || !latest.causeModuleId) return undefined;
    return { [String(latest.causeModuleId)]: { text: `failed here${latest.durationMs != null ? ` · ${latest.durationMs}ms` : ""}`, failing: true } };
  }, [runs]);

  /* ---------- dock ---------- */

  const setStepParam = useCallback((step: NodeId | null) => {
    const url = new URL(window.location.href);
    if (step == null) {
      url.searchParams.delete("step");
      url.searchParams.delete("node");
    } else {
      url.searchParams.set("step", String(step));
      url.searchParams.delete("node");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  const selectNode = useCallback(
    (nodeId: NodeId) => {
      const portal = parsePortalId(nodeId);
      if (portal) {
        // Toggle inline expansion of the linked workflow on the canvas.
        const pid = String(nodeId);
        setTool(null);
        setSelectedId(null);
        setStepParam(null);
        setExpandedPortals((cur) => {
          const next = new Set(cur);
          if (next.has(pid)) next.delete(pid);
          else next.add(pid);
          return next;
        });
        return;
      }
      setTool(null);
      setSelectedId(nodeId);
      setStepParam(nodeId);
      setNodeLoading(true);
      setNodeDetail(null);
      setNodeError(false);
      // A namespaced id belongs to an inline-expanded linked workflow; a bare id
      // is this workflow's own step.
      const linked = parseLinkedNodeId(nodeId);
      const targetRef = linked?.ref ?? self;
      const targetNode = linked?.nodeId ?? String(nodeId);
      getConnector(targetRef.source)
        .fetchNodeDetail(targetRef.refId, targetNode)
        .then(setNodeDetail)
        .catch(() => setNodeError(true))
        .finally(() => setNodeLoading(false));
    },
    [self, setStepParam]
  );

  const closeNode = useCallback(() => {
    setSelectedId(null);
    setNodeDetail(null);
    setNodeError(false);
    setNodeLoading(false);
    setStepParam(null);
  }, [setStepParam]);

  const openTool = useCallback(
    (t: DockTool) => {
      setTool((cur) => {
        const next = cur === t ? null : t;
        if (next) {
          setSelectedId(null);
          setNodeDetail(null);
          setStepParam(null);
        }
        return next;
      });
    },
    [setStepParam]
  );

  const closeTool = useCallback(() => {
    setTool((cur) => {
      if (cur === "comments") setCommentGen((g) => g + 1);
      return null;
    });
  }, []);

  // Deep link: /w/{p}/{id}?step=<id> selects that node once loaded.
  useEffect(() => {
    if (!data || !requestedStep) return;
    const match = data.summary.modules.find((m) => String(m.id) === requestedStep);
    if (match && String(selectedId) !== String(match.id)) selectNode(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, requestedStep]);

  usePaletteScope(
    useMemo(
      () =>
        data
          ? {
              label: data.summary.name,
              nodes: data.summary.modules.map((m) => ({ id: m.id, label: m.label || m.summary || m.module })),
              onSelect: selectNode,
            }
          : null,
      [data, selectNode]
    )
  );

  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [changesReload, setChangesReload] = useState(0);

  // Manual sync: live-fetch through the connector (also refreshes the stored
  // copy server-side), then re-pull runs + changes so everything reflects it.
  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshNotice(null);
    Promise.all([
      connector.loadWorkflow(id, true).then(d => { setData(d); setRefreshNotice(d.summary.historyWarning ?? null); }),
      provider === "make" ? fetchExecutions(provider, id).then(setRuns).catch(() => {}) : Promise.resolve(),
    ])
      .catch(() => setRefreshNotice("Could not refresh this workflow. Showing the last loaded version."))
      .finally(() => {
        fetchWorkflowChanges(provider, id)
          .then((d) => {
            const lastSeen = d.lastSeenAt;
            setChanges({ ...d, changes: d.changes.map((c) => ({ ...c, unseen: !lastSeen || c.detectedAt > lastSeen })) });
          })
          .catch(() => {});
        setChangesReload((g) => g + 1);
        setRefreshing(false);
      });
  }, [connector, id, provider]);

  const toggleWatch = useCallback(() => {
    const next = !wfMeta?.watching;
    setWatch(`wf:${provider}:${id}`, next)
      .then((r) => setWfMeta((m) => (m ? { ...m, watching: r.watching } : m)))
      .catch(() => {});
  }, [wfMeta, provider, id, setWfMeta]);

  /* ---------- render ---------- */

  if (loading) return <LoadingState message={`Loading ${connector.nouns.workflow}…`} />;
  if (error) return <ErrorCard title={`Failed to load ${connector.nouns.workflow}`} message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!data) return null;

  const { summary, meta } = data;
  const nativeUrl = summary.nativeUrl ?? connector.nativeUrl?.(id) ?? null;
  const issueCounts = healthIssues.reduce((acc, i) => ({ ...acc, [i.severity]: acc[i.severity] + 1 }), { error: 0, warn: 0, info: 0 });
  const lastRun = runs?.executions?.[0] ?? null;
  const linkMapLastRun = myCard?.lastRun;
  const lastRunAt = lastRun?.startedAt ?? linkMapLastRun?.at ?? null;
  const lastRunStatus = lastRun?.status ?? linkMapLastRun?.status ?? null;
  const live = meta.statusPill.tone === "ok" && (!!lastRunAt ? Date.now() - new Date(lastRunAt).getTime() < 24 * 3600 * 1000 : provider !== "make");
  const metaLine = [
    connection?.lastSyncedAt ? `synced ${relativeTime(connection.lastSyncedAt)}` : null,
    provider === "make" && lastRunAt ? `last run ${relativeTime(lastRunAt)}${lastRunStatus && lastRunStatus !== "success" ? ` · ${lastRunStatus}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const selectedModule = selectedId != null ? (canvasData ?? summary).modules.find((m) => String(m.id) === String(selectedId)) ?? null : null;
  // A selected linked node carries its own provider/workflow; host nodes use this page's.
  const selectedRef = selectedId != null ? parseLinkedNodeId(selectedId)?.ref ?? self : null;
  const selectedIsHost = !!selectedRef && selectedRef.source === self.source && String(selectedRef.refId) === String(self.refId);

  const linkedSetHref = (() => {
    if (!linkMap) return null;
    const keys = new Set<string>([`${self.source}:${self.refId}`]);
    for (const l of linkMap.links) {
      const touches = (l.from.source === self.source && l.from.refId === self.refId) || (l.to.source === self.source && l.to.refId === self.refId);
      if (!touches) continue;
      keys.add(`${l.from.source}:${l.from.refId}`);
      keys.add(`${l.to.source}:${l.to.refId}`);
    }
    return keys.size > 1 ? `/map?mode=nodes&focus=${encodeURIComponent([...keys].join(","))}` : null;
  })();
  const mapHref = `/map?focus=${encodeURIComponent(`${provider}:${id}`)}`;
  const folderPath = indexEntry?.groupPath?.slice(-1)[0] ?? null;
  const needsReauth = connection?.status === "needs_reauth";
  const dockOpen = selectedId != null || tool != null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ActionBar
        app={provider}
        name={summary.name}
        statusPill={meta.statusPill}
        live={live}
        changes={changes?.unseen ?? 0}
        ownerName={wfMeta?.ownerName ?? null}
        ownerIsYou={!!wfMeta?.ownerUserId && wfMeta.ownerUserId === user?.id}
        onOwner={() => openTool("info")}
        watching={!!wfMeta?.watching}
        onToggleWatch={toggleWatch}
        onRefresh={refresh}
        refreshing={refreshing}
        meta={metaLine || null}
        tools={[
          {
            id: "health",
            label: "Health — issues & failing steps",
            badge: issueCounts.error + issueCounts.warn > 0 ? issueCounts.error + issueCounts.warn : lastRunStatus === "error" || lastRunStatus === "incomplete" ? "!" : null,
            tone: issueCounts.error > 0 || lastRunStatus === "error" || lastRunStatus === "incomplete" ? "err" : "warn",
          },
          { id: "info", label: "Info — owner, tags, stats", badge: wfTags && wfTags.length > 0 ? wfTags.length : null, tone: "t1" },
          { id: "changes", label: "Changes", badge: changes && changes.unseen > 0 ? changes.unseen : null, tone: "info" },
          { id: "comments", label: "Comments", badge: wfOpenComments > 0 ? wfOpenComments : null, tone: "t1" },
          { id: "runs", label: "Runs", hidden: provider !== "make", badge: lastRunStatus === "error" || lastRunStatus === "incomplete" ? "!" : null, tone: "err" },
          { id: "notes", label: "Notes", dot: !!wfMeta?.notes, tone: "ok" },
        ]}
        activeTool={tool}
        onTool={openTool}
        mapHref={mapHref}
        nativeUrl={nativeUrl}
        providerLabel={connector.shortLabel}
        accountTitle={accountTitle}
      />

      {needsReauth && (
        <div role="status" className="flex flex-none items-center gap-2 border-b border-line2 px-3 py-1.5 text-[12px] text-warn-text" style={{ background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
          This connection’s session expired — data shown is from the last successful sync.
          <Link href="/settings/connections" className="font-semibold underline-offset-2 hover:underline">
            Reconnect →
          </Link>
        </div>
      )}

      {/* States plainly when what is on screen is not what is in the platform:
          the canvas below is only as trustworthy as the last capture. */}
      {capture && (
        <div className="px-3 pb-2">
          <CaptureNotice capture={capture} />
        </div>
      )}

      {refreshNotice && <p role="alert" className="border-b border-line px-3 py-2 text-[12px] text-warn-text">{refreshNotice}</p>}
      <ConnectedChips linkMap={linkMap} self={self} />

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <WorkflowCanvas
            key={`${provider}:${id}`}
            provider={provider}
            workflowId={id}
            revision={changesReload}
            modules={(canvasData ?? summary).modules}
            connections={(canvasData ?? summary).connections}
            selectedId={selectedId}
            onNodeClick={selectNode}
            live={live && provider === "make"}
            dockOpen={dockOpen}
            runStats={runStats}
            onZoomChange={setZoom}
          />
          <StatusLine parts={[accountTitle, folderPath, `${summary.totalModules} ${connector.nouns.stepPlural}`]} zoom={zoom} />
          <div className="absolute bottom-8 left-3 z-[2]">
            <Legend />
          </div>

          {summary.stepsUnavailable && (
            <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center p-4">
              <div className="pointer-events-auto max-w-md rounded-card border border-line bg-panel p-5 text-center shadow-[var(--shadow-card)] backdrop-blur-[14px]">
                <h2 className="mb-1.5 text-[14px] font-semibold">Steps unavailable via OAuth</h2>
                <p className="text-[13px] text-t2">
                  HighLevel&apos;s official API returns workflow names and status only. Connect this location with the Rippit Chrome extension to see its steps, triggers and links here.
                </p>
                <Link href="/settings/connections" className="mt-3 inline-block text-[13px] font-semibold underline-offset-4 hover:underline">
                  Open Settings → Connections
                </Link>
              </div>
            </div>
          )}

          {/* ---- the dock: exactly one occupant ---- */}
          {selectedModule && (
            <NodeInspector
              provider={selectedRef?.source ?? provider}
              workflowId={selectedRef?.refId ?? id}
              module={selectedModule}
              detail={nodeDetail}
              loading={nodeLoading}
              error={nodeError}
              executions={selectedIsHost && provider === "make" ? runs : null}
              nativeUrl={nativeUrl}
              watching={!!wfMeta?.watching}
              onToggleWatch={toggleWatch}
              onClose={closeNode}
              onOpenRuns={() => openTool("runs")}
              commentCount={commentCounts[String(selectedModule.id)] ?? 0}
              onCommentsChanged={(open) => setCommentCounts((c) => ({ ...c, [String(selectedModule.id)]: open }))}
            />
          )}
          {tool === "health" && (
            <DockHost
              label="Workflow health"
              dockKey="health"
              onClose={closeTool}
              header={
                <DockTitle
                  icon={<HeartPulse className="size-3.5" />}
                  title="Health"
                  subtitle={issueCounts.error + issueCounts.warn > 0 ? `${issueCounts.error} error${issueCounts.error === 1 ? "" : "s"} · ${issueCounts.warn} warning${issueCounts.warn === 1 ? "" : "s"}` : "no issues detected"}
                />
              }
            >
              <HealthBody
                issues={healthIssues}
                modules={summary.modules}
                lastRun={lastRunAt ? { status: lastRunStatus ?? "unknown", at: lastRunAt } : null}
                onSelectNode={(n) => {
                  const match = summary.modules.find((m) => String(m.id) === String(n));
                  if (match) selectNode(match.id);
                }}
              />
            </DockHost>
          )}
          {tool === "info" && (
            <DockHost label="Workflow info" dockKey="info" onClose={closeTool} header={<DockTitle icon={<Info className="size-3.5" />} title={summary.name} subtitle={accountTitle} />}>
              <InfoBody
                provider={provider}
                externalId={id}
                stats={connector.headerStats(data)}
                issueCounts={issueCounts}
                nativeUrl={nativeUrl}
                linkedSetHref={linkedSetHref}
                tags={wfTags ?? []}
                onTagsChange={setWfTags}
                meta={wfMeta}
                onMetaChange={(m) => (typeof m === "function" ? setWfMeta(m) : setWfMeta(m))}
                lastRun={lastRun}
                linkMapLastRun={linkMapLastRun}
              />
            </DockHost>
          )}
          {tool === "changes" && (
            <DockHost label="Changes" dockKey="changes" onClose={closeTool} header={<DockTitle icon={<History className="size-3.5" />} title="Changes" subtitle={<span title="Snapshot diff at every sync, detected by Rippit — who/when comes from the platform's edit log where available.">{changes?.versions?.length ? `rev ${changes.versions[0].version}` : "snapshot diff"}</span>} />}>
              <ChangesBody
                provider={provider}
                externalId={id}
                reloadToken={changesReload}
                onSelectNode={(n) => {
                  const match = summary.modules.find((m) => String(m.id) === String(n));
                  if (match) selectNode(match.id);
                }}
                onData={(d) => setChanges(d)}
              />
            </DockHost>
          )}
          {tool === "comments" && (
            <DockHost label="Workflow comments" dockKey="comments" onClose={closeTool} header={<DockTitle icon={<MessageSquare className="size-3.5" />} title="Comments" subtitle="on this workflow · step threads live in each step" />}>
              <div className="p-3">
                <CommentsThread targetType="workflow" targetKey={`wf:${provider}:${id}`} onCountChange={(open) => setWfOpenComments(open)} />
              </div>
            </DockHost>
          )}
          {tool === "runs" && (
            <DockHost label="Recent runs" dockKey="runs" onClose={closeTool} header={<DockTitle icon={<Activity className="size-3.5" />} title="Recent runs" subtitle={`${connector.shortLabel} · status, timing, failing step`} />}>
              <RunsBody
                provider={provider}
                externalId={id}
                onSelectNode={(n) => {
                  const match = summary.modules.find((m) => String(m.id) === String(n));
                  if (match) selectNode(match.id);
                }}
                onData={setRuns}
              />
            </DockHost>
          )}
          {tool === "notes" && (
            <DockHost label="Notes" dockKey="notes" onClose={closeTool} header={<DockTitle icon={<NotebookPen className="size-3.5" />} title="Notes" subtitle="pinned runbook · shared with the workspace" />}>
              <NotesBody provider={provider} externalId={id} meta={wfMeta} onChange={setWfMeta} />
            </DockHost>
          )}
        </div>
      </div>
    </div>
  );
}
