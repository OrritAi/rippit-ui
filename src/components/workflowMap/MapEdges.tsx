"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
} from "react";
import type { EdgeInfo } from "@/lib/workflowMap/edgeGroups";
import { EDGE_TWEEN_MS } from "@/lib/workflowMap/tokens";
import { MapTip } from "./MapTip";
import type { MapEdge } from "./useMapMeasure";

/*
 * MapEdges — one dashed bezier per measured parent→child pair, plus a
 * travelling pulse dot on every edge touching the selected node. Absolute,
 * pointer-events none, so committing edges never changes geometry.
 *
 *   .wm-edge       deeper edges   --driftc · 1.5 · 5 7 · drift 1.4 s
 *   .wm-edge-root  depth 0        accent 60 % · same dash + timing
 *   .wm-edge-hot   touches sel    accent · 2 · 6 7 · drift 1 s + pulse
 *   .wm-edge-fan   one of ≥ 6 from a parent · stroke-opacity .55 (hot wins)
 *   trunk          one per elbow parent (`data-trunk`, no data-from/to) —
 *                  single stroke weight; hot whenever one of its stubs is;
 *                  its stubs carry `data-stub="<trunk key>"`
 *   .wm-edge-chain step → next step along a row (`data-anchor="h"`) or down a
 *                  connected workflow's column (`data-anchor="v"`): solid, no
 *                  drift — a short straight connector like the platforms'
 *   drop           step → a pill hanging below it (`data-anchor="drop"`):
 *                  down from the step, into the pill — a regular edge
 *   .wm-edge-join  a branch tail into a shared step — the regular deep edge
 *   .wm-edge-jump  a "Go to" step to its target · dashed 2 5 · arrowhead
 *                  (the marker is drawn at the end point and never moves it)
 *
 * Geometry is applied imperatively, not through React props: a bezier path
 * keeps its last drawn coordinates and, when a new bezier measurement
 * arrives, tweens to the new ones (EDGE_TWEEN_MS, ease-out) so a relayout —
 * filter, labels hiding, the sidebar opening — moves lines instead of
 * snapping them. Elbow paths (fan-outs, tall columns) and any change of
 * shape are applied directly. While
 * `track` is true (the measure loop is following an unfold / entrance
 * animation frame by frame, or the map is LITE / reduced motion) the
 * coordinates are set directly. New edges fade in via `.wm-edge`'s second
 * keyframe. `lite` drops the pulses; `paused` freezes the ambience while
 * the tab is hidden. Moving a path also drops any `stroke-dasharray` on it:
 * a dash is a length along one specific `d`, so the motion layer's edge draw
 * cannot outlive the geometry it measured — see `apply`.
 *
 * Interaction: every visible path has an invisible 14px hit path beside it
 * (`data-hit`, `pointer-events: stroke`, role=button, tab-reachable) inside
 * `<g data-edge>`; a trunk and its stubs share one `<g data-group>`. Hover
 * and keyboard focus light the whole group through CSS alone
 * (`.wm-group:hover`, no React state) and show a tooltip with the
 * connection's label; click / Enter / Space call `onSelectEdge`, and the
 * selected group keeps the hot look via `data-selected`. A hit path carries
 * its edge key on `data-hit` rather than on `data-edge`, and no data-from/to,
 * so geometry scripts and the motion layer skip it on the attribute alone
 * while this file can still pair it with the line it shadows.
 *
 * Run replay: `dimIds` (nodes the run did not reach / could not check) and
 * `failIds` (the failed node). An edge with BOTH ends dimmed fades like an
 * edge outside a selected connection (`.wm-edge-rundim`); the failed node's
 * incoming edge carries the error colour (`.wm-edge-runfail`). A selected
 * connection still wins while one is open. Classes only — geometry never
 * changes.
 */

const NUM = /-?\d+(?:\.\d+)?/g;
/** A bezier `M … C …` parses to exactly 8 numbers; anything else is an elbow. */
const parse = (d: string) =>
  d.includes(" C ") ? (d.match(NUM) ?? []).map(Number) : [];
const format = (n: number[]) =>
  `M ${n[0]} ${n[1]} C ${n[2]} ${n[3]}, ${n[4]} ${n[5]}, ${n[6]} ${n[7]}`;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const HIT_STYLE = {
  fill: "none",
  stroke: "transparent",
  strokeWidth: 14,
  pointerEvents: "stroke",
  cursor: "pointer",
  outline: "none",
} as const;

interface Tween {
  from: number[];
  to: number[];
  t0: number;
}

export const MapEdges = memo(function MapEdges({
  edges,
  selectedId,
  lite,
  paused,
  track,
  zoom,
  infoOf,
  selectedGroup,
  focusedEdge,
  onSelectEdge,
  onGeometry,
  dimIds,
  failIds,
}: {
  edges: MapEdge[];
  selectedId: string | null;
  lite: boolean;
  paused: boolean;
  /** Set coordinates directly (no tween) — an animation is being followed. */
  track: boolean;
  /** Coordinates are zoom-independent (inner space), but a measurement that
   *  lands with a new zoom is set directly, never tweened. */
  zoom: number;
  /** Per-edge connection info (group key + label), from `groupEdges`. */
  infoOf: ReadonlyMap<string, EdgeInfo>;
  /** The selected connection group, if any. */
  selectedGroup: string | null;
  /** The focused pairing inside it: that stub (+ its trunk) renders hot, the
   *  rest of the group at 45 %, everything else dimmed to 18 %. */
  focusedEdge: string | null;
  onSelectEdge: (edgeKey: string) => void;
  /** Register this component's geometry writer with the measure hook, so a
   *  measurement taken outside a React commit reaches the paths in the same
   *  frame rather than a render later. */
  onGeometry: (fn: ((list: MapEdge[]) => void) | null) => void;
  /** Run replay: nodes to dim (untouched ∪ unknown) and the failed nodes. */
  dimIds?: ReadonlySet<string>;
  failIds?: ReadonlySet<string>;
}) {
  const lastZoom = useRef(zoom);
  /* `track` and `zoom` as refs too: `applyList` is called from outside React
     by the measure hook, where the render's closure is not available. */
  const trackRef = useRef(track);
  const zoomRef = useRef(zoom);
  const layer = useRef<SVGSVGElement | null>(null);
  const paths = useRef(new Map<string, SVGPathElement>());
  const hits = useRef(new Map<string, SVGPathElement>());
  const pulses = useRef(new Map<string, HTMLDivElement>());
  /** Last drawn geometry per key: the bezier numbers (8) or the raw d. */
  const shown = useRef(new Map<string, { nums: number[]; d: string }>());
  const tweens = useRef(new Map<string, Tween>());
  const raf = useRef(0);

  const apply = useCallback((key: string, nums: number[], raw?: string) => {
    const d = nums.length === 8 ? format(nums) : (raw ?? "");
    const moved = shown.current.get(key)?.d !== d;
    shown.current.set(key, { nums, d });
    const path = paths.current.get(key);
    if (path) {
      path.setAttribute("d", d);
      /*
       * A dash is a length measured along a specific `d`. The motion layer's
       * edge draw computes one from `getTotalLength()` and holds it for the
       * length of the tween — so the moment the geometry underneath it
       * changes, that dash describes a path that no longer exists, and the
       * line renders as a repeating fragment along the new one. (Measured: a
       * trunk drawn at 537px that grew to 8373px when an arm opened.)
       *
       * This is the only place `d` changes, so it is the only place that can
       * know. Dropping the dash ends the draw for that line and leaves it
       * solid and correct, which is strictly better than a correct-looking
       * animation of the wrong shape. `strokeDashoffset` is left to the
       * tween: with no dash array it paints nothing, and the motion layer's
       * own settle clears both.
       *
       * Only when the geometry actually moved — a re-applied identical `d`
       * invalidates nothing, and clearing then would cancel a draw that is
       * running perfectly well.
       */
      if (moved && path.style.strokeDasharray) path.style.strokeDasharray = "";
    }
    hits.current.get(key)?.setAttribute("d", d);
    const pulse = pulses.current.get(key);
    if (pulse) pulse.style.offsetPath = `path("${d}")`;
  }, []);

  /* One rAF loop for every active tween; stops itself when none remain. */
  const startLoop = useCallback(() => {
    if (raf.current) return;
    function tick() {
      const now = performance.now();
      for (const [key, tw] of tweens.current) {
        const t = Math.min(1, (now - tw.t0) / EDGE_TWEEN_MS);
        const e = easeOut(t);
        apply(
          key,
          tw.to.map((v, i) => tw.from[i] + (v - tw.from[i]) * e),
        );
        if (t >= 1) tweens.current.delete(key);
      }
      raf.current = tweens.current.size > 0 ? requestAnimationFrame(tick) : 0;
    }
    raf.current = requestAnimationFrame(tick);
  }, [apply]);

  /*
   * Apply a measurement: tween or set every path, prune what left.
   *
   * Factored out of the layout effect because it is also the function
   * `useMapMeasure` calls directly — see `onGeometry` below. `rescan` refreshes
   * the element maps and is only meaningful from the layout effect, which is
   * the only place the set of path elements can have changed.
   */
  const applyList = useCallback(
    (list: MapEdge[], rescan: boolean) => {
      /*
       * The element maps, rebuilt from the DOM rather than from ref callbacks.
       *
       * A ref callback per path costs a detach and an attach every time its
       * identity changes, and this component re-renders once per measured
       * frame during an unfold — so per-render closures meant ~400
       * detach/attach pairs a frame on a 137-step workflow, each one a Map
       * delete, a Map set and a `setAttribute`. That is paid in exactly the
       * frames the lines are trying to keep up with moving cards. One query
       * per commit, on the other hand, is paid once per model change and never
       * per frame, and the elements cannot change without one.
       */
      const svg = layer.current;
      if (rescan && svg) {
        paths.current.clear();
        hits.current.clear();
        for (const el of svg.querySelectorAll<SVGPathElement>("path[data-edge], path[data-hit]")) {
          const hit = el.dataset.hit;
          if (hit) hits.current.set(hit, el);
          else if (el.dataset.edge) paths.current.set(el.dataset.edge, el);
        }
      }
      const live = new Set<string>();
      const now = performance.now();
      const direct = trackRef.current || zoomRef.current !== lastZoom.current;
      lastZoom.current = zoomRef.current;
      for (const e of list) {
        live.add(e.key);
        const to = parse(e.d);
        const cur = shown.current.get(e.key);
        if (!cur || direct || to.length !== 8 || cur.nums.length !== 8) {
          tweens.current.delete(e.key);
          apply(e.key, to, e.d);
          continue;
        }
        if (cur.nums.every((v, i) => v === to[i])) {
          tweens.current.delete(e.key);
          continue;
        }
        /* A line the motion layer is holding is invisible, so there is nothing
           to smooth, and it has to have its final shape when its draw begins. */
        if (paths.current.get(e.key)?.closest("[data-wm-undrawn]")) {
          tweens.current.delete(e.key);
          apply(e.key, to, e.d);
          continue;
        }
        tweens.current.set(e.key, { from: cur.nums, to, t0: now });
      }
      for (const key of [...shown.current.keys()])
        if (!live.has(key)) shown.current.delete(key);
      for (const key of [...tweens.current.keys()])
        if (!live.has(key)) tweens.current.delete(key);
      if (tweens.current.size > 0) startLoop();
    },
    [apply, startLoop],
  );

  useLayoutEffect(() => {
    trackRef.current = track;
    zoomRef.current = zoom;
    applyList(edges, true);
  }, [edges, track, zoom, applyList]);

  /*
   * Take the measurement directly, without waiting for it to arrive as a prop.
   *
   * A measure can happen outside any React commit — a row resizing, a skipped
   * row being laid out — and on a large map the render that would carry the
   * coordinates is a frame away. Registering here keeps this file the only
   * writer of `d` while letting it be told as soon as the numbers exist. The
   * props path still runs and re-asserts the same numbers, which is a no-op.
   */
  useLayoutEffect(() => {
    onGeometry((list) => applyList(list, false));
    return () => onGeometry(null);
  }, [onGeometry, applyList]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* The pulses live outside the <svg>, as absolutely positioned siblings, so
     they are the one thing still collected by a ref callback. There are at
     most a handful — only the edges touching the selected node, and none
     under LITE — so the per-render closure costs nothing here. */
  const pulseRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) {
        pulses.current.set(key, el);
        const cur = shown.current.get(key);
        if (cur) el.style.offsetPath = `path("${cur.d}")`;
      } else pulses.current.delete(key);
    },
    [],
  );

  const play = paused ? { animationPlayState: "paused" as const } : undefined;
  /* A trunk is hot when any of its stubs is (parent or one child selected). */
  const hotTrunks = new Set<string>();
  if (selectedId != null)
    for (const e of edges)
      if (e.stub && (e.from === selectedId || e.to === selectedId))
        hotTrunks.add(e.stub);
  const hot = (e: MapEdge) =>
    selectedId != null &&
    (e.kind === "trunk"
      ? hotTrunks.has(e.key)
      : e.from === selectedId || e.to === selectedId);
  /* Connection selection: the focused pair's route (its stub + trunk, or the
     edge itself) is hot, the rest of the group stays readable, everything
     else dims. */
  const focusedStub = focusedEdge ? edges.find((m) => m.key === focusedEdge)?.stub : undefined;
  /* Run replay: dim an edge whose both ends are dimmed (a trunk when every
     stub off it is), colour the failed node's incoming edge. */
  const runState = (e: MapEdge): string => {
    if (!dimIds && !failIds) return "";
    if (e.kind === "trunk") {
      if (e.fanIn && failIds?.has(e.to)) return " wm-edge-runfail";
      const stubs = edges.filter((m) => m.stub === e.key);
      return stubs.length > 0 && stubs.every((m) => dimIds?.has(m.from) && dimIds?.has(m.to)) ? " wm-edge-rundim" : "";
    }
    if (failIds?.has(e.to)) return " wm-edge-runfail";
    if (dimIds?.has(e.from) && dimIds?.has(e.to)) return " wm-edge-rundim";
    return "";
  };
  const focusState = (e: MapEdge): string => {
    if (!selectedGroup) return runState(e);
    const gk = infoOf.get(e.key)?.group ?? e.key;
    if (gk !== selectedGroup) return " wm-edge-dim";
    if (!focusedEdge) return " wm-edge-groupd";
    const onRoute = e.key === focusedEdge || (e.kind === "trunk" && focusedStub === e.key);
    return onRoute ? " wm-edge-focus" : " wm-edge-groupd";
  };
  /* Group order = first-seen order of the edge list. */
  const groups = new Map<string, MapEdge[]>();
  for (const e of edges) {
    const gk = infoOf.get(e.key)?.group ?? e.key;
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(e);
  }
  const onHitKey = (e: KeyboardEvent<SVGPathElement>, key: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectEdge(key);
    }
  };
  return (
    <>
      <svg
        ref={layer}
        aria-hidden="false"
        /* `useMapMeasure` takes its client-pixels → user-space mapping from
           this element's own `getScreenCTM()`, so it needs to find it without
           guessing which `<svg>` in the content box is the edge layer. */
        data-edge-layer=""
        className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
      >
        <defs>
          <marker
            id="wm-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 1 1 L 7 4 L 1 7 Z" fill="var(--driftc)" />
          </marker>
          <marker
            id="wm-arrow-hot"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 1 1 L 7 4 L 1 7 Z" fill="var(--map-accent)" />
          </marker>
        </defs>
        {[...groups].map(([gk, members]) => (
          <g
            key={gk}
            data-group={gk}
            data-selected={selectedGroup === gk ? "true" : undefined}
            className="wm-group"
          >
            {members.map((e) => {
              const info = infoOf.get(e.key);
              const label = info?.label ?? `${e.from} → ${e.to}`;
              return (
                <g key={e.key} data-edge={e.key}>
                  <path
                    data-edge={e.key}
                    data-from={e.kind === "trunk" ? undefined : e.from}
                    data-to={e.kind === "trunk" ? undefined : e.to}
                    data-trunk={e.kind === "trunk" ? e.key : undefined}
                    data-stub={e.stub}
                    data-fanin={e.fanIn ? "true" : undefined}
                    data-kind={e.kind}
                    data-anchor={e.anchor}
                    d={e.d}
                    markerEnd={
                      e.kind === "jump"
                        ? `url(#${hot(e) ? "wm-arrow-hot" : "wm-arrow"})`
                        : undefined
                    }
                    className={`wm-edge${e.depth === 0 && e.kind === "tree" && e.anchor !== "h" && e.anchor !== "v" ? " wm-edge-root" : ""}${e.fan ? " wm-edge-fan" : ""}${e.anchor === "h" || e.anchor === "v" ? " wm-edge-chain" : ""}${e.kind === "join" ? " wm-edge-join" : ""}${e.kind === "jump" ? " wm-edge-jump" : ""}${hot(e) ? " wm-edge-hot" : ""}${focusState(e)}`}
                    style={play}
                  />
                  <MapTip label={label}>
                    <path
                      d={e.d}
                      data-hit={e.key}
                      role="button"
                      tabIndex={0}
                      aria-label={`Connection: ${label}`}
                      className="wm-hit"
                      /* Inline so the hit area exists even before the stylesheet
                         updates (dev HMR can lag on globals.css). */
                      style={HIT_STYLE}
                      onClick={() => onSelectEdge(e.key)}
                      onKeyDown={(ev) => onHitKey(ev, e.key)}
                    />
                  </MapTip>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {!lite &&
        selectedId != null &&
        edges
          .filter(hot)
          .map((e) => (
            <div
              key={e.key}
              ref={pulseRef(e.key)}
              aria-hidden="true"
              className="wm-pulse"
              style={{ offsetPath: `path("${e.d}")`, ...play }}
            />
          ))}
    </>
  );
});
