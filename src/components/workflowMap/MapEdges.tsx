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
 *   .wm-edge-chain step → next step in a column (`data-anchor="v"`): solid,
 *                  no drift — a short vertical connector like the platforms'
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
 * the tab is hidden.
 *
 * Interaction: every visible path has an invisible 14px hit path beside it
 * (`data-hit`, `pointer-events: stroke`, role=button, tab-reachable) inside
 * `<g data-edge>`; a trunk and its stubs share one `<g data-group>`. Hover
 * and keyboard focus light the whole group through CSS alone
 * (`.wm-group:hover`, no React state) and show a tooltip with the
 * connection's label; click / Enter / Space call `onSelectEdge`, and the
 * selected group keeps the hot look via `data-selected`. Hit paths carry no
 * data-from/to, so geometry scripts never read them.
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
}) {
  const lastZoom = useRef(zoom);
  const paths = useRef(new Map<string, SVGPathElement>());
  const hits = useRef(new Map<string, SVGPathElement>());
  const pulses = useRef(new Map<string, HTMLDivElement>());
  /** Last drawn geometry per key: the bezier numbers (8) or the raw d. */
  const shown = useRef(new Map<string, { nums: number[]; d: string }>());
  const tweens = useRef(new Map<string, Tween>());
  const raf = useRef(0);

  const apply = useCallback((key: string, nums: number[], raw?: string) => {
    const d = nums.length === 8 ? format(nums) : (raw ?? "");
    shown.current.set(key, { nums, d });
    paths.current.get(key)?.setAttribute("d", d);
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

  /* New measurement: tween or set every path, prune what left. */
  useLayoutEffect(() => {
    const live = new Set<string>();
    const now = performance.now();
    const direct = track || zoom !== lastZoom.current;
    lastZoom.current = zoom;
    for (const e of edges) {
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
      tweens.current.set(e.key, { from: cur.nums, to, t0: now });
    }
    for (const key of [...shown.current.keys()])
      if (!live.has(key)) shown.current.delete(key);
    for (const key of [...tweens.current.keys()])
      if (!live.has(key)) tweens.current.delete(key);
    if (tweens.current.size > 0) startLoop();
  }, [edges, track, zoom, apply, startLoop]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* Ref callbacks: MapEdges is memoised, so it only re-renders (and React
     only re-attaches these) when the edge list or the selection changed. */
  const pathRef = useCallback(
    (key: string) => (el: SVGPathElement | null) => {
      if (el) {
        paths.current.set(key, el);
        const cur = shown.current.get(key);
        if (cur) el.setAttribute("d", cur.d);
      } else paths.current.delete(key);
    },
    [],
  );
  const hitRef = useCallback(
    (key: string) => (el: SVGPathElement | null) => {
      if (el) {
        hits.current.set(key, el);
        const cur = shown.current.get(key);
        if (cur) el.setAttribute("d", cur.d);
      } else hits.current.delete(key);
    },
    [],
  );
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
  const focusState = (e: MapEdge): string => {
    if (!selectedGroup) return "";
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
        aria-hidden="false"
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
                    ref={pathRef(e.key)}
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
                    className={`wm-edge${e.depth === 0 && e.kind === "tree" && !e.anchor ? " wm-edge-root" : ""}${e.fan ? " wm-edge-fan" : ""}${e.anchor === "v" ? " wm-edge-chain" : ""}${e.kind === "join" ? " wm-edge-join" : ""}${e.kind === "jump" ? " wm-edge-jump" : ""}${hot(e) ? " wm-edge-hot" : ""}${focusState(e)}`}
                    style={play}
                  />
                  <MapTip label={label}>
                    <path
                      ref={hitRef(e.key)}
                      d={e.d}
                      data-hit="true"
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
