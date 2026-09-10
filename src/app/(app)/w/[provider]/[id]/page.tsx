"use client";

import { useState, useEffect, useCallback, useMemo, use } from "react";
import { useSearchParams, notFound } from "next/navigation";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { fetchExecutions, fetchComments, fetchWorkflowChanges, markWorkflowSeen } from "@/app/lib/api";
import type { ExecutionsResponse, NodeId, WorkflowChanges } from "@/app/lib/api";
import { getConnector, isProviderId } from "@/lib/connectors";
import type { WorkflowData } from "@/lib/connectors/types";
import { WorkflowRef } from "@/lib/portals";
import { useConnections, useWorkflowIndex } from "@/components/app/ConnectionsProvider";
import { usePaletteScope } from "@/components/palette/palette-context";
import { ActionBar, type DockTool } from "@/components/canvas/ActionBar";
import { CaptureNotice } from "@/components/shared/CaptureBadge";
import { DockHost, DockTitle } from "@/components/canvas/DockHost";
import { WorkflowMap, type StepRequest } from "@/components/workflowMap/WorkflowMap";
import { SIDEBAR_W } from "@/lib/workflowMap/tokens";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorCard } from "@/components/shared/ErrorCard";
import { relativeTime } from "@/components/shared/RunsPanel";
import { toast } from "sonner";
import { useNow } from "@/hooks/useNow";
import { CommentsThread } from "@/components/shared/CommentsSection";
import { writeStored, readStored, type RecentEntry } from "@/lib/stored";

/*
 * Workflow view: header · notice rows · the workflow map (callers unfold
 * into the viewed workflow; nodes select into a 322px sidebar). The header
 * carries Sync and Comments only; the Comments dock shares the map's right
 * slot with the node sidebar — one occupant at a time. (Health, info,
 * changes, runs and notes docks exist in the codebase but are not mounted
 * here: the canvas is the page.)
 * `?step=` is the only URL state (`?node=` is read as an alias): it selects
 * that step of the viewed workflow; the palette and dock rows select
 * through the same request. Esc closes whichever occupant is open.
 */
export default function WorkflowPage({ params }: { params: Promise<{ provider: string; id: string }> }) {
  const { provider, id } = use(params);
  if (!isProviderId(provider)) notFound();
  const connector = getConnector(provider);

  const searchParams = useSearchParams();
  const requestedStep = searchParams.get("step") ?? searchParams.get("node");
  const { linkMap, connections } = useConnections();
  const index = useWorkflowIndex();

  const [data, setData] = useState<WorkflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // The right slot's tool occupant (the node sidebar is the map's own).
  const [tool, setTool] = useState<DockTool | null>(null);
  // Step selection requests into the map (deep link, palette, dock rows).
  const [stepRequest, setStepRequest] = useState<StepRequest | null>(() => (requestedStep ? { id: requestedStep, gen: 0 } : null));

  const [runs, setRuns] = useState<ExecutionsResponse | null>(null);
  const [changes, setChanges] = useState<WorkflowChanges | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [wfOpenComments, setWfOpenComments] = useState(0);
  const [commentGen, setCommentGen] = useState(0);

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

  // Runs up front (Make): the sidebar shows workflow-level runtime and the
  // failing step, the header shows last run.
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

  /* ---------- derived ---------- */

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


  const capture = useMemo(
    () => linkMap?.workflows.find((w) => w.source === self.source && String(w.refId) === String(self.refId))?.capture,
    [linkMap, self]
  );

  const marks = useMemo(() => ({ changed: changedNodeIds, comments: commentCounts }), [changedNodeIds, commentCounts]);

  /* ---------- selection + docks ---------- */

  const setStepParam = useCallback((step: string | null) => {
    const url = new URL(window.location.href);
    if (step == null) {
      url.searchParams.delete("step");
      url.searchParams.delete("node");
    } else {
      url.searchParams.set("step", step);
      url.searchParams.delete("node");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  // Select one of this workflow's steps on the map (palette, dock rows).
  const selectStep = useCallback((nodeId: NodeId) => {
    setTool(null);
    setStepRequest({ id: String(nodeId), gen: Date.now() });
  }, []);

  const closeTool = useCallback(() => {
    setTool((cur) => {
      if (cur === "comments") setCommentGen((g) => g + 1);
      return null;
    });
  }, []);

  const openTool = useCallback(
    (t: DockTool) => {
      setTool((cur) => {
        const next = cur === t ? null : t;
        if (cur === "comments" && next !== "comments") setCommentGen((g) => g + 1);
        if (next) setStepParam(null);
        return next;
      });
    },
    [setStepParam]
  );

  // A node selection on the map takes the right slot from any open tool.
  const onSelectNode = useCallback(() => closeTool(), [closeTool]);

  usePaletteScope(
    useMemo(
      () =>
        data
          ? {
              label: data.summary.name,
              nodes: data.summary.modules.map((m) => ({ id: m.id, label: m.label || m.summary || m.module })),
              onSelect: selectStep,
            }
          : null,
      [data, selectStep]
    )
  );

  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();

  // Manual sync: live-fetch through the connector (also refreshes the stored
  // copy server-side), then re-pull runs + changes so everything reflects it.
  const refresh = useCallback(() => {
    setRefreshing(true);
    const label = connector.shortLabel;
    const work = connector.loadWorkflow(id, true).then((d) => {
      setData(d);
      return d;
    });
    toast.promise(work, {
      loading: `Syncing from ${label}…`,
      success: (d) =>
        d.summary.historyWarning
          ? { message: "Synced, but history was not updated", description: d.summary.historyWarning }
          : { message: `Synced from ${label}`, description: "Up to date · just now" },
      error: (e: unknown) => ({
        message: `Could not sync from ${label}`,
        description: e instanceof Error && e.message ? e.message : "Showing the last loaded version.",
      }),
    });
    work
      .then(() => {
        if (provider === "make") fetchExecutions(provider, id).then(setRuns).catch(() => {});
        fetchWorkflowChanges(provider, id)
          .then((d) => {
            const lastSeen = d.lastSeenAt;
            setChanges({ ...d, changes: d.changes.map((c) => ({ ...c, unseen: !lastSeen || c.detectedAt > lastSeen })) });
          })
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [connector, id, provider]);

  /* ---------- render ---------- */

  if (loading) return <LoadingState message={`Loading ${connector.nouns.workflow}…`} />;
  if (error) return <ErrorCard title={`Failed to load ${connector.nouns.workflow}`} message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!data) return null;

  const { summary, meta } = data;
  const nativeUrl = summary.nativeUrl ?? connector.nativeUrl?.(id) ?? null;
  const lastRun = runs?.executions?.[0] ?? null;
  const linkMapLastRun = myCard?.lastRun;
  const lastRunAt = lastRun?.startedAt ?? linkMapLastRun?.at ?? null;
  const lastRunStatus = lastRun?.status ?? linkMapLastRun?.status ?? null;
  const live = meta.statusPill.tone === "ok" && (!!lastRunAt ? Date.now() - new Date(lastRunAt).getTime() < 24 * 3600 * 1000 : provider !== "make");
  const checkedAt = summary.checkedAt ?? connection?.lastSyncedAt ?? null;
  const metaLine = [
    checkedAt ? `synced ${relativeTime(checkedAt, now)}` : null,
    provider === "make" && lastRunAt ? `last run ${relativeTime(lastRunAt, now)}${lastRunStatus && lastRunStatus !== "success" ? ` · ${lastRunStatus}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const needsReauth = connection?.status === "needs_reauth";

  const dockProps = { inline: true, width: SIDEBAR_W, onClose: closeTool } as const;
  const rightSlot =
    tool === "comments" ? (
      <DockHost {...dockProps} label="Workflow comments" dockKey="comments" header={<DockTitle icon={<MessageSquare className="size-3.5" />} title="Comments" subtitle="on this workflow · step threads live in each step" />}>
        <div className="p-3">
          <CommentsThread targetType="workflow" targetKey={`wf:${provider}:${id}`} onCountChange={(open) => setWfOpenComments(open)} />
        </div>
      </DockHost>
    ) : null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ActionBar
        app={provider}
        name={summary.name}
        statusPill={meta.statusPill}
        live={live}
        changes={changes?.unseen ?? 0}
        onRefresh={refresh}
        refreshing={refreshing}
        meta={metaLine || null}
        tools={[{ id: "comments", label: "Comments", badge: wfOpenComments > 0 ? wfOpenComments : null, tone: "t1" }]}
        activeTool={tool}
        onTool={openTool}
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
          the map below is only as trustworthy as the last capture. */}
      {capture && (
        <div className="px-3 pb-2">
          <CaptureNotice capture={capture} />
        </div>
      )}

      {summary.stepsUnavailable && (
        <p role="status" className="flex flex-none flex-wrap items-center gap-x-2 border-b border-line2 px-3 py-1.5 text-[12px] text-t2">
          <span className="font-semibold text-t1">Steps unavailable via OAuth.</span>
          HighLevel&apos;s official API returns workflow names and status only. Connect this location with the Rippit Chrome extension to see its steps, triggers and links here.
          <Link href="/settings/connections" className="font-semibold underline-offset-2 hover:underline">
            Open Settings → Connections
          </Link>
        </p>
      )}

      <WorkflowMap
        key={`${provider}:${id}`}
        viewed={self}
        linkMap={linkMap}
        seedSummary={summary}
        runs={runs}
        stepRequest={stepRequest}
        onStepParam={setStepParam}
        onSelectNode={onSelectNode}
        onSelectEdge={onSelectNode}
        rightSlot={rightSlot}
        marks={marks}
      />
    </div>
  );
}
