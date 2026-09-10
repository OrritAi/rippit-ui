"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ExecutionsResponse,
  LinkMap,
  ScenarioSummary,
} from "@/app/lib/api";
import { getConnector } from "@/lib/connectors";
import { useEscape } from "@/components/shell/shell-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useTabVisible } from "@/hooks/useTabVisible";
import {
  buildMap,
  expandAllSnapshot,
  initialExpanded,
  keyOf,
  parseKey,
  viewedPillId,
} from "@/lib/workflowMap/model";
import {
  useSummaryStore,
  type SummaryStore,
} from "@/lib/workflowMap/summaryStore";
import { useStoredJson, writeStored } from "@/lib/stored";
import {
  FILTER_DEBOUNCE_MS,
  FOCUS_DELAY_MS,
  LITE_AT,
  ROOT_WINDOW_AT,
  SIDEBAR_W,
} from "@/lib/workflowMap/tokens";
import type { MapNode, WorkflowRef } from "@/lib/workflowMap/types";
import { MapEdges } from "./MapEdges";
import { MapMinimap } from "./MapMinimap";
import { MapSidebar, type DetailState } from "./MapSidebar";
import { MapToolbar } from "./MapToolbar";
import { MapTree, type TreeCtx } from "./MapTree";
import { useMapCamera } from "./useMapCamera";
import { useMapKeyboard } from "./useMapKeyboard";
import { useMapMeasure } from "./useMapMeasure";

/*
 * WorkflowMap — the expandable cross-tool canvas for one workflow.
 *
 *   ┌ canvas (scroll viewport, dot grid, edges, tree, toolbar, minimap) ┐ right slot ┐
 *
 * The shell owns `expanded`, `selectedId` and `query`; `buildMap` derives the
 * visible tree from those plus the link map and the summary store, and the
 * measure hook turns the mounted DOM into bezier edges. Callers of the viewed
 * workflow are the roots; the viewed workflow unfolds as an attached pill
 * under its calling step (or is the single root when nothing calls it).
 *
 * The right slot (322px, one occupant) shows the selected node's sidebar, or
 * whatever the host passes as `rightSlot` (a dock tool). Passing a non-null
 * `rightSlot` clears the selection; selecting a node calls `onSelectNode`
 * so the host can drop its tool. `?step=` lives with the host: it sends a
 * `stepRequest` (deep link, palette, dock rows) and receives `onStepParam`.
 *
 * Camera: native scroll plus map-style navigation (useMapCamera) — drag
 * empty canvas to pan, mouse wheel or pinch to zoom around the cursor
 * (trackpad two-finger scroll still pans), +/−/0/F keys, and a zoom cluster
 * in the toolbar. Zoom is CSS `zoom` on the inner content, so scroll
 * extents, focus maths and edge measurement all follow it; below FAR_AT the
 * labels that would be unreadable hide.
 *
 * Scale: above LITE_AT rendered nodes the map drops drift, pulses, stagger
 * and the unfold measure loop; above ROOT_WINDOW_AT roots, far rows render
 * as fixed-height placeholders. Ambient animation pauses in a hidden tab.
 */

export interface StepRequest {
  /** Step id within the viewed workflow. */
  id: string;
  /** Bump to re-issue the same id. */
  gen: number;
}

export interface MapMarks {
  /** Viewed-workflow steps changed since the viewer last looked. */
  changed: ReadonlySet<string>;
  /** Open comment threads per viewed-workflow step id. */
  comments: Readonly<Record<string, number>>;
}

export interface WorkflowMapViewProps {
  viewed: WorkflowRef;
  linkMap: LinkMap | null;
  store: SummaryStore;
  /** Executions of the viewed workflow (Make), for the sidebar's Runs. */
  runs: ExecutionsResponse | null;
  stepRequest?: StepRequest | null;
  /** Selected viewed-workflow step id, or null — the host writes `?step`. */
  onStepParam?: (stepId: string | null) => void;
  onSelectNode?: (node: MapNode) => void;
  /** Alternate occupant of the right slot (a dock tool, `DockHost inline`). */
  rightSlot?: ReactNode;
  marks?: MapMarks;
  /** Node detail loader (defaults to the connector's; the harness stubs it). */
  fetchDetail?: (ref: WorkflowRef, stepId: string) => Promise<unknown>;
  /** Clock for relative times in pill meta lines (fixtures pin it). */
  now?: number;
}

const TOOLS_KEY = "rippit.map.toolsHidden";
const canUnfold = (n: MapNode) =>
  !!n.pill &&
  !n.pill.pinned &&
  !n.pill.cycle &&
  !n.pill.unavailable &&
  !n.pill.error;
const DETAIL_CACHE_MAX = 100;

const defaultFetchDetail = (ref: WorkflowRef, stepId: string) =>
  getConnector(ref.source).fetchNodeDetail(ref.refId, stepId);

export function WorkflowMapView({
  viewed,
  linkMap,
  store,
  runs,
  stepRequest,
  onStepParam,
  onSelectNode,
  rightSlot,
  marks,
  fetchDetail = defaultFetchDetail,
  now,
}: WorkflowMapViewProps) {
  const viewedKey = keyOf(viewed);
  const headingId = useId();

  /* ---------- state ---------- */

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    initialExpanded(linkMap, viewed),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pendingStep, setPendingStep] = useState<string | null>(null);
  const [details, setDetails] = useState<ReadonlyMap<string, DetailState>>(
    () => new Map(),
  );
  /* Toolbar folded to its icon — a per-viewer preference (store-backed so
     the server render and the first client render agree). */
  const toolsHidden = useStoredJson<boolean>(TOOLS_KEY, false);
  const toggleTools = useCallback(
    () => writeStored(TOOLS_KEY, !toolsHidden),
    [toolsHidden],
  );

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  /* ---------- model ---------- */

  const model = useMemo(
    () =>
      buildMap({
        viewed,
        linkMap,
        summaries: store.summaries,
        expanded,
        query: debounced,
        now,
      }),
    // store.summaries is one long-lived Map; store.version is its change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewed, linkMap, store.summaries, store.version, expanded, debounced, now],
  );

  useEffect(() => {
    store.ensure(model.wanted);
  }, [model.wanted, store]);

  /* The link map can arrive after mount: roots switch from the viewed
     workflow to its callers, so re-apply the initial expansion once. */
  const hadLinkMap = useRef(linkMap != null);
  useEffect(() => {
    if (!linkMap || hadLinkMap.current) return;
    hadLinkMap.current = true;
    setExpanded((e) => ({ ...e, ...initialExpanded(linkMap, viewed) }));
  }, [linkMap, viewed]);

  const lite = model.counts.rendered > LITE_AT;
  const windowRoots = model.roots.length > ROOT_WINDOW_AT;
  const reduced = usePrefersReducedMotion();
  const visible = useTabVisible();

  /* Camera first: the measure hook needs the zoom the inner content renders
     with. The hook only reads the element getters, which are stable. */
  const scrollNode = useRef<HTMLDivElement | null>(null);
  const innerNode = useRef<HTMLDivElement | null>(null);
  const camera = useMapCamera({
    scrollElement: useCallback(() => scrollNode.current, []),
    innerElement: useCallback(() => innerNode.current, []),
    instant: lite || reduced,
  });
  const zoom = camera.zoom;
  const far = camera.far;
  const measure = useMapMeasure({
    model,
    lite,
    reducedMotion: reduced,
    windowRoots,
    zoom,
  });
  const {
    focusNode,
    animateUnfold,
    elementOf,
    revealRow,
    scrollRef: measureScrollRef,
    innerRef: measureInnerRef,
  } = measure;
  /* Zoom relayouts the content: measure after commit AND once more when
     the glide has ended (settle re-arms its trailing timer on every step) —
     under LITE the browser lays skipped rows out a beat after the zoom
     changes, and a fractional zoom snaps boxes by up to 1/zoom px. A
     far-mode flip swaps every card for a tile (and back): the same settle
     re-anchors every edge on the new boxes and runs the dev self-check. */
  const settle = measure.settle;
  useEffect(() => settle(), [zoom, far, settle]);
  const scrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollNode.current = el;
      measureScrollRef(el);
    },
    [measureScrollRef],
  );
  const innerRef = useCallback(
    (el: HTMLDivElement | null) => {
      innerNode.current = el;
      measureInnerRef(el);
    },
    [measureInnerRef],
  );

  /* Fresh children columns (mounted during the unfold window) get will-change. */
  const seenGroups = useRef(new Set<string>());
  const isFreshGroup = useCallback(
    (id: string) => !seenGroups.current.has(id),
    [],
  );
  useEffect(() => {
    if (measure.unfolding) return;
    const seen = seenGroups.current;
    for (const id of [...seen]) if (!model.byId.has(id)) seen.delete(id);
    for (const n of model.flat) if (n.children.length > 0) seen.add(n.id);
  }, [model, measure.unfolding]);

  /* ---------- selection ---------- */

  const focusTimer = useRef(0);
  const focusLater = useCallback(
    (id: string) => {
      window.clearTimeout(focusTimer.current);
      focusTimer.current = window.setTimeout(
        () => focusNode(id),
        FOCUS_DELAY_MS,
      );
    },
    [focusNode],
  );
  useEffect(() => () => window.clearTimeout(focusTimer.current), []);

  const select = useCallback(
    (node: MapNode | null) => {
      setSelectedId(node?.id ?? null);
      if (node) onSelectNode?.(node);
      const stepId =
        node &&
        node.kind === "step" &&
        node.stepRef &&
        node.stepRef.key === viewedKey
          ? node.stepRef.stepId
          : null;
      onStepParam?.(stepId);
    },
    [onSelectNode, onStepParam, viewedKey],
  );

  /* Body click / Enter / Space: select only (sidebar + centre). */
  const clickNode = useCallback(
    (node: MapNode) => {
      select(node);
      focusLater(node.id);
    },
    [select, focusLater],
  );

  /* Count chip: expand / collapse that flow, then centre it once unfolded. */
  const toggleNode = useCallback(
    (node: MapNode) => {
      if (!canUnfold(node)) return;
      setExpanded((e) => ({ ...e, [node.id]: !e[node.id] }));
      animateUnfold();
      focusLater(node.id);
    },
    [animateUnfold, focusLater],
  );

  const close = useCallback(() => select(null), [select]);

  /* Sidebar "Show" on a Go to step: select + centre the jump target. */
  const showStep = useCallback(
    (key: string, stepId: string) => {
      const target = model.byStep.get(`${key}:${stepId}`);
      if (target) clickNode(target);
    },
    [model.byStep, clickNode],
  );
  useEscape(selectedId != null, close);

  /* A dock tool took the slot: the sidebar yields. */
  const hasTool = rightSlot != null;
  useEffect(() => {
    if (hasTool) setSelectedId(null);
  }, [hasTool]);

  const expandAll = useCallback(() => {
    setExpanded((e) => expandAllSnapshot(model, e));
    animateUnfold();
  }, [model, animateUnfold]);

  const collapseAll = useCallback(() => {
    setExpanded({});
    select(null);
    animateUnfold();
  }, [select, animateUnfold]);

  const onExpand = useCallback(
    (n: MapNode) => {
      setExpanded((e) => ({ ...e, [n.id]: true }));
      animateUnfold();
    },
    [animateUnfold],
  );
  const onCollapse = useCallback(
    (n: MapNode) => {
      setExpanded((e) => ({ ...e, [n.id]: false }));
      animateUnfold();
    },
    [animateUnfold],
  );

  const keyboard = useMapKeyboard({
    model,
    selectedId,
    onActivate: clickNode,
    onExpand,
    onCollapse,
    elementOf,
    focusNode,
    reveal: revealRow,
  });

  /* ---------- step requests (deep link, palette, dock rows) ---------- */

  const handledGen = useRef<number | null>(null);
  useEffect(() => {
    if (!stepRequest || handledGen.current === stepRequest.gen) return;
    handledGen.current = stepRequest.gen;
    setPendingStep(stepRequest.id);
    setExpanded((e) => ({ ...e, ...initialExpanded(linkMap, viewed) }));
  }, [stepRequest, linkMap, viewed]);

  useEffect(() => {
    if (pendingStep == null) return;
    const node = model.byStep.get(`${viewedKey}:${pendingStep}`);
    if (node) {
      setPendingStep(null);
      select(node);
      focusLater(node.id);
      return;
    }
    const pid = viewedPillId(model, viewed);
    if (pid && !expanded[pid] && canUnfold(model.byId.get(pid)!))
      setExpanded((e) => ({ ...e, [pid]: true }));
  }, [model, pendingStep, viewedKey, viewed, expanded, select, focusLater]);

  /* ---------- selected node + its detail ---------- */

  const selectedNode =
    selectedId != null ? (model.byId.get(selectedId) ?? null) : null;
  const detailKey =
    selectedNode && selectedNode.kind === "step" && selectedNode.stepRef
      ? `${selectedNode.stepRef.key}:${selectedNode.stepRef.stepId}`
      : null;

  useEffect(() => {
    if (!detailKey || details.has(detailKey) || !selectedNode?.stepRef) return;
    const ref = parseKey(selectedNode.stepRef.key);
    const stepId = selectedNode.stepRef.stepId;
    if (!ref) return;
    const put = (state: DetailState) =>
      setDetails((m) => {
        const next = new Map(m);
        next.delete(detailKey);
        next.set(detailKey, state);
        while (next.size > DETAIL_CACHE_MAX) {
          const oldest = next.keys().next().value;
          if (oldest === undefined) break;
          next.delete(oldest);
        }
        return next;
      });
    put({ status: "loading" });
    fetchDetail(ref, stepId)
      .then((data) => put({ status: "ok", data }))
      .catch(() => put({ status: "error" }));
  }, [detailKey, details, fetchDetail, selectedNode]);

  const detail: DetailState = (detailKey && details.get(detailKey)) || {
    status: "idle",
  };

  const cardFor = (node: MapNode) =>
    node.ref
      ? linkMap?.workflows.find(
          (w) => w.source === node.ref!.source && w.refId === node.ref!.refId,
        )
      : undefined;
  const summaryFor = (node: MapNode) => {
    if (!node.ref) return undefined;
    const e = store.summaries.get(keyOf(node.ref));
    return e?.state === "ok" ? e.summary : undefined;
  };

  const noteFor = useCallback(
    (node: MapNode): string | null => {
      if (
        !marks ||
        !node.stepRef ||
        node.stepRef.key !== viewedKey ||
        node.kind !== "step"
      )
        return null;
      const parts: string[] = [];
      if (marks.changed.has(node.stepRef.stepId))
        parts.push("changed since you last looked");
      const c = marks.comments[node.stepRef.stepId];
      if (c) parts.push(`${c} open comment${c === 1 ? "" : "s"}`);
      return parts.length ? parts.join(" · ") : null;
    },
    [marks, viewedKey],
  );

  /* ---------- render ---------- */

  const ctx: TreeCtx = {
    selectedId,
    lite,
    unfolding: measure.unfolding,
    itemProps: keyboard.itemProps,
    refFor: measure.refFor,
    rowRefFor: measure.rowRefFor,
    placeholderRefFor: measure.placeholderRefFor,
    near: windowRoots ? measure.near : null,
    skipOffscreen: lite || windowRoots,
    far,
    heightOf: measure.heightOf,
    onClick: clickNode,
    onToggle: toggleNode,
    srNoteFor: marks ? noteFor : undefined,
    isFreshGroup,
  };

  const slotOpen = selectedNode != null || hasTool;
  const filtering = debounced.trim().length > 0;

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={400}>
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col ${lite ? "wm-lite" : ""}`}
      >
        <div className="flex min-h-0 flex-1">
          {/* contain:paint + isolate: the canvas is its own stacking context AND
            the containing block for every descendant (fixed included), so
            nothing inside it — dots, edges, toolbar, minimap, z-indexed tree —
            can paint outside its box under any stylesheet. */}
          <div className="relative isolate min-w-0 flex-1 overflow-hidden bg-vpbg [contain:paint]">
            <div className="wm-dots" aria-hidden="true" />
            {/* The viewport is focusable so arrow keys pan and +/−/0/F zoom;
              the tree inside keeps its own WAI-ARIA keyboard model. Same
              focusable-group pattern as the system map and Martech canvas. */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div
              ref={scrollRef}
              role="group"
              aria-label="Map canvas — drag to pan, scroll or pinch to zoom"
              tabIndex={0}
              onKeyDown={camera.onKeyDown}
              onPointerDown={camera.onPointerDown}
              onPointerMove={camera.onPointerMove}
              onPointerUp={camera.onPointerUp}
              onPointerCancel={camera.onPointerAbort}
              onLostPointerCapture={camera.onPointerAbort}
              onClickCapture={camera.onClickCapture}
              className={`absolute inset-0 overflow-auto outline-none ${camera.dragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
            >
              {/* Slack pad: one viewport of padding on every side (set by the
                camera), outside the zoomed inner, so the map always pans. */}
              <div ref={camera.padRef} className="box-border w-max">
                <div
                  ref={innerRef}
                  className="relative box-border w-max pb-[90px] pl-[40px] pr-[120px] pt-[84px]"
                  data-zoom={zoom}
                  style={{ zoom }}
                >
                  <MapEdges
                    zoom={zoom}
                    edges={measure.edges}
                    selectedId={selectedId}
                    track={measure.unfolding || lite || reduced}
                    lite={lite}
                    paused={!visible}
                  />
                  <h2 id={headingId} className="sr-only">
                    Workflow map
                  </h2>
                  <div
                    role="tree"
                    aria-labelledby={headingId}
                    className="relative z-[1] select-none"
                  >
                    <MapTree
                      roots={model.roots}
                      callers={model.callers}
                      ctx={ctx}
                    />
                  </div>
                </div>
              </div>
            </div>
            <MapToolbar
              query={query}
              onQuery={setQuery}
              onExpandAll={expandAll}
              onCollapseAll={collapseAll}
              zoom={zoom}
              onZoomIn={camera.zoomIn}
              onZoomOut={camera.zoomOut}
              onZoomReset={camera.resetZoom}
              onFit={camera.fit}
              matches={filtering ? model.counts.matchedRoots : null}
              collapsed={toolsHidden}
              onToggle={toggleTools}
            />
            <MapMinimap
              scrollElement={camera.scrollElement}
              innerElement={camera.innerElement}
              zoom={zoom}
              boxes={measure.boxes}
              rowBoxes={measure.rowBoxes}
            />
          </div>
          {/* The slot is opaque (page bg under the panel tint) so nothing from the
            canvas can ever show through it, whatever paints behind. */}
          <div
            className={`relative z-[6] flex flex-none flex-col overflow-hidden bg-bg transition-[width] duration-300 ease-[var(--ease-out)] ${slotOpen ? "border-l border-line" : ""}`}
            style={{ width: slotOpen ? SIDEBAR_W : 0 }}
          >
            <div className="flex h-full w-[322px] flex-none flex-col bg-panel">
              {selectedNode ? (
                <MapSidebar
                  key={selectedNode.id}
                  node={selectedNode}
                  viewed={viewed}
                  runs={runs}
                  card={cardFor(selectedNode)}
                  summary={summaryFor(selectedNode)}
                  detail={detail}
                  onClose={close}
                  onShowStep={showStep}
                  note={noteFor(selectedNode)}
                />
              ) : (
                rightSlot
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** The map bound to the shared summary store. `seedSummary` is the viewed
 *  workflow's summary from `connector.loadWorkflow` — it is never refetched;
 *  a new object (refresh) re-seeds the store and evicts the neighbours. */
export function WorkflowMap({
  seedSummary,
  ...props
}: Omit<WorkflowMapViewProps, "store"> & { seedSummary: ScenarioSummary }) {
  const seed = useMemo(
    () => ({ key: keyOf(props.viewed), summary: seedSummary }),
    [props.viewed, seedSummary],
  );
  const store = useSummaryStore(seed);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    store.reseed(seed);
    // store is stable per hook identity; reseed only when the seed changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  return <WorkflowMapView {...props} store={store} />;
}
