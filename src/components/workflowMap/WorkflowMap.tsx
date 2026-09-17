"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  fetchBundles,
  fetchExecutionPayload,
  type ExecutionBundles,
  type ExecutionPayload,
  type ExecutionsResponse,
  type ExecutionTrace,
  type LinkMap,
  type Projection,
  type RelatedRun,
  type ScenarioSummary,
  type WorkflowShapes,
} from "@/app/lib/api";
import { getConnector } from "@/lib/connectors";
import { useEscape } from "@/components/shell/shell-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useTabVisible } from "@/hooks/useTabVisible";
import {
  ago,
  armKey,
  buildMap,
  expandAllSnapshot,
  initialExpanded,
  keyOf,
  packedSteps,
  parseKey,
  revealLayer,
  withPillOpen,
  viewedPillId,
} from "@/lib/workflowMap/model";
import {
  dimNodeIds,
  failedNodeIds,
  runFocusRect,
  runStates,
  runStatusWord,
  traceNodeFor,
} from "@/lib/workflowMap/run";
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
import { LAYERS, type Layer, type MapNode, type WorkflowKey, type WorkflowRef } from "@/lib/workflowMap/types";
import { groupEdges } from "@/lib/workflowMap/edgeGroups";
import { MapEdges } from "./MapEdges";
import { projectionAsTrace } from "@/lib/projection/overlay";
import { MapEdgeSidebar } from "./MapEdgeSidebar";
import { MapMinimap } from "./MapMinimap";
import { MapSidebar, type DetailState } from "./MapSidebar";
import { MapToolbar } from "./MapToolbar";
import { MapTree, type TreeCtx } from "./MapTree";
import { useMapCamera } from "./useMapCamera";
import { useMapKeyboard } from "./useMapKeyboard";
import { useMapMeasure } from "./useMapMeasure";
import { useMapMotion } from "./useMapMotion";

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
 *
 * Legibility: the canvas is a ladder of description the reader climbs
 * deliberately — Overview (what the workflow IS: trigger, its run-in packed,
 * the fan-out, everything past it as one element), Structure (the default:
 * trunk steps plus one card per distinct branch shape), Steps (all of it) —
 * and below those, one arm opened in place, and the sidebar. Every rung is a
 * MODEL operation: withheld steps are removed before `walk()` builds `flat`,
 * `byId` and the DOM, so tab order, edges, LITE and the layout weights all
 * describe what is drawn. Nothing is ever invented — a card standing for
 * more than itself is a real node, annotated.
 *
 * Layer is explicit state and deliberately independent of zoom: a reader
 * zooming out to see more must never find the map has silently changed what
 * it shows. Descending is a click on what a card stands for; ascending is
 * the rung control or Esc, which walks the whole ladder back up and can
 * never dead-end. `?step=` carries no rung and no fold state — it names a
 * step, and the map opens exactly what stands in the way, one level per
 * rebuild, and says so when the step no longer exists at all.
 *
 * Run replay: the host passes the trace of one execution as `run`
 * (`?run=` is its URL state); `runStates` (lib/workflowMap/run.ts) gives
 * every node of the viewed workflow a state that lands as `data-run`, the
 * root gains `.wm-run`, edges between dimmed nodes fade, the failed node's
 * incoming edge turns red, the minimap dims, and the sidebar shows "In this
 * run". Esc clears the run once nothing else in the map is open.
 * Related runs: the trace's `related[]` (other executions that carried the
 * same record) whose workflow is rendered as a pill are reported to the host
 * through `onRelatedWanted`; the host fetches each trace once and hands them
 * back as `relatedTraces` (by execution id). Those workflows' steps then get
 * their own states, their pill's meta line reads "ran 2h ago · failed", and
 * selecting one of their steps shows "In the related run".
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
  /** A connection (edge) was selected — the host drops its dock tool. */
  onSelectEdge?: () => void;
  /** Repeated structure in the viewed workflow (`GET …/shapes`). Its element
   *  tree is the fold plan. Null or absent: the canvas falls back to folding
   *  arms from the graph, which is coarser but never broken. */
  shapes?: WorkflowShapes | null;
  /** A `?step=` (or palette / dock) request named a step this workflow no
   *  longer has. The host says so — the map has nothing to show. */
  onStepMissing?: (stepId: string) => void;
  /** Alternate occupant of the right slot (a dock tool, `DockHost inline`). */
  rightSlot?: ReactNode;
  /** Lowest-priority occupant: the replayed run's panel. A selected node, a
   *  selected connection and a dock tool all take the slot ahead of it, and
   *  closing them hands it back while the run is still replayed. */
  runSlot?: ReactNode;
  marks?: MapMarks;
  /** Node detail loader (defaults to the connector's; the harness stubs it). */
  fetchDetail?: (ref: WorkflowRef, stepId: string) => Promise<unknown>;
  /** Clock for relative times in pill meta lines (fixtures pin it). */
  now?: number;
  /** The trace of the execution being replayed, or null. */
  run?: ExecutionTrace | null;
  /** Esc (with nothing else open) asks the host to drop `?run=`. */
  onClearRun?: () => void;
  /** Run input loader for the sidebar (defaults to the API; the harness
   *  stubs it). `ref` is the workflow the execution belongs to — the viewed
   *  one, or a related workflow's when its step is selected. */
  onLoadPayload?: (executionId: string, node: string, ref: WorkflowRef) => Promise<ExecutionPayload>;
  /** Traces of the run's related executions the host has fetched, keyed by
   *  execution id; the map overlays the ones whose workflow it renders. */
  relatedTraces?: ReadonlyMap<string, ExecutionTrace> | null;
  /** Related runs whose workflow is rendered as a pill (one per workflow):
   *  the host fetches their traces once and passes them as `relatedTraces`. */
  onRelatedWanted?: (runs: RelatedRun[]) => void;
  /** The canvas ground. `plane` is the history surface's: a shade off the
   *  reading view's, so the surface is unmistakably not it. */
  ground?: "viewport" | "plane";
  /** An active projection: per-node would-run states and per-field
   *  provenance. Structurally an `ExecutionTrace`, so the run overlay renders
   *  it unchanged — the node panel branches on its presence to tell an
   *  observed value from a computed one. */
  projection?: Projection | null;
  /** Replace one field of a step's input and re-project below it. */
  onOverrideField?: (nodeId: string, key: string, current: unknown) => void;
}

const TOOLS_KEY = "orrit.map.toolsHidden";

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
  onSelectEdge,
  shapes = null,
  onStepMissing,
  rightSlot,
  runSlot,
  marks,
  fetchDetail = defaultFetchDetail,
  now,
  run = null,
  onClearRun,
  onLoadPayload,
  relatedTraces = null,
  onRelatedWanted,
  ground = "viewport",
  projection = null,
  onOverrideField,
}: WorkflowMapViewProps) {
  const viewedKey = keyOf(viewed);
  const headingId = useId();

  /* ---------- state ---------- */

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    initialExpanded(linkMap, viewed),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* A selected connection: its group, the focused pairing (an edge key)
     and whether the focus came from the panel (pinned → node outlines). */
  const [selectedEdge, setSelectedEdge] = useState<{
    group: string;
    edge: string;
    pinned: boolean;
  } | null>(null);
  const [pairTick, setPairTick] = useState(0);
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
  /* Which rung of the ladder is drawn. Structure is the default at every
     size — there is no small-workflow floor under which a folding bug could
     hide, and it is the rung the legibility measurement is of. Overview is a
     deliberate move up, not the front door: on a drip chain with nothing
     repeating it would pack the whole workflow behind one count. */
  /*
   * The rung is navigation, not a preference, and deliberately not
   * remembered between visits: every workflow opens on its shape, and the
   * reader opens what they choose to open.
   *
   * It WAS stored, and that was a real regression. Resolving a `?step=` can
   * change the rung — that is how a link to a withheld step reveals it — and
   * with the rung persisted, one deep link left every workflow fully
   * expanded from then on, for that viewer, with nothing on screen
   * explaining why. A navigation move must never quietly rewrite a
   * preference, and the cheapest way to guarantee that is to have no
   * preference to rewrite.
   */
  const [layer, setLayerState] = useState<Layer>("structure");
  const setLayer = useCallback((l: Layer) => setLayerState(l), []);
  const rung = LAYERS.indexOf(layer);


  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  /* ---------- model ---------- */

  /* Keyed the way buildMap wants it; only the viewed workflow has shapes
     loaded, and an attached pill's steps simply do not group. */
  const shapeMap = useMemo(
    () => (shapes && shapes.elements.length > 0 ? new Map([[viewedKey, shapes]]) : null),
    [shapes, viewedKey],
  );
  const model = useMemo(
    () =>
      buildMap({
        viewed,
        linkMap,
        summaries: store.summaries,
        expanded,
        query: debounced,
        now,
        shapes: shapeMap,
        layer,
      }),
    // store.summaries is one long-lived Map; store.version is its change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewed, linkMap, store.summaries, store.version, expanded, debounced, now, shapeMap, layer],
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
  /* The model as of this render, for callbacks that must not re-create on
     every rebuild (the anchor search runs at click time, not render time). */
  const modelRef = useRef(model);
  modelRef.current = model;

  /*
   * Keep the thing the reader was looking at where it already is.
   *
   * A rung change rewrites the whole column — descending inserts seven cards
   * above the one that was clicked — so in a flow layout the anchor moves
   * even though nothing about the camera did. Correcting the scroll by that
   * delta is not a camera move and is not animated: it is what makes the
   * layout change fail to move what the reader is watching. Done this way
   * rather than by panning afterwards, because a pan is a second movement
   * the reader did not ask for, and because there is nothing to restore on
   * the way back out — the anchor is simply still where they left it.
   *
   * Zoom needs no correction: `getBoundingClientRect` is already in viewport
   * pixels, which is what `scrollLeft`/`scrollTop` are in too.
   */
  const anchor = useRef<{ id: string; x: number; y: number } | null>(null);
  /** The rendered card closest to the middle of the viewport — what the
   *  reader is looking at when they did not point at anything. */
  const centreMost = useCallback((): string | null => {
    const scroller = scrollNode.current;
    if (!scroller) return null;
    const box = scroller.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    let best: string | null = null;
    let bestD = Infinity;
    for (const node of modelRef.current.flat) {
      const el = elementOf(node.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < box.top || r.top > box.bottom) continue; // not on screen
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = node.id;
      }
    }
    return best;
  }, [elementOf]);
  const holdAnchor = useCallback(
    (id: string | null | undefined) => {
      /* No card was pointed at — a rung control, or Esc with nothing
         selected. Hold whatever is in the middle of the screen instead, so
         a rung change never slides the view out from under the reader. */
      const target = id ?? centreMost();
      const el = target ? elementOf(target) : null;
      if (!el || !target) {
        anchor.current = null;
        return;
      }
      const r = el.getBoundingClientRect();
      anchor.current = { id: target, x: r.left, y: r.top };
    },
    [elementOf, centreMost],
  );
  useLayoutEffect(() => {
    const held = anchor.current;
    anchor.current = null;
    const scroller = scrollNode.current;
    if (!held || !scroller) return;
    const el = elementOf(held.id);
    if (!el) return; // the anchor is gone from this rung; nothing to hold
    const r = el.getBoundingClientRect();
    const dx = r.left - held.x;
    const dy = r.top - held.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    scroller.scrollLeft += dx;
    scroller.scrollTop += dy;
  }, [model, elementOf]);
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

  /* Motion. Keyed on the viewed workflow, so the entrance plays once per
     view change and never from a fit, settle or resize. Off under reduced
     motion and under LITE, where the map already drops stagger and drift. */
  const motion = useMapMotion({
    innerElement: measure.innerElement,
    scrollElement: measure.scrollElement,
    viewKey: viewedKey,
    enabled: !reduced && !lite,
    requestMeasure: measure.schedule,
    selectedId,
  });

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
      focusTimer.current = window.setTimeout(() => {
        /* Eased when motion is on; the measure hook's own centring is the
           fallback, and the only path under LITE / reduced motion. Waiting
           FOCUS_DELAY_MS (380) also keeps this aiming at the viewport the
           sidebar leaves behind — it opens over SIDEBAR_MS (300), and
           measuring before it has is what once flew the camera to a centre
           computed for a viewport 322px wider than the one it landed in. */
        if (!motion.panTo(elementOf(id))) focusNode(id);
      }, FOCUS_DELAY_MS);
    },
    [focusNode, elementOf, motion],
  );
  useEffect(() => () => window.clearTimeout(focusTimer.current), []);

  /*
   * Changing rung, with its transition. The ladder's state is above; this is
   * the only way it should be entered, because a rung change that simply
   * re-renders reads as a screen being replaced rather than as moving into
   * something — and, going back out, as nothing at all.
   *
   * `origin` is the element the reader clicked: the push scales about it and
   * the next rung's cards arrive out of it, which is the visual thread
   * between the two. Null aims at the viewport centre, which is right for a
   * control that is not a card. Under reduced motion or LITE this is a
   * straight call to `apply`, so the ladder behaves identically.
   */
  const goLayer = useCallback(
    (l: Layer, origin: HTMLElement | null, anchorId?: string | null) => {
      if (l === layer) return;
      motion.changeLayer({
        origin,
        direction: LAYERS.indexOf(l) > rung ? "down" : "up",
        apply: () => {
          /* Hold whatever the reader was looking at — the card they clicked,
             else their selection — so the rung grows around it instead of
             sliding it out from under them. */
          holdAnchor(anchorId ?? selectedId);
          setLayer(l);
        },
      });
    },
    [motion, layer, rung, setLayer, holdAnchor, selectedId],
  );

  const select = useCallback(
    (node: MapNode | null) => {
      setSelectedId(node?.id ?? null);
      setSelectedEdge(null);
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

  /*
   * Open or close whatever this node holds — a pill's flow, or the arm a
   * fold card stands for. Closing it while something inside is selected
   * would leave the sidebar describing a card that is no longer drawn, so
   * the card itself is re-selected first. Ids are path-based, which is what
   * makes that one line enough; selection never rebuilds the model.
   */
  const setNodeOpen = useCallback(
    (node: MapNode, open: boolean) => {
      const key =
        node.fold && node.stepRef ? armKey(node.stepRef.key, node.fold.armId) : node.id;
      if (!open && selectedId != null && selectedId.startsWith(`${node.id}/`)) select(node);
      /* A pill goes through `withPillOpen`, which keeps a workflow called
         from several steps open at exactly one of them. Clicking a copy whose
         chip reads "open in Canceled" is simply opening it HERE: the reader's
         latest request wins, and the copy in Canceled then names this one. */
      setExpanded((e) => (node.pill ? withPillOpen(e, node, open) : { ...e, [key]: open }));
      animateUnfold();
    },
    [animateUnfold, select, selectedId],
  );

  /*
   * A pill's "Show steps": the same descent an arm opening in place is — the
   * reader asked to see what one card stands for — so it gets the same push
   * and the same arrival, and the steps fly out of the pill they belong to.
   * The anchor keeps the pill where it is, and there is no pan afterwards,
   * for the reason `drillIn` gives: a second movement would carry the origin
   * away from the steps still arriving out of it.
   */
  const toggleNode = useCallback(
    (node: MapNode) => {
      if (!canUnfold(node)) return;
      const open = !node.pill?.open;
      motion.changeLayer({
        origin: elementOf(node.id),
        direction: open ? "down" : "up",
        /* Hiding one workflow's steps is not a rung change: the rest of the
           screen stays put. */
        reannounce: false,
        apply: () => {
          holdAnchor(node.id);
          setNodeOpen(node, open);
        },
      });
    },
    [setNodeOpen, motion, elementOf, holdAnchor],
  );

  /*
   * A card's chip: show me what this stands for. What that means depends on
   * what is standing — an arm or a tile opens in place, while a card standing
   * for a whole fan-out or the Overview's packed run is the coarse rung
   * itself, so the only answer is to descend. One control, one meaning,
   * three mechanics.
   */
  const drillIn = useCallback(
    (node: MapNode) => {
      if (node.pack?.inPlace && node.stepRef) {
        /* A tile opens exactly as an arm does: the same push, its steps
           arriving out of the card, the card held where it is and no pan.
           It used to descend a rung, which answered "show me these two
           steps" by unfolding the entire workflow. */
        const open = !node.pack.open;
        const key = armKey(node.stepRef.key, node.stepRef.stepId);
        /* Folding it takes its steps away; a selection among them comes back
           to the card, as it does from a folded arm. */
        const inside = open ? [] : packedSteps(model, node);
        motion.changeLayer({
          origin: elementOf(node.id),
          direction: open ? "down" : "up",
          reannounce: false,
          apply: () => {
            holdAnchor(node.id);
            if (selectedId != null && inside.some((s) => selectedId === s.id || selectedId.startsWith(`${s.id}/`))) select(node);
            setExpanded((e) => ({ ...e, [key]: open }));
            animateUnfold();
          },
        });
        return;
      }
      if (node.pack || node.fold?.scope === "band") {
        /* No `focusLater` here on purpose. The anchor already keeps this card
           where it is, and a pan 380 ms later would take it away again —
           two movements for one gesture, and the second one undoing the
           property that makes the descent seamless. */
        goLayer(LAYERS[Math.min(rung + 1, LAYERS.length - 1)], elementOf(node.id), node.id);
        return;
      }
      if (!node.fold) return;
      /* An arm opening in place is a descent too — the reader asked to see
         what one card stands for — so it gets the same push and the same
         arrival. Its steps then fly out of the card they came from instead
         of doing a plain rise, which is the whole point of the origin. */
      const open = !node.fold.open;
      motion.changeLayer({
        origin: elementOf(node.id),
        direction: open ? "down" : "up",
        /* Closing one arm among many is not a rung change: it asked for
           something to go away, so the rest of the screen stays put. */
        reannounce: false,
        apply: () => {
          holdAnchor(node.id);
          setNodeOpen(node, open);
        },
      });
    },
    [setNodeOpen, goLayer, rung, motion, elementOf, holdAnchor, model, selectedId, select, animateUnfold],
  );

  const close = useCallback(() => select(null), [select]);

  /*
   * A click on the canvas itself closes what the reader has open — the mouse
   * equivalent of the first `Esc`, and nothing more: it closes the panel and
   * clears the node or connection selection, and never folds a card or
   * changes the rung.
   *
   * "The canvas itself" is decided by the event TARGET, not by what is under
   * the pointer, and it is a whitelist: the viewport, its slack pad, and the
   * zoomed content box. Everything a reader can act on — cards, chips, fold
   * controls, pills, edge hit-paths — is a pointer-events:auto descendant, so
   * a click on one targets it and never these three. The tree's layout
   * wrappers and the edge layer are pointer-events:none, so a click through
   * them lands on the content box, which is exactly the surface. The
   * toolbar, minimap and sidebar sit outside the viewport altogether.
   *
   * The click that ends a pan never arrives here: the camera's
   * `onClickCapture` swallows it and stops propagation before bubbling, so
   * dragging to look around cannot close what is open.
   */
  const closeOnCanvas = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (selectedId == null && selectedEdge == null) return;
      const t = e.target;
      const inner = innerNode.current;
      if (t !== e.currentTarget && t !== inner && t !== inner?.parentElement) return;
      close();
    },
    [selectedId, selectedEdge, close],
  );

  /* Sidebar "Show" on a Go to step: select + centre the jump target. */
  const showStep = useCallback(
    (key: string, stepId: string) => {
      const target = model.byStep.get(`${key}:${stepId}`);
      if (target) clickNode(target);
    },
    [model.byStep, clickNode],
  );
  useEscape(selectedId != null || selectedEdge != null, close);

  /* A dock tool took the slot: the sidebar yields. */
  const hasTool = rightSlot != null;
  useEffect(() => {
    if (hasTool) {
      setSelectedId(null);
      setSelectedEdge(null);
    }
  }, [hasTool]);

  /* ---------- run replay ---------- */

  const runActive = !!run && run.supported;
  /* Workflows rendered as pills (other than the viewed one), as one sorted
     string so the related-run bookkeeping only moves when the set does —
     not on every rebuild of the model. */
  const pillKeyList = useMemo(() => {
    const keys = new Set<string>();
    for (const n of model.flat) if (n.pill && n.ref && !n.isViewed) keys.add(keyOf(n.ref));
    return [...keys].sort().join("\n");
  }, [model]);
  /* The trace's related runs whose workflow is on the map — one per
     workflow, the first listed wins; the viewed workflow's own runs are the
     primary trace's business, never "related". */
  const relatedOnMap = useMemo((): RelatedRun[] => {
    if (!runActive || !run?.related?.length) return [];
    const onMap = new Set(pillKeyList.split("\n").filter(Boolean));
    const seen = new Set<string>();
    const out: RelatedRun[] = [];
    for (const r of run.related) {
      const key = keyOf({ source: r.provider, refId: r.workflowExternalId });
      if (key === viewedKey || seen.has(key) || !onMap.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [runActive, run, viewedKey, pillKeyList]);
  useEffect(() => {
    if (relatedOnMap.length > 0) onRelatedWanted?.(relatedOnMap);
  }, [relatedOnMap, onRelatedWanted]);
  /* The related traces the host handed back, keyed by workflow for the overlay. */
  const relatedByKey = useMemo(() => {
    const out = new Map<WorkflowKey, ExecutionTrace>();
    for (const r of relatedOnMap) {
      const t = relatedTraces?.get(r.executionId);
      if (t?.supported) out.set(keyOf({ source: r.provider, refId: r.workflowExternalId }), t);
    }
    return out;
  }, [relatedOnMap, relatedTraces]);
  /* While a projection is active it drives the overlay in place of the
     recorded trace — the canvas shows the path this input *would* take. The
     recorded trace stays as `run` for the sidebar's "Replay · in this run",
     which describes what actually happened and must not start describing a
     hypothesis. */
  const overlayTrace = useMemo(
    () => (projection ? projectionAsTrace(projection) : run),
    [projection, run],
  );
  const states = useMemo(
    () => runStates(model, viewedKey, overlayTrace, relatedByKey),
    [model, viewedKey, overlayTrace, relatedByKey],
  );
  const overlayActive = runActive || !!projection;
  const dimIds = useMemo(
    () => (overlayActive ? dimNodeIds(states) : undefined),
    [overlayActive, states],
  );
  const failIds = useMemo(
    () => (overlayActive ? failedNodeIds(states) : undefined),
    [overlayActive, states],
  );
  const runStateOf = useCallback(
    (node: MapNode) => states.get(node.id) ?? null,
    [states],
  );
  /* The trace that speaks for a node: the replayed run for the viewed
     workflow's steps, a related run for a related workflow's, else none. */
  const traceFor = useCallback(
    (node: MapNode): ExecutionTrace | null => {
      if (!runActive || !node.stepRef) return null;
      return node.stepRef.key === viewedKey ? run : (relatedByKey.get(node.stepRef.key) ?? null);
    },
    [runActive, run, viewedKey, relatedByKey],
  );
  const runErrorOf = useCallback(
    (node: MapNode): string | null => {
      if (node.kind !== "step" || !node.stepRef) return null;
      const tn = traceNodeFor(traceFor(node), node.stepRef.stepId);
      return tn?.error ?? tn?.warning ?? null;
    },
    [traceFor],
  );
  /* A related workflow's pill: "ran 2h ago · failed" on its meta line (every
     copy of the pill — the run happened whichever step it hangs under). */
  const runMetaOf = useCallback(
    (node: MapNode): string | null => {
      if (!node.pill || !node.ref) return null;
      const ex = relatedByKey.get(keyOf(node.ref))?.execution;
      if (!ex) return null;
      return `ran ${ago(ex.startedAt, now ?? Date.now())} · ${runStatusWord(ex.status)}`;
    },
    [relatedByKey, now],
  );
  /* The run's escape layer sits under the selection and the dock: Esc
     closes those first, the next Esc stops the replay. */
  useEscape(
    runActive && !!onClearRun && selectedId == null && selectedEdge == null && !hasTool,
    () => onClearRun?.(),
  );

  /*
   * Esc climbs the ladder back up, under everything else: panel, then
   * replay, then whatever was opened in place, then the rung itself.
   * Closing the panel stays the first thing Esc does — that is what it has
   * always done, and what a reader expects of an open panel — but Esc is
   * never swallowed, so no way down is ever without a way back.
   *
   * "Opened in place" is one rung, not three: a press puts the rung back to
   * how it draws itself, arms folded and members grouped, rather than
   * undoing clicks one at a time. Pill expansion is keyed by node id and is
   * a different axis, so it is untouched.
   */
  const drilledIn = useMemo(
    () => Object.entries(expanded).some(([k, v]) => v && k.startsWith("arm:")),
    [expanded],
  );
  const canAscend = drilledIn || rung > 0;
  const ascend = useCallback(() => {
    if (drilledIn) {
      /* Collapsing what was opened in place removes cards and adds none, so
         without the transition there is nothing left to animate and the way
         back is a snap. The pull re-announces the rung being returned to. */
      motion.changeLayer({
        origin: null,
        direction: "up",
        reannounce: false,
        apply: () => {
          holdAnchor(selectedId);
          setExpanded((e) =>
            Object.fromEntries(Object.entries(e).filter(([k, v]) => !(v && k.startsWith("arm:")))),
          );
          animateUnfold();
        },
      });
      return;
    }
    goLayer(LAYERS[Math.max(0, rung - 1)], null);
  }, [drilledIn, animateUnfold, goLayer, rung, motion, holdAnchor, selectedId]);
  useEscape(
    canAscend && selectedId == null && selectedEdge == null && !hasTool && !runActive,
    ascend,
  );

  const expandAll = useCallback(() => {
    setExpanded((e) => expandAllSnapshot(model, e));
    animateUnfold();
  }, [model, animateUnfold]);

  const collapseAll = useCallback(() => {
    setExpanded({});
    select(null);
    animateUnfold();
  }, [select, animateUnfold]);

  /* A tile opens in place through its own chip's path, which keys it by its
     step rather than by node id. */
  const onExpand = useCallback((n: MapNode) => (n.pack?.inPlace ? drillIn(n) : setNodeOpen(n, true)), [setNodeOpen, drillIn]);
  const onCollapse = useCallback((n: MapNode) => (n.pack?.inPlace ? drillIn(n) : setNodeOpen(n, false)), [setNodeOpen, drillIn]);

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

  /*
   * A link names a step, never a view state — so opening one expands exactly
   * what stands between the map and that step, one level per rebuild, and
   * nothing else. `hiddenSteps` says which card holds it; opening that card
   * re-runs this effect, which converges because every hop draws strictly
   * more. When nothing renders it and nothing can, the step is gone: the
   * request is dropped and the host is told, rather than the link silently
   * doing nothing — the one gap this inherited and does not keep.
   */
  useEffect(() => {
    if (pendingStep == null) return;
    const stepKey = `${viewedKey}:${pendingStep}`;
    const node = model.byStep.get(stepKey);
    if (node) {
      setPendingStep(null);
      select(node);
      focusLater(node.id);
      return;
    }
    const holding = model.hiddenSteps.get(stepKey);
    if (holding) {
      /* Something stands in the way: reveal it and let this run again. A
         coarse rung is revealed by descending, a card by opening it — the
         link itself carries neither, it only ever names the step. A step the
         map knows it is holding is never reported missing. */
      const rungWanted = revealLayer(holding);
      if (rungWanted) setLayer(rungWanted);
      else if (!expanded[holding]) setExpanded((e) => ({ ...e, [holding]: true }));
      return;
    }
    const pid = viewedPillId(model, viewed);
    if (pid && !expanded[pid] && canUnfold(model.byId.get(pid)!)) {
      setExpanded((e) => ({ ...e, [pid]: true }));
      return;
    }
    /* The viewed workflow's steps are loaded and none of them is this one. */
    if (store.summaries.get(viewedKey)?.state !== "ok") return;
    setPendingStep(null);
    onStepParam?.(null);
    onStepMissing?.(pendingStep);
  }, [
    model,
    pendingStep,
    viewedKey,
    viewed,
    expanded,
    select,
    focusLater,
    store.summaries,
    onStepParam,
    onStepMissing,
    setLayer,
  ]);

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

  /* The sidebar's run: the replayed run for a viewed step, the related run
     for a related workflow's step. "Load input" fetches through for THAT
     execution, from its own workflow. */
  const selectedTrace = selectedNode ? traceFor(selectedNode) : null;
  const selectedRunRelated = selectedTrace != null && selectedTrace !== run;
  const loadPayload = useCallback(
    (node: string) => {
      const executionId = selectedTrace?.execution?.executionId;
      const ref = selectedNode?.stepRef ? parseKey(selectedNode.stepRef.key) : null;
      if (!executionId || !ref) return Promise.reject(new Error("No run is being replayed."));
      return onLoadPayload
        ? onLoadPayload(executionId, node, ref)
        : fetchExecutionPayload(ref.source, ref.refId, executionId, node);
    },
    [selectedTrace, selectedNode, onLoadPayload],
  );

  /* Step data for the replayed run: one fetch when a run opens, held while it
     stays open so paging operations does not re-hit the platform, and dropped
     the moment the run is cleared. The server never caches it (`no-store`) —
     this is a view of one open run, not a store. */
  const runExecutionId = run?.execution?.executionId ?? null;
  const [bundles, setBundles] = useState<ExecutionBundles | null>(null);
  const [bundlesLoading, setBundlesLoading] = useState(false);
  useEffect(() => {
    if (!runExecutionId || runs?.runtime?.bundles === false) {
      setBundles(null);
      return;
    }
    let live = true;
    setBundlesLoading(true);
    fetchBundles(viewed.source, viewed.refId, runExecutionId)
      .then((d) => live && setBundles(d))
      .catch(() => live && setBundles(null))
      .finally(() => live && setBundlesLoading(false));
    return () => {
      live = false;
    };
  }, [runExecutionId, viewed.source, viewed.refId, runs?.runtime?.bundles]);

  const cardFor = (node: MapNode) =>
    node.ref
      ? linkMap?.workflows.find(
          (w) => w.source === node.ref!.source && w.refId === node.ref!.refId,
        )
      : undefined;

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

  /* Connection groups over the measured edges (hover labels, selection). */
  const { groups: edgeGroups, infoOf: edgeInfo } = useMemo(
    () => groupEdges(measure.edges, model.byId),
    [measure.edges, model.byId],
  );
  const selectedGroup =
    selectedEdge && edgeGroups.has(selectedEdge.group)
      ? edgeGroups.get(selectedEdge.group)!
      : null;
  /* Canvas click: select the group, focus the clicked pairing, no outlines. */
  const selectEdge = useCallback(
    (edgeKey: string) => {
      const info = edgeInfo.get(edgeKey);
      if (!info) return;
      const focus =
        edgeGroups
          .get(info.group)
          ?.pairs.find((p) => p.from === info.from && p.to === info.to)
          ?.edgeKey ?? edgeKey;
      setSelectedEdge({ group: info.group, edge: focus, pinned: false });
      setSelectedId(null);
      onStepParam?.(null);
      onSelectEdge?.();
    },
    [edgeInfo, edgeGroups, onStepParam, onSelectEdge],
  );
  const focusedPair = useMemo(
    () =>
      selectedGroup && selectedEdge
        ? (selectedGroup.pairs.find((p) => p.edgeKey === selectedEdge.edge) ??
          selectedGroup.pairs[0] ??
          null)
        : null,
    [selectedGroup, selectedEdge],
  );
  /* Inner-space rect of a node element (for framing a pairing). */
  const innerRectOf = useCallback(
    (id: string) => {
      const el = elementOf(id);
      const inner = innerNode.current;
      if (!el || !inner) return null;
      const r = el.getBoundingClientRect();
      const ir = inner.getBoundingClientRect();
      const z = zoom || 1;
      return {
        x: (r.left - ir.left) / z,
        y: (r.top - ir.top) / z,
        w: r.width / z,
        h: r.height / z,
      };
    },
    [elementOf, zoom],
  );
  /* Panel click: focus a pairing — light its route, outline both nodes,
     frame them (zoom 0.5–1, 60px padding), pulse once. */
  const fitRect = camera.fitRect;
  const focusPair = useCallback(
    (edgeKey: string) => {
      const info = edgeInfo.get(edgeKey);
      if (!info) return;
      setSelectedEdge({ group: info.group, edge: edgeKey, pinned: true });
      setPairTick((t) => t + 1);
      const a = innerRectOf(info.from);
      const b = innerRectOf(info.to);
      if (!a || !b) return;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      fitRect(
        {
          x,
          y,
          w: Math.max(a.x + a.w, b.x + b.w) - x,
          h: Math.max(a.y + a.h, b.y + b.h) - y,
        },
        { padding: 60, minZoom: 0.5, maxZoom: 1 },
      );
    },
    [edgeInfo, innerRectOf, fitRect],
  );
  /*
   * Frame the run: once per run id, as soon as the map has measured the
   * nodes it touched, fit the camera to them. `runFocusRect` decides the
   * rect and the bounds (whole path, or the failure alone when the path
   * sprawls); this only supplies the measured rects and calls the camera.
   *
   * Once per run id is the whole contract: it never fires on a re-render, a
   * re-measure, a selection or a pan, so the user's own camera is never
   * taken away from them. A run whose nodes are not measured yet leaves the
   * ref unset and is framed on the render that measures them.
   */
  const framedRun = useRef<string | null>(null);
  const boxes = measure.boxes;
  useEffect(() => {
    const rid = runActive ? (run?.execution?.executionId ?? null) : null;
    if (!rid) {
      framedRun.current = null;
      return;
    }
    if (framedRun.current === rid) return;
    const rects = new Map(boxes.map((b) => [b.id, { x: b.x, y: b.y, w: b.w, h: b.h }]));
    const focus = runFocusRect(states, rects);
    if (!focus) return;
    framedRun.current = rid;
    fitRect(focus.rect, { padding: focus.padding, minZoom: focus.minZoom, maxZoom: focus.maxZoom });
  }, [runActive, run, states, boxes, fitRect]);

  const pairRoleOf = useCallback(
    (id: string): "source" | "target" | null => {
      if (!selectedEdge?.pinned || !focusedPair) return null;
      return focusedPair.from === id
        ? "source"
        : focusedPair.to === id
          ? "target"
          : null;
    },
    [selectedEdge, focusedPair],
  );

  const ctx: TreeCtx = {
    selectedId,
    pairRoleOf,
    pairTick,
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
    onDrillIn: drillIn,
    srNoteFor: marks ? noteFor : undefined,
    isFreshGroup,
    // A projection lights the canvas through the same overlay as a recorded
    // run, so the tree's run flag follows whichever is active.
    runActive: overlayActive,
    runStateOf,
    runErrorOf,
    runMetaOf,
  };

  const hasRunSlot = runSlot != null;
  const slotOpen = selectedNode != null || selectedGroup != null || hasTool || hasRunSlot;
  const filtering = debounced.trim().length > 0;

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={400}>
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col ${lite ? "wm-lite" : ""} ${overlayActive ? "wm-run" : ""}`}
      >
        <div className="flex min-h-0 flex-1">
          {/* contain:paint + isolate: the canvas is its own stacking context AND
            the containing block for every descendant (fixed included), so
            nothing inside it — dots, edges, toolbar, minimap, z-indexed tree —
            can paint outside its box under any stylesheet. */}
          <div className={`relative isolate min-w-0 flex-1 overflow-hidden [contain:paint] ${ground === "plane" ? "bg-plane" : "bg-vpbg"}`}>
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
              onClick={closeOnCanvas}
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
                    infoOf={edgeInfo}
                    selectedGroup={selectedGroup?.key ?? null}
                    focusedEdge={focusedPair?.edgeKey ?? null}
                    onSelectEdge={selectEdge}
                    onGeometry={measure.onGeometry}
                    track={measure.unfolding || lite || reduced}
                    lite={lite}
                    paused={!visible}
                    dimIds={dimIds}
                    failIds={failIds}
                  />
                  <h2 id={headingId} className="sr-only">
                    Workflow map
                  </h2>
                  <div
                    role="tree"
                    aria-labelledby={headingId}
                    className="pointer-events-none relative z-[1] select-none"
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
              layer={layer}
              onLayer={(l) => goLayer(l, null)}
              withheld={model.counts.withheld}
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
              dimIds={dimIds}
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
                  detail={detail}
                  onClose={close}
                  onShowStep={showStep}
                  note={noteFor(selectedNode)}
                  run={selectedTrace}
                  runRelated={selectedRunRelated}
                  onLoadPayload={loadPayload}
                  bundles={bundles}
                  bundlesLoading={bundlesLoading}
                  projectedFields={projection?.fields}
                  onOverrideField={onOverrideField}
                />
              ) : selectedGroup ? (
                <MapEdgeSidebar
                  key={selectedGroup.key}
                  group={selectedGroup}
                  focused={focusedPair}
                  onFocusPair={focusPair}
                  onOpen={clickNode}
                  onClose={close}
                />
              ) : hasTool ? (
                rightSlot
              ) : (
                runSlot
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
