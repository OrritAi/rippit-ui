"use client";

import { useState, useEffect, useCallback, useMemo, useRef, use } from "react";
import { useSearchParams, notFound } from "next/navigation";
import Link from "next/link";
import { Activity, ArrowUpRight, MessageSquare, PanelRight, X } from "lucide-react";
import { ApiError, fetchBundles, fetchExecutions, fetchExecutionTrace, fetchComments, fetchWorkflowChanges, markWorkflowSeen, projectWorkflow } from "@/app/lib/api";
import type { ExecutionBundles, ExecutionsResponse, ExecutionTrace, NodeId, Projection, RelatedRun, RunRow, WorkflowChanges } from "@/app/lib/api";
import { getConnector, isProviderId } from "@/lib/connectors";
import type { WorkflowData } from "@/lib/connectors/types";
import { WorkflowRef } from "@/lib/portals";
import { useConnections, useWorkflowIndex } from "@/components/app/ConnectionsProvider";
import { usePaletteScope } from "@/components/palette/palette-context";
import { ActionBar, type DockTool, type ToolSpec } from "@/components/canvas/ActionBar";
import { CaptureNotice } from "@/components/shared/CaptureBadge";
import { HistoryHeader } from "@/components/history/HistoryHeader";
import { RunList } from "@/components/history/RunList";
import { RunSwitcher } from "@/components/history/RunSwitcher";
import { useRunHistory } from "@/components/history/useRunHistory";
import { Walk } from "@/components/walk/Walk";
import { DryRunPanel } from "@/components/projection/DryRunPanel";
import { DiffVerdict } from "@/components/projection/DiffVerdict";
import { OverrideNotice } from "@/components/projection/OverrideBracket";
import { openingStage, stagesFor } from "@/lib/walk";
import { useFullBleed } from "@/components/shell/shell-context";
import { DockHost, DockTitle } from "@/components/canvas/DockHost";
import { WorkflowMap, type StepRequest } from "@/components/workflowMap/WorkflowMap";
import { SIDEBAR_W } from "@/lib/workflowMap/tokens";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorCard } from "@/components/shared/ErrorCard";
import { relativeTime } from "@/components/shared/RunsPanel";
import { MapTip } from "@/components/workflowMap/MapTip";
import { runCounts, runStatusWord, runUnchecked } from "@/lib/workflowMap/run";
import { rememberRunSteps } from "@/lib/triage";
import { RunPanel } from "@/components/triage/RunPanel";
import { toast } from "sonner";
import { useNow } from "@/hooks/useNow";
import { CommentsThread } from "@/components/shared/CommentsSection";
import { writeStored, readStored, type RecentEntry } from "@/lib/stored";

/*
 * Workflow view: header · notice rows · the workflow map (callers unfold
 * into the viewed workflow; nodes select into a 322px sidebar). The header
 * carries Sync, History (Make only — a link to this workflow's run log, the
 * triage layer's entry point on this page) and Comments; the Comments dock
 * shares the map's right slot with the node sidebar — one occupant at a
 * time. (Health, info, changes and notes docks exist in the codebase but are
 * not mounted here: the canvas is the page.)
 * `?history=1` turns the page into the history surface: the shell's rail and
 * browser column step out (`useFullBleed`), the ActionBar is replaced by the
 * history header, and the canvas ground shifts to `--plane`. The surface has
 * **two levels, and `?run=` decides which**: absent is the run list filling
 * the body, present is that run on the canvas with the run itself as the page
 * title (`RunSwitcher`). Back steps out one level at a time and its label
 * names where it goes. Showing both at once was tried three ways — a bottom
 * split, a filmstrip, a status rail — and all three halved something worth
 * keeping. `/w/{provider}/{id}/history` is the same surface as a deep link.
 * Esc leaves it, after the map's own layers.
 * `?step=` selects that step of the viewed workflow (`?node=` is read as an
 * alias); the palette and dock rows select through the same request.
 * `?run=<executionId>` replays one execution on the map (Make): its trace is
 * fetched here, the map grays what the run did not touch, a terse "Replay"
 * banner in the triage accent keeps the context, and the History icon fills
 * in that accent so the row says where the run came from. Picking a run is
 * the log's job — history row → `?run=` → History back to the log, two
 * clicks each way. Without a run nothing of that shows and the page is the
 * plain visualization. Esc closes the open occupant, then stops the replay.
 * The trace's tally is remembered for the session so the log can show
 * "7/9 steps" on a run without fetching a trace of its own. The trace's related
 * runs (other executions that carried the same record) whose workflow the
 * map renders as a pill are fetched here too — once per run id, no refresh
 * — and handed to the map, which colours that workflow's steps as well.
 */
const TRACE_REPOLL_MS = 6000;
export default function WorkflowPage({ params }: { params: Promise<{ provider: string; id: string }> }) {
  const { provider, id } = use(params);
  if (!isProviderId(provider)) notFound();
  const connector = getConnector(provider);

  const searchParams = useSearchParams();
  const requestedStep = searchParams.get("step") ?? searchParams.get("node");
  const requestedRun = searchParams.get("run");
  const requestedHistory = searchParams.get("history") === "1";
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
  // The execution replayed on the map (`?run=`) and its trace, keyed by the
  // run it answers so a stale trace never overlays another run.
  const [runId, setRunId] = useState<string | null>(requestedRun);
  const [traceState, setTraceState] = useState<{ runId: string; trace: ExecutionTrace | null; error: string | null } | null>(null);
  const trace = runId != null && traceState?.runId === runId ? traceState.trace : null;
  const traceError = runId != null && traceState?.runId === runId ? traceState.error : null;
  // Traces of related runs the map asked for, cached by execution id for the
  // life of the page; each id is fetched at most once (a failed read stays
  // absent — the map simply shows nothing extra for that workflow).
  // The run panel is the slot's lowest-priority occupant. Closing it leaves
  // the run replayed; the banner's control brings it back. A new run opens it.
  const [runPanelOpen, setRunPanelOpen] = useState(true);
  // The history surface is a state of this page, not a route of its own.
  const [historyOpen, setHistoryOpen] = useState(requestedHistory);
  useFullBleed(historyOpen ? "full" : null);
  /* The walk replaces the canvas for one run; the dry-run inset sits beside
     it. Neither is URL state: a projection is not stored, and a link that
     restored one would imply it was. */
  const [walkRun, setWalkRun] = useState<string | null>(null);
  const [dryOpen, setDryOpen] = useState(false);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [projecting, setProjecting] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  // The step the run panel marks — the last one selected from it or elsewhere.
  const [activeStepId, setActiveStepId] = useState<string | null>(requestedStep);
  const [relatedTraces, setRelatedTraces] = useState<ReadonlyMap<string, ExecutionTrace>>(() => new Map());
  const relatedTried = useRef(new Set<string>());
  const onRelatedWanted = useCallback((runs: RelatedRun[]) => {
    for (const r of runs) {
      if (relatedTried.current.has(r.executionId)) continue;
      relatedTried.current.add(r.executionId);
      fetchExecutionTrace(r.provider, r.workflowExternalId, r.executionId)
        .then((t) => setRelatedTraces((m) => new Map(m).set(r.executionId, t)))
        .catch(() => {});
    }
  }, []);
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

  // Runs up front, for every provider: the route answers
  // `{supported:false, reason}` for one without a runtime without calling the
  // platform, which is what lets the header explain itself rather than hide.
  useEffect(() => {
    let live = true;
    fetchExecutions(provider, id)
      .then((d) => live && setRuns(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [provider, id, reloadKey]);

  // The replayed run's trace: which steps ran, which failed, what was not
  // checked. Read once more after 6 s while the API is still checking modules.
  // Its tally is remembered for the session so the history log can show
  // "7/9 steps" on this run without ever fetching a trace of its own.
  useEffect(() => {
    if (!runId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const remember = (t: ExecutionTrace) => {
      if (!t.supported) return;
      const c = runCounts(t);
      rememberRunSteps(provider, id, runId, c.reached, c.total);
    };
    fetchExecutionTrace(provider, id, runId)
      .then((t) => {
        if (!live) return;
        setTraceState({ runId, trace: t, error: null });
        remember(t);
        if (t.refreshing) {
          timer = setTimeout(() => {
            fetchExecutionTrace(provider, id, runId)
              .then((t2) => {
                if (!live) return;
                setTraceState({ runId, trace: t2, error: null });
                remember(t2);
              })
              .catch(() => {});
          }, TRACE_REPOLL_MS);
        }
      })
      .catch((e: unknown) => {
        if (!live) return;
        setTraceState({
          runId,
          trace: null,
          error:
            e instanceof ApiError && e.status === 404
              ? `Run ${runId} is not among the runs Rippit holds for this ${connector.nouns.workflow} — it may be older than the retained history.`
              : e instanceof Error && e.message
                ? e.message
                : "Could not load this run.",
        });
      });
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // connector follows provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, id, runId, reloadKey]);

  useEffect(() => {
    if (!data) return;
    document.title = historyOpen ? `${data.summary.name} — History — Rippit` : `${data.summary.name} — Rippit`;
    const prev = readStored<RecentEntry[]>("rippit.recent", []);
    const next: RecentEntry[] = [{ provider, id, name: data.summary.name, at: Date.now() }, ...prev.filter((r) => !(r.provider === provider && r.id === id))].slice(0, 8);
    writeStored("rippit.recent", next);
    window.dispatchEvent(new Event("rippit:recent"));
  }, [data, provider, id, historyOpen]);

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

  /* The replayed run as a RunRow, so the panel renders through the same
     `RunDetailBody` the log's expanded row does. What the trace does not
     carry (ops, native url) simply reads "—" until the detail call answers. */
  const runRow: RunRow | null = useMemo(() => {
    if (!runId) return null;
    const ex = trace?.execution ?? null;
    return {
      provider,
      connectionId: connection?.id ?? "",
      connectionLabel: connection?.displayName ?? "",
      workflowExternalId: id,
      workflowName: data?.summary.name ?? null,
      executionId: runId,
      status: ex?.status ?? "unknown",
      startedAt: ex?.startedAt ?? null,
      durationMs: ex?.durationMs ?? null,
      operations: ex?.operations ?? null,
      errorName: ex?.errorName ?? null,
      errorMessage: ex?.errorMessage ?? null,
      causeModuleId: ex?.causeModuleId ?? null,
      nativeUrl: trace?.links?.execution ?? null,
    };
  }, [runId, trace, provider, connection, id, data]);

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

  // `?run=` mirrors `?step=`: replaceState, never a navigation.
  const setRunParam = useCallback((run: string | null) => {
    const url = new URL(window.location.href);
    if (run == null) url.searchParams.delete("run");
    else url.searchParams.set("run", run);
    window.history.replaceState(window.history.state, "", url.toString());
    setRunId(run);
    if (run != null) setRunPanelOpen(true);
  }, []);
  const clearRun = useCallback(() => setRunParam(null), [setRunParam]);

  // `?history=1` mirrors `?run=`: replaceState, never a navigation. Closing
  // takes the log's own filters with it, so the workflow's URL goes back to
  // being the workflow's.
  const setHistory = useCallback((open: boolean) => {
    const url = new URL(window.location.href);
    if (open) {
      url.searchParams.set("history", "1");
    } else {
      for (const k of ["history", "page", "size", "status"]) url.searchParams.delete(k);
    }
    window.history.replaceState(window.history.state, "", url.toString());
    setHistoryOpen(open);
  }, []);
  const openHistory = useCallback(() => setHistory(true), [setHistory]);
  /* The history surface has two levels and `?run=` decides which: absent is
     the list, present is that run on the canvas. Back steps out one level at
     a time — a run returns to the list, the list leaves history — so the
     label can always name where it goes. */
  const historyLevel = historyOpen ? (runId ? 2 : 1) : 0;
  const historyBack = useCallback(() => {
    setWalkRun(null);
    if (runId) clearRun();
    else setHistory(false);
  }, [runId, clearRun, setHistory]);
  /* Picking a run always lands on the canvas, never back inside a walk the
     reader had left open on a different run. */
  const pickRun = useCallback(
    (executionId: string) => {
      setWalkRun(null);
      setRunParam(executionId);
    },
    [setRunParam],
  );

  // Select one of this workflow's steps on the map (palette, dock rows).
  const selectStep = useCallback((nodeId: NodeId) => {
    setTool(null);
    setActiveStepId(String(nodeId));
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
  /* One fetch of this workflow's runs, shared by the level-1 list and the
     level-2 switcher — so the two agree on counts and switching level never
     re-hits the network. */
  const runHistory = useRunHistory(provider, id);

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

  /* The walk needs the same bundles the node panel does, but it replaces the
     canvas — so the map is unmounted and cannot be the one fetching them. */
  const [walkBundles, setWalkBundles] = useState<ExecutionBundles | null>(null);
  const [walkBundlesLoading, setWalkBundlesLoading] = useState(false);
  useEffect(() => {
    if (!walkRun) return;
    let live = true;
    setWalkBundlesLoading(true);
    fetchBundles(provider, id, walkRun)
      .then((b) => live && setWalkBundles(b))
      .catch(() => live && setWalkBundles(null))
      .finally(() => live && setWalkBundlesLoading(false));
    return () => {
      live = false;
    };
  }, [walkRun, provider, id]);

  const walkStages = useMemo(
    () => (walkRun ? stagesFor(data?.summary.modules ?? [], trace, walkBundles) : []),
    [walkRun, data, trace, walkBundles],
  );

  /* An override replaces one field of a step's input and re-projects the
     subtree below it. Everything above keeps what actually happened, which is
     what makes the bracket honest. */
  const onOverrideField = useCallback(
    (nodeId: string, key: string, current: unknown) => {
      const next = { ...overrides, [nodeId]: { ...(overrides[nodeId] as object ?? {}), [key]: current } };
      setOverrides(next);
      setProjecting(true);
      projectWorkflow(provider, id, { runId: runId ?? undefined, overrides: next })
        .then(setProjection)
        .catch(() => setProjection(null))
        .finally(() => setProjecting(false));
    },
    [overrides, provider, id, runId],
  );

  /* "opportunity.value 400 → 2500" — the pair, not the result. What did I
     change is a question the new value alone cannot answer. */
  const overrideDetail = useMemo(() => {
    const entries = Object.entries(overrides);
    if (entries.length === 0) return "";
    const [nodeId, fields] = entries[0];
    const key = Object.keys((fields as object) ?? {})[0];
    return key ? `step ${nodeId}'s ${key} edited` : `step ${nodeId} edited`;
  }, [overrides]);

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
  const failures = runs?.executions?.filter((e) => e.status === "error" || e.status === "incomplete").length ?? 0;
  // Header tools: Comments only. The runs themselves live behind the History
  // control, which opens the log as a surface over this page instead of a
  // dock — one entry point into them, shared with /triage.
  const tools: ToolSpec[] = [{ id: "comments", label: "Comments", badge: wfOpenComments > 0 ? wfOpenComments : null, tone: "t1" }];
  // History follows the runtime the API declares, never a hard-coded provider
  // name: a platform lights up here the day its runtime lands. Until the
  // answer arrives, Make is the one runtime that exists, so the control shows
  // rather than flickering in. Without one it stays visible but disabled and
  // says why — hiding it just sends people hunting through Triage.
  const runtimeSupported = runs ? runs.supported : provider === "make";
  const historyUnavailable = runtimeSupported
    ? null
    : runs?.reason || `no run history for ${connector.label} yet`;
  const runCount = runs?.executions?.length ?? null;

  const runSlot =
    runRow && runPanelOpen ? (
      <RunPanel row={runRow} shortId={shortId(runRow.executionId)} selectedStepId={activeStepId} onStepClick={selectStep} onClose={() => setRunPanelOpen(false)} />
    ) : null;

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
      {historyOpen ? (
        <HistoryHeader
          onBack={historyBack}
          backLabel={historyLevel === 2 ? "All runs" : "Back"}
          onDryRun={() => setDryOpen((v) => !v)}
          title={
            historyLevel === 2 ? (
              <RunSwitcher
                history={runHistory}
                current={runHistory.rows.find((r) => r.executionId === runId) ?? null}
                onPick={pickRun}
                onWalk={(executionId) => {
                  setRunParam(executionId);
                  setWalkRun(executionId);
                }}
                now={now}
              />
            ) : undefined
          }
        />
      ) : (
        <ActionBar
          app={provider}
          name={summary.name}
          statusPill={meta.statusPill}
          live={live}
          changes={changes?.unseen ?? 0}
          onRefresh={refresh}
          refreshing={refreshing}
          meta={metaLine || null}
          tools={tools}
          activeTool={tool}
          onTool={openTool}
          onHistory={runtimeSupported ? openHistory : null}
          historyCount={runtimeSupported ? runCount : null}
          historyUnavailable={historyUnavailable}
          historyAccent={runId != null}
          historyBadge={failures > 0 ? failures : null}
          historyBadgeTone={failures > 0 ? "err" : "t1"}
          nativeUrl={nativeUrl}
          providerLabel={connector.shortLabel}
          accountTitle={accountTitle}
        />
      )}

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

      {/* Run replay: the map below grays what this execution did not touch.
          At level 2 of the history surface the run is already the page title,
          so the banner would say it twice — the design gives that canvas no
          permanent run chrome at all. */}
      {runId && historyLevel !== 2 && (
        <div className="px-3 pb-2">
          <RunBanner
            runId={runId}
            trace={trace}
            error={traceError}
            platform={connector.shortLabel}
            noun={connector.nouns.workflow}
            onClear={clearRun}
            onShowPanel={runPanelOpen ? null : () => setRunPanelOpen(true)}
          />
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

      {historyLevel === 1 ? (
        /* Level 1 owns the whole body. A permanent split showing the list and
           the canvas at once was built and rejected — it halved both. */
        <RunList
          history={runHistory}
          activeRunId={runId}
          onPick={pickRun}
          onWalk={(executionId) => {
            setRunParam(executionId);
            setWalkRun(executionId);
          }}
        />
      ) : walkRun ? (
        <Walk
          key={`walk:${walkRun}`}
          stages={walkStages}
          startAt={openingStage(walkStages)}
          bundles={walkBundles}
          bundlesLoading={walkBundlesLoading}
          runLabel={`${summary.name}, run ${walkRun.slice(-6)}`}
          onExit={() => setWalkRun(null)}
        />
      ) : (
      <>
      {projection?.verdict && (
        <DiffVerdict verdict={projection.verdict} />
      )}
      {Object.keys(overrides).length > 0 && (
        <OverrideNotice
          count={Object.keys(overrides).length}
          detail={overrideDetail}
          onReset={() => {
            setOverrides({});
            setProjection(null);
          }}
        />
      )}
      <div className="flex min-h-0 flex-1">
      {dryOpen && (
        <DryRunPanel
          provider={provider}
          externalId={id}
          busy={projecting}
          onClose={() => setDryOpen(false)}
          onProject={(input) => {
            setProjecting(true);
            projectWorkflow(provider, id, { input, overrides })
              .then(setProjection)
              .catch(() => setProjection(null))
              .finally(() => setProjecting(false));
          }}
        />
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
        runSlot={runSlot}
        marks={marks}
        run={trace}
        onClearRun={clearRun}
        relatedTraces={relatedTraces}
        onRelatedWanted={onRelatedWanted}
        ground={historyOpen ? "plane" : "viewport"}
        projection={projection}
        onOverrideField={onOverrideField}
      />
      </div>
      </>
      )}


    </div>
  );
}

/* The replay banner wears the triage accent: a left rule, a tinted border and
   a faint fill — the layer's colour, so replay reads as something laid over
   the map rather than the map itself. Status stays in the status colours. */
const BANNER_STYLE = {
  borderColor: "color-mix(in srgb, var(--triage) 45%, transparent)",
  borderLeftColor: "var(--triage)",
  borderLeftWidth: 3,
  background: "color-mix(in srgb, var(--triage) 7%, transparent)",
} as const;

/*
 * "Replay · run e12 · failed · 7/9 steps", with the platform link and the
 * stop control as icons. Per-step failures and warnings are already ringed
 * on the map, so the row only adds what the map cannot show: steps Rippit
 * could not check, a blueprint edited since the run, and a trace that would
 * not load. The × (and Esc, once nothing else is open) stops the replay.
 */
/** Long platform ids are cut in the middle; the full id is on hover. */
function shortId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 6)}…${id.slice(-5)}`;
}

function RunBanner({
  runId,
  trace,
  error,
  platform,
  noun,
  onClear,
  onShowPanel,
}: {
  runId: string;
  trace: ExecutionTrace | null;
  error: string | null;
  platform: string;
  noun: string;
  onClear: () => void;
  /** Set only while the run panel is closed — the way back to it. */
  onShowPanel?: (() => void) | null;
}) {
  const ex = trace?.execution ?? null;
  const statusTone = error || ex?.status === "error" ? "text-err-text" : ex?.status === "warning" || ex?.status === "incomplete" ? "text-warn-text" : "text-t1";
  const lead = error
    ? error
    : !trace
      ? "loading"
      : !trace.supported
        ? (trace.reason ?? "replay is not available for this platform yet")
        : ex
          ? runStatusWord(ex.status)
          : null;
  const parts: string[] = [];
  if (trace?.supported) {
    if (trace.runName) parts.push(trace.runName);
    const { reached, total } = runCounts(trace);
    parts.push(`${reached}/${total} steps`);
    const unchecked = runUnchecked(trace);
    if (trace.partial && unchecked > 0) parts.push(`${unchecked} unchecked`);
    if (trace.blueprintChangedSince) parts.push(`${noun} edited since`);
    if (trace.refreshing) parts.push("checking");
  }
  const open = trace?.links?.execution ?? trace?.links?.history ?? null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border px-3 py-1.5 text-[12px] text-t2" style={BANNER_STYLE}>
      <MapTip label="Replay of a recorded run">
        <span className="inline-flex flex-none cursor-help items-center gap-1.5 text-[12px] font-semibold text-t1">
          <Activity aria-hidden="true" className="size-3.5 flex-none text-triage" />
          Replay
        </span>
      </MapTip>
      <span className="tabular min-w-0 font-mono text-[11px] [overflow-wrap:anywhere]" title={runId}>
        · run {shortId(runId)}
      </span>
      {lead && <span className={statusTone}>· {lead}</span>}
      {parts.map((p) => (
        <span key={p} className="min-w-0 [overflow-wrap:anywhere]">
          · {p}
        </span>
      ))}
      <span className="ml-auto flex flex-none items-center gap-0.5">
        {onShowPanel && (
          <MapTip label="Details">
            <button
              type="button"
              onClick={onShowPanel}
              aria-label="Show the run panel"
              className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-t3 transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-t1"
            >
              <PanelRight aria-hidden="true" className="size-3.5" />
            </button>
          </MapTip>
        )}
        {open && (
          <MapTip label={`Open in ${platform}`}>
            <a
              href={open}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open this run in ${platform}`}
              className="inline-flex size-[22px] items-center justify-center rounded-control text-t3 transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-t1"
            >
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </a>
          </MapTip>
        )}
        <MapTip label="Stop replaying · Esc" side="left">
          <button
            type="button"
            onClick={onClear}
            aria-label="Stop replaying this run"
            className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-t3 transition-colors duration-[var(--dur-fast)] hover:bg-hover hover:text-t1"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </MapTip>
      </span>
    </div>
  );
}
