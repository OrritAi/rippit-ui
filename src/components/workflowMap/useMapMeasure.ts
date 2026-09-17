"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { rootOf } from "@/lib/workflowMap/model";
import { CHAIN_RAIL_Y, CROSS_ELBOW_DY, DROP_X, EDGE_MIN_RUN, EDGE_PAD, EDGE_TWEEN_MS, ELBOW_AT, ELBOW_TALL, FAN_AT, FAN_RUN_STEP, CONVERGE_MAX_MS, CONVERGE_STABLE_FRAMES, ROW_PLACEHOLDER_H, SETTLE_MS, UNFOLD_MS } from "@/lib/workflowMap/tokens";
import type { DrawnEdgeKind, EdgePair, MapModel } from "@/lib/workflowMap/types";
import { backPath, columnPath, dropPath, elbowPath, railPath, railY, stubInPath, stubPath, trunkInPath, trunkPath } from "@/lib/workflowMap/edgePaths";

/*
 * useMapMeasure — DOM measurement for the workflow map's edges and camera.
 *
 * Contract
 *  - Attach `scrollRef` to the scroll viewport and `innerRef` to the content
 *    box the SVG overlays (edges are inner-relative, so scrolling is never a
 *    measure trigger). Give every node element `ref={refFor(node.id)}`; give
 *    every root row `ref={rowRefFor(rootId)}`, or `placeholderRefFor(rootId)`
 *    when it renders as a windowed placeholder. Ref callbacks are created
 *    once per id and pruned when the model drops the id, so React never sees
 *    a new ref function and never re-runs mount/unmount for a stable node.
 *  - `edges` is the measured pair list. sx = right+5, tx = left−5, 0.5px
 *    rounding; a line with no anchor meets each card on its rail (`railY`:
 *    CHAIN_RAIL_Y below a card's top, a pill's centre), so a fan leaves from
 *    the rail its branches are centred on and lands on each branch's own.
 *    A 1:1 sequence edge or a small branch (< ELBOW_AT children
 *    and a column ≤ ELBOW_TALL) is a bezier `M sx sy C c1 sy, c2 ty, tx ty`
 *    with handles ≥ EDGE_MIN_RUN; a fan-out or a tall column routes
 *    orthogonally through ONE trunk per parent (key `trunk:<parent>`,
 *    `M sx sy H trunkX … V` out to where the outermost stubs start — a leg
 *    per side, each from the parent, when children sit above and below it —
 *    single stroke weight) plus one stub per child (`M trunkX ty∓r
 *    Q(corner) L tx ty`, turning up or down toward its row, `stub` = the
 *    trunk key), so a child thousands of px away still reads as a connected
 *    branch. A stub ends on the absolute (tx, ty); the trunk starts at the
 *    parent's `M sx sy`; every other path does both. The shapes themselves
 *    are `edgePaths.ts`.
 *    Anchored pairs route by their own rule, carried on the path as
 *    `data-anchor`. A chain link along a row (`"h"`) runs from the source's
 *    right edge + 5 to the target's left edge − 5, both at the TARGET's top +
 *    CHAIN_RAIL_Y: one straight horizontal segment. The target of a chain link
 *    is always a top-aligned step card, while its source can be a pill
 *    starting the row, nudged so its centre — not its top + CHAIN_RAIL_Y —
 *    sits on the rail, so taking the height from the target is what keeps
 *    every chain line straight. A chain link down a column (`"v"`, a connected
 *    workflow's steps stacked under its pill) runs from the source's bottom + 5
 *    to the target's top − 5, both at the TARGET's left + DROP_X: one straight
 *    vertical segment under the pucks, since the layout left-aligns every such
 *    pair. A drop (`"drop"`, a step to a pill hanging below it) runs from the
 *    source's bottom + 5 at DROP_X in from its left edge, straight down to the
 *    target's vertical centre, then right into its left edge − 5. All three
 *    end on an absolute `L tx ty`, like every other path. It only changes when
 *    the geometry signature changes, so committing edges never loops back into
 *    a measure: the SVG layer is absolute + pointer-events:none.
 *  - Triggers: ref mount/unmount, `document.fonts.ready` and window resize,
 *    coalesced through one rAF `schedule()`; `ResizeObserver` on the inner box
 *    and on every root row, plus `contentvisibilityautostatechange` on rows
 *    the browser skipped, which measure **in the frame they fire**
 *    (`measureOnRelayout`) because an observer callback runs after layout and
 *    before paint, so the next frame is already too late. A new `model.pairs`
 *    measures in its own commit (see below), and a settle keeps measuring
 *    until the geometry stops changing (`converge`), because the layout a
 *    commit produces is not final. A new pair
 *    list and every unfold also queue one trailing measure at SETTLE_MS so
 *    the edges land on the settled layout, after the entrance keyframes
 *    (transforms never fire a ResizeObserver). `animateUnfold()` runs the ≤650 ms rAF measure
 *    loop after a toggle / expand all / collapse all and raises `unfolding`
 *    for the same window (put `will-change` on freshly mounted columns
 *    while it is true). Skipped under reduced motion or LITE, where a single
 *    scheduled measure is enough.
 *  - `near` is the set of root row ids within one viewport of the visible
 *    area (IntersectionObserver, rootMargin 100%). Measurement only reads
 *    pairs whose root row is near. When `windowRoots` is on it is also React
 *    state, so far rows can render as `heightOf(id)`-tall placeholders; it
 *    is `null` until the observer has reported once (render everything).
 *  - `boxes` / `rowBoxes` are the measured node and root-row rectangles in
 *    inner coordinates (same pass, same gating) — the minimap draws them.
 *  - Client rects come back in visual pixels and path coordinates live in the
 *    edge layer's user space, so every reading is mapped between the two —
 *    exactly once, in `userSpace()`, and nowhere else. That mapping is taken
 *    from the edge layer's own `getScreenCTM()`, which covers the camera's
 *    CSS `zoom`, the scroll position **and any transform an owner of the
 *    content box puts on it**, so a scaled content box moves the lines with
 *    the cards instead of away from them. `zoom` is still passed (the shell's
 *    rendered value) and is the fallback before the layer is in the DOM.
 *  - A new `model.pairs` is measured **synchronously, before paint, in the
 *    commit that rendered it**, so the cards and the lines between them can
 *    never be drawn from two different layouts in the same frame. A line
 *    whose pair is gone is simply absent from that measurement, so a path
 *    cannot outlive what it joins.
 *  - `onGeometry` registers the writer that puts coordinates into the DOM
 *    (`MapEdges`), and every measurement goes to it before it goes through
 *    `setEdges`. React still owns which path elements exist; it must not also
 *    own when their coordinates arrive, because a measure taken outside a
 *    commit would then wait a render — a frame, and on an estate map a third
 *    of a second.
 *  - Dev self-check: after every settle (and once the edge tween has
 *    finished) the paths in the DOM are re-derived from fresh rects and any
 *    end point more than 1px off its node's right-/left-centre is
 *    console.warn'ed with the node ids. Silent in production.
 *  - `focusNode(id)` centres a node with `scrollTo` + centre-delta math
 *    (never scrollIntoView); smooth unless reduced motion. `revealRow(id)`
 *    jumps a windowed row into the window instantly so keyboard focus can
 *    land on its children next render.
 */

export interface MapEdge {
  key: string;
  from: string;
  to: string;
  depth: number;
  d: string;
  /** The parent fans out to FAN_AT or more children. */
  fan: boolean;
  kind: DrawnEdgeKind;
  /** Elbow child: this path is a stub off the trunk with this key; the
   *  trunk carries the parent → trunk segment and the shared vertical. */
  stub?: string;
  /** Chain link along a row (`"h"`: right edge → left edge on the rail), down
   *  a column (`"v"`: bottom → top at DROP_X), or a drop to a pill below its
   *  step (`"drop"`: bottom at DROP_X → left edge). */
  anchor?: "h" | "v" | "drop";
  /** Fan-in geometry: a `trunkin:` trunk whose LAST point is the target, or a
   *  source stub that starts at its source and ends on that trunk. */
  fanIn?: boolean;
}

export interface MapBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pill: boolean;
}

export interface UseMapMeasureOptions {
  model: Pick<MapModel, "pairs" | "byId" | "roots">;
  /** LITE mode: one measure per commit, no unfold loop. */
  lite: boolean;
  reducedMotion: boolean;
  /** Maintain `near` as state so far root rows can render as placeholders. */
  windowRoots: boolean;
  /** CSS `zoom` currently applied to the inner content (default 1). Used to
   *  map client pixels to the edge layer's user space only when that layer is
   *  not in the DOM yet — `userSpace()` reads the real mapping off the layer
   *  itself, which also covers any transform on the content box. */
  zoom?: number;
}

export type RefCallback = (el: HTMLElement | null) => void;

export interface MapMeasure {
  scrollRef: (el: HTMLDivElement | null) => void;
  innerRef: (el: HTMLDivElement | null) => void;
  /** Stable per-id ref for a node element (pill button / step button). */
  refFor: (id: string) => RefCallback;
  /** Stable per-id ref for a fully rendered root row. */
  rowRefFor: (rootId: string) => RefCallback;
  /** Stable per-id ref for a windowed placeholder row. */
  placeholderRefFor: (rootId: string) => RefCallback;
  edges: MapEdge[];
  /** Measured node rectangles (inner coordinates), for the minimap. */
  boxes: MapBox[];
  /** Measured root-row rectangles (inner coordinates), for the minimap. */
  rowBoxes: MapBox[];
  /** Coalesced measure on the next animation frame. */
  schedule: () => void;
  /**
   * Register the function that writes measured geometry into the DOM (this is
   * `MapEdges`; pass null to unregister).
   *
   * It exists so that geometry is not gated on a React render. A measure can
   * happen outside any commit — the observers below fire on a relayout the
   * browser performed on its own — and on a large map the render that would
   * carry the coordinates is a frame away. One owner still writes `d`; this
   * only lets it be told sooner.
   */
  onGeometry: (fn: ((list: MapEdge[]) => void) | null) => void;
  /** schedule() + one trailing measure at SETTLE_MS (+ the dev self-check). */
  settle: () => void;
  /** The ≤650 ms measure loop; also flips `unfolding` for that window. */
  animateUnfold: () => void;
  unfolding: boolean;
  /** Root rows near the viewport, or null before the first observation. */
  near: ReadonlySet<string> | null;
  /** Last measured height of a root row (for placeholders); 60 before any. */
  heightOf: (rootId: string) => number;
  focusNode: (id: string) => void;
  revealRow: (rootId: string) => void;
  elementOf: (id: string) => HTMLElement | null;
  scrollElement: () => HTMLDivElement | null;
  innerElement: () => HTMLDivElement | null;
}

const r2 = (v: number) => Math.round(v * 2) / 2;

/**
 * Client pixels → the edge layer's own user space.
 *
 * Every coordinate this file produces is written into an SVG path inside the
 * content box, and every coordinate it reads comes from
 * `getBoundingClientRect()`. Getting from one to the other means undoing
 * whatever sits between them — and that is *not* just the camera's CSS
 * `zoom`, which is what this used to assume.
 *
 * It stopped being true the moment the motion layer started scaling the
 * content box for a layer change. A `scale(0.94)` there moves every card by
 * up to 6% while leaving path coordinates alone, so every line on the map
 * comes away from its cards — and it stays that way for as long as the
 * transform does. That is a whole class of bug, not one tween's mistake: any
 * owner of that box, now or later, can put a transform on it for a good
 * reason, and none of them should have to know that the edges are measured
 * against a hard-coded divisor.
 *
 * So the mapping is taken from the edge layer itself. `getScreenCTM()` is
 * the browser's own answer to "where does this user-space point land on the
 * screen", and it accounts for the CSS `zoom`, the scroll position, and any
 * transform on any ancestor, without this file knowing which of them is in
 * play. The `zoom` arithmetic remains as the fallback for the one case it
 * cannot cover — the layer not being in the DOM yet.
 */
function userSpace(inner: HTMLElement, ir: DOMRect, z: number) {
  const layer = inner.querySelector<SVGSVGElement>("svg[data-edge-layer]");
  const m = layer?.getScreenCTM?.();
  if (!m || typeof DOMPoint === "undefined") {
    return (x: number, y: number): [number, number] => [(x - ir.left) / z, (y - ir.top) / z];
  }
  const inv = m.inverse();
  return (x: number, y: number): [number, number] => {
    const p = new DOMPoint(x, y).matrixTransform(inv);
    return [p.x, p.y];
  };
}

export function useMapMeasure({ model, lite, reducedMotion, windowRoots, zoom = 1 }: UseMapMeasureOptions): MapMeasure {
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [boxes, setBoxes] = useState<MapBox[]>([]);
  const [rowBoxes, setRowBoxes] = useState<MapBox[]>([]);
  const [unfolding, setUnfolding] = useState(false);
  const [near, setNear] = useState<ReadonlySet<string> | null>(null);

  const scrollEl = useRef<HTMLDivElement | null>(null);
  const innerEl = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const refFns = useRef(new Map<string, RefCallback>());
  const rows = useRef(new Map<string, HTMLElement>());
  const rowFns = useRef(new Map<string, RefCallback>());
  const placeholderFns = useRef(new Map<string, RefCallback>());
  const rowIds = useRef(new WeakMap<Element, string>());
  const heights = useRef(new Map<string, number>());
  const nearSet = useRef(new Set<string>());
  const nearReady = useRef(false);
  const pairsRef = useRef<EdgePair[]>([]);
  /** MapEdges' own geometry writer — see `onGeometry`. */
  const sink = useRef<((list: MapEdge[]) => void) | null>(null);
  const byIdRef = useRef(model.byId);
  const sigRef = useRef("");
  const boxSigRef = useRef("");
  const raf = useRef(0);
  const loopRaf = useRef(0);
  const unfoldTimer = useRef(0);
  const settleTimer = useRef(0);
  const convergeRaf = useRef(0);
  const io = useRef<IntersectionObserver | null>(null);
  const rowRO = useRef<ResizeObserver | null>(null);
  const innerRO = useRef<ResizeObserver | null>(null);
  const liteRef = useRef(lite);
  const reducedRef = useRef(reducedMotion);
  const windowRef = useRef(windowRoots);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    liteRef.current = lite;
    reducedRef.current = reducedMotion;
  }, [lite, reducedMotion]);
  /* Before paint: the ResizeObserver fires after the zoomed layout commits
     and must already divide by the new zoom. */
  useLayoutEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /* ---------- measure ---------- */

  const measure = useCallback(() => {
    const inner = innerEl.current;
    if (!inner) return;
    const ir = inner.getBoundingClientRect();
    const z = zoomRef.current || 1;
    const pt = userSpace(inner, ir, z);
    const rects = new Map<string, DOMRect>();
    const rectOf = (id: string): DOMRect | null => {
      const cached = rects.get(id);
      if (cached) return cached;
      const el = els.current.get(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      rects.set(id, r);
      return r;
    };
    const gate = nearReady.current ? nearSet.current : null;
    const byId = byIdRef.current;
    const out: MapEdge[] = [];
    const sig: string[] = [];
    /* Pass 1 — end points per pair, grouped by parent. Children per parent
       (pairs are in render order) → each edge's sibling index staggers its
       bezier handle; ≥ FAN_AT marks a fan; ≥ ELBOW_AT or a column taller
       than ELBOW_TALL switches the parent's edges to elbow routing. */
    const total = new Map<string, number>();
    for (const p of pairsRef.current) if (p.kind === "tree" && !p.anchor) total.set(p.from, (total.get(p.from) ?? 0) + 1);
    interface Seg {
      p: EdgePair;
      i: number;
      sx: number;
      sy: number;
      tx: number;
      ty: number;
    }
    const segs: Seg[] = [];
    const groups = new Map<string, { minTy: number; maxTy: number; minTx: number }>();
    const seen = new Map<string, number>();
    for (const p of pairsRef.current) {
      const i = seen.get(p.from) ?? 0;
      seen.set(p.from, i + 1);
      if (gate && !gate.has(rootOf(p.from))) continue;
      const a = rectOf(p.from);
      const b = rectOf(p.to);
      if (!a || !b) continue;
      /* A row skipped by `content-visibility: auto` has no layout yet — its
         rects are empty; drawing to them would fling a path at the origin. */
      if ((a.width === 0 && a.height === 0) || (b.width === 0 && b.height === 0)) continue;
      if (p.anchor === "h" || p.anchor === "v" || p.anchor === "drop") {
        /* Offsets along a card (the rail, the puck column) are in the card's
           own CSS pixels, which is the edge layer's user space: convert the
           card's corner, then add them — never add them to client pixels,
           which the camera's zoom has scaled. */
        const [al, ab] = pt(a.left, a.bottom);
        const [ar] = pt(a.right, a.bottom);
        const [bl, bt] = pt(b.left, b.top);
        const [, bb] = pt(b.left, b.bottom);
        const rail = r2(bt + CHAIN_RAIL_Y);
        const column = r2(bl + DROP_X);
        const d =
          p.anchor === "h"
            ? railPath(r2(ar + EDGE_PAD), r2(bl - EDGE_PAD), rail)
            : p.anchor === "v"
              ? columnPath(column, r2(ab + EDGE_PAD), r2(bt - EDGE_PAD))
              : dropPath(r2(al + DROP_X), r2(ab + EDGE_PAD), r2(bl - EDGE_PAD), r2(bt + (bb - bt) / 2));
        out.push({ key: p.key, from: p.from, to: p.to, depth: p.depth, d, fan: false, kind: p.kind, anchor: p.anchor });
        sig.push(p.key, d, p.anchor);
        continue;
      }
      /* Each end on its card's rail, found in user space: the rail is an
         offset in the card's own CSS pixels, like the anchored ones above. */
      const [ax, atop] = pt(a.right, a.top);
      const [, abottom] = pt(a.right, a.bottom);
      const [bx, btop] = pt(b.left, b.top);
      const [, bbottom] = pt(b.left, b.bottom);
      const sx = r2(ax + EDGE_PAD);
      const sy = r2(railY(!!byId.get(p.from)?.pill, atop, abottom));
      const tx = r2(bx - EDGE_PAD);
      const ty = r2(railY(!!byId.get(p.to)?.pill, btop, bbottom));
      segs.push({ p, i, sx, sy, tx, ty });
      if (p.kind !== "tree") continue;
      const g = groups.get(p.from);
      if (!g) groups.set(p.from, { minTy: ty, maxTy: ty, minTx: tx });
      else {
        g.minTy = Math.min(g.minTy, ty);
        g.maxTy = Math.max(g.maxTy, ty);
        g.minTx = Math.min(g.minTx, tx);
      }
    }
    /* Pass 2 — paths. Elbow parents first get their single trunk; then
       fan-ins (≥ ELBOW_AT join sources left of one target) get theirs. */
    const trunkX = new Map<string, number>();
    const fanIn = new Map<string, { x: number; key: string }>();
    {
      const byTarget = new Map<string, Seg[]>();
      for (const sg of segs) if (sg.p.kind === "join" && sg.tx > sg.sx + EDGE_MIN_RUN) (byTarget.get(sg.p.to) ?? byTarget.set(sg.p.to, []).get(sg.p.to)!).push(sg);
      for (const [to, list] of byTarget) {
        if (list.length < ELBOW_AT) continue;
        /* The trunk sits just left of the target, inside the spacer between
           the callers block and the viewed tree — never through the block's
           own attached pills, which can reach far right of the caller pills. */
        const x = r2(list[0].tx - EDGE_MIN_RUN);
        const key = `trunkin:${to}`;
        const d = trunkInPath(x, Math.min(...list.map((sg) => sg.sy)), Math.max(...list.map((sg) => sg.sy)), list[0].tx, list[0].ty);
        fanIn.set(to, { x, key });
        out.push({ key, from: to, to, depth: list[0].p.depth, d, fan: list.length >= FAN_AT, kind: "trunk", fanIn: true });
        sig.push(key, d);
      }
    }
    for (const [from, g] of groups) {
      const n = total.get(from) ?? 0;
      if (!(n >= ELBOW_AT || g.maxTy - g.minTy > ELBOW_TALL)) continue;
      const first = segs.find((sg) => sg.p.from === from)!;
      const x = r2(first.sx + (g.minTx - first.sx) / 2);
      trunkX.set(from, x);
      const key = `trunk:${from}`;
      const d = trunkPath(first.sx, first.sy, x, g.minTy, g.maxTy, g.minTx);
      out.push({ key, from, to: from, depth: first.p.depth, d, fan: n >= FAN_AT, kind: "trunk" });
      sig.push(key, d);
    }
    for (const { p, i, sx, sy, tx, ty } of segs) {
      let d: string;
      let fan = false;
      if (p.kind !== "tree") {
        /* join / jump: a bezier for a short forward hop, an elbow for a long
           drop, the back-route when the target is left of the source; a
           fan-in source becomes a stub onto the shared fan-in trunk. */
        const fi = p.kind === "join" ? fanIn.get(p.to) : undefined;
        if (fi) {
          d = stubInPath(sx, sy, fi.x, ty);
          out.push({ key: p.key, from: p.from, to: p.to, depth: p.depth, d, fan: false, kind: p.kind, stub: fi.key, fanIn: true });
          sig.push(p.key, d, "si");
          continue;
        }
        if (tx <= sx + EDGE_MIN_RUN) d = backPath(sx, sy, tx, ty);
        else if (Math.abs(ty - sy) > CROSS_ELBOW_DY) d = elbowPath(sx, sy, r2(sx + (tx - sx) / 2), tx, ty);
        else {
          const run = Math.max(EDGE_MIN_RUN, (tx - sx) / 2);
          d = `M ${sx} ${sy} C ${r2(sx + run)} ${sy}, ${r2(tx - run)} ${ty}, ${tx} ${ty}`;
        }
      } else {
        const n = total.get(p.from) ?? 0;
        const tx0 = trunkX.get(p.from);
        if (tx0 !== undefined) {
          d = stubPath(tx0, sy, tx, ty);
          fan = n >= FAN_AT;
          out.push({ key: p.key, from: p.from, to: p.to, depth: p.depth, d, fan, kind: p.kind, stub: `trunk:${p.from}` });
          sig.push(p.key, d, fan ? "f" : "", "s");
          continue;
        }
        const run = Math.max(EDGE_MIN_RUN, (tx - sx) / 2) + i * FAN_RUN_STEP;
        d = `M ${sx} ${sy} C ${r2(sx + run)} ${sy}, ${r2(tx - run)} ${ty}, ${tx} ${ty}`;
        fan = n >= FAN_AT;
      }
      out.push({ key: p.key, from: p.from, to: p.to, depth: p.depth, d, fan, kind: p.kind });
      sig.push(p.key, d, fan ? "f" : "", p.kind);
    }
    const s = sig.join("|");
    if (s !== sigRef.current) {
      sigRef.current = s;
      /*
       * Straight to the DOM first, and only then through React.
       *
       * Publishing geometry as state means the coordinates reach the paths a
       * render later — and a measure does not always happen inside a React
       * commit. A row the browser decides to lay out, a `content-visibility`
       * row it stops skipping, a windowed placeholder giving up its stale
       * height: those relayouts land in the observer callbacks below, after
       * layout and before paint, with no commit to ride. Waiting for a render
       * there means the frame paints with the cards moved and every line still
       * on the old measurement — 603px of it on the 300-caller fixture, where
       * a frame can be a third of a second.
       *
       * So the writer that owns `d` is handed the list directly. `setEdges`
       * still runs, because React owns which path elements exist and must
       * never hold a list older than the DOM; it re-asserts the same numbers a
       * render later, which is a no-op.
       */
      sink.current?.(out);
      setEdges(out);
    }

    /* Minimap geometry: every measured node (near rows only) + every root
       row (placeholders included) — rects already read above are reused. */
    const nb: MapBox[] = [];
    const bs: string[] = [];
    for (const [id, el] of els.current) {
      if (gate && !gate.has(rootOf(id))) continue;
      const r = rectOf(id) ?? el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const [x, y] = pt(r.left, r.top);
      const [x2, y2] = pt(r.right, r.bottom);
      const b: MapBox = {
        id,
        x: r2(x),
        y: r2(y),
        w: r2(x2 - x),
        h: r2(y2 - y),
        pill: !!byId.get(id)?.pill,
      };
      nb.push(b);
      bs.push(id, String(b.x), String(b.y), String(b.w), String(b.h));
    }
    const rb: MapBox[] = [];
    for (const [id, el] of rows.current) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const [x, y] = pt(r.left, r.top);
      const [x2, y2] = pt(r.right, r.bottom);
      const b: MapBox = { id, x: r2(x), y: r2(y), w: r2(x2 - x), h: r2(y2 - y), pill: false };
      rb.push(b);
      bs.push(id, String(b.x), String(b.y), String(b.w), String(b.h));
    }
    const bsig = bs.join("|");
    if (bsig !== boxSigRef.current) {
      boxSigRef.current = bsig;
      setBoxes(nb);
      setRowBoxes(rb);
    }
  }, []);

  const schedule = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      measure();
    });
  }, [measure]);

  /**
   * Measure now, in this commit, and drop any measure already queued for the
   * next frame — it would be re-reading the same layout a frame later.
   *
   * For use from a layout effect, where "now" is after the DOM has been
   * updated and before the browser has painted it. Every React commit that can
   * move a card has to go through here rather than through `schedule()`: a
   * scheduled measure lands a frame after the paint it belongs to, so the
   * reader gets one frame of cards in their new positions with every line
   * still drawn to the old ones.
   */
  const measureNow = useCallback(() => {
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
    measure();
  }, [measure]);

  /**
   * A relayout the browser performed on its own: a row resizing, a row it had
   * been skipping being laid out, a windowed placeholder giving up a stale
   * height.
   *
   * Observer callbacks run after layout and before paint, so the measurement
   * belongs in *this* frame. Going through `schedule()` puts it in the next
   * one, which is a whole painted frame of cards in new positions with the
   * lines still on the old measurement — invisible at 16 ms, and not at all
   * invisible on an estate map where a frame is a third of a second.
   *
   * Skipped while the unfold loop is running, which is already measuring this
   * frame; measuring twice would only cost.
   */
  const measureOnRelayout = useCallback(() => {
    if (loopRaf.current) return;
    measureNow();
  }, [measureNow]);

  /* One trailing measure once entrance keyframes have finished. */
  const checkTimer = useRef(0);
  const selfCheckRef = useRef<(confirm?: boolean) => void>(() => undefined);

  /* Dev only: are the paths in the DOM attached to their nodes? Independent
     of `measure`: fresh rects, the DOM's own `d`. A mismatch is re-checked
     once 600 ms later and only reported if it persists — under LITE the
     browser skips far rows (`content-visibility`) and re-renders them a beat
     after a zoom step, which reads as a stale path for one frame. */
  const selfCheck = useCallback((confirm = true) => {
    const inner = innerEl.current;
    if (!inner) return;
    const ir = inner.getBoundingClientRect();
    const z = zoomRef.current || 1;
    const pt = userSpace(inner, ir, z);
    const gate = nearReady.current ? nearSet.current : null;
    const byId = byIdRef.current;
    let bad = 0;
    for (const p of pairsRef.current) {
      if (gate && !gate.has(rootOf(p.from))) continue;
      const a = els.current.get(p.from);
      const b = els.current.get(p.to);
      const path = inner.querySelector<SVGPathElement>(`path[data-edge="${CSS.escape(p.key)}"]`);
      if (!a || !b || !path) continue;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      if ((ar.width === 0 && ar.height === 0) || (br.width === 0 && br.height === 0)) continue;
      const nums = (path.getAttribute("d") ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      if (nums.length < 4) continue;
      const stub = path.dataset.stub;
      const trunkNums = stub
        ? ((inner.querySelector<SVGPathElement>(`path[data-trunk="${CSS.escape(stub)}"]`)?.getAttribute("d") ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? null)
        : null;
      const fanInStub = !!stub && path.dataset.fanin === "true";
      /* A fan-out stub starts on its trunk (start = the trunk's first M, the
         parent); a fan-in stub ends on its trunk (end = the trunk's last
         point, the target); everything else checks both ends itself. */
      const startNums = stub && !fanInStub && trunkNums ? trunkNums : nums;
      const endNums = fanInStub && trunkNums ? trunkNums : nums;
      let want: number[];
      if (p.anchor === "h") {
        /* The rail is the target's; at the source it must still meet the card,
           so a rail that misses the source's height is held to its edge. */
        const [ax, atop] = pt(ar.right, ar.top);
        const [, abottom] = pt(ar.right, ar.bottom);
        const [bx, by] = pt(br.left, br.top);
        const rail = by + CHAIN_RAIL_Y;
        want = [ax + EDGE_PAD, Math.min(Math.max(rail, atop), abottom), bx - EDGE_PAD, rail];
      } else if (p.anchor === "v") {
        /* The column is the target's; at the source it must still meet the
           card, so a column that misses the source's width is held to its edge. */
        const [aleft, ab] = pt(ar.left, ar.bottom);
        const [aright] = pt(ar.right, ar.bottom);
        const [bx, by] = pt(br.left, br.top);
        const column = bx + DROP_X;
        want = [Math.min(Math.max(column, aleft), aright), ab + EDGE_PAD, column, by - EDGE_PAD];
      } else if (p.anchor === "drop") {
        const [ax, ay] = pt(ar.left, ar.bottom);
        const [bx, by] = pt(br.left, br.top + br.height / 2);
        want = [ax + DROP_X, ay + EDGE_PAD, bx - EDGE_PAD, by];
      } else {
        const [ax, atop] = pt(ar.right, ar.top);
        const [, abottom] = pt(ar.right, ar.bottom);
        const [bx, btop] = pt(br.left, br.top);
        const [, bbottom] = pt(br.left, br.bottom);
        want = [ax + EDGE_PAD, railY(!!byId.get(p.from)?.pill, atop, abottom), bx - EDGE_PAD, railY(!!byId.get(p.to)?.pill, btop, bbottom)];
      }
      const got = [startNums[0], startNums[1], endNums[endNums.length - 2], endNums[endNums.length - 1]];
      const off = Math.max(...want.map((w, i) => Math.abs(w - got[i])));
      /* 1.5px: a fractional zoom snaps boxes to device pixels, which reads as
         up to 1/zoom px in inner space; the geometry script uses the same. */
      if (off > 1.5) {
        bad++;
        if (!confirm) console.warn(`[workflow map] edge ${p.from} → ${p.to} is ${off.toFixed(1)}px off its nodes (zoom ${z})`, { want, got });
      }
    }
    if (bad > 0 && confirm) {
      window.clearTimeout(checkTimer.current);
      checkTimer.current = window.setTimeout(() => selfCheckRef.current(false), 600);
      return;
    }
    if (bad === 0 && pairsRef.current.length > 0) console.debug(`[workflow map] ${pairsRef.current.length} edges attached (zoom ${z})`);
  }, []);
  useEffect(() => {
    selfCheckRef.current = selfCheck;
  }, [selfCheck]);

  /*
   * Follow the layout until it stops moving.
   *
   * The layout a commit produces is not final: a column redistributes its
   * width as content lays out, a row the browser was skipping gets rendered, a
   * windowed placeholder gives up the stale height it was standing at. None of
   * those resize a box an observer is watching, so nothing reports them — and
   * where there is no unfold loop (LITE, reduced motion) the next measurement
   * was SETTLE_MS away, which is 700ms of lines drawn to where cards used to
   * be.
   *
   * Stops on its own the moment two measurements agree, so a layout that was
   * already stable costs one extra measure, and a hard time cap keeps it from
   * ever becoming the per-frame loop those modes exist to avoid. It yields to
   * the unfold loop, which is already measuring every frame.
   */
  const converge = useCallback(() => {
    cancelAnimationFrame(convergeRaf.current);
    const t0 = performance.now();
    let stable = 0;
    const step = () => {
      if (loopRaf.current) {
        convergeRaf.current = 0;
        return;
      }
      const before = sigRef.current;
      measure();
      stable = sigRef.current === before ? stable + 1 : 0;
      const done = stable >= CONVERGE_STABLE_FRAMES || performance.now() - t0 > CONVERGE_MAX_MS;
      convergeRaf.current = done ? 0 : requestAnimationFrame(step);
    };
    convergeRaf.current = requestAnimationFrame(step);
  }, [measure]);

  const settle = useCallback(() => {
    schedule();
    converge();
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = 0;
      measure();
      if (process.env.NODE_ENV !== "production") {
        window.clearTimeout(checkTimer.current);
        checkTimer.current = window.setTimeout(() => selfCheck(true), EDGE_TWEEN_MS + 120);
      }
    }, SETTLE_MS);
  }, [schedule, measure, selfCheck, converge]);

  const animateUnfold = useCallback(() => {
    settle();
    if (reducedRef.current || liteRef.current) return;
    setUnfolding(true);
    window.clearTimeout(unfoldTimer.current);
    unfoldTimer.current = window.setTimeout(() => setUnfolding(false), UNFOLD_MS);
    cancelAnimationFrame(loopRaf.current);
    const t0 = performance.now();
    const loop = () => {
      measure();
      loopRaf.current = performance.now() - t0 < UNFOLD_MS ? requestAnimationFrame(loop) : 0;
    };
    loopRaf.current = requestAnimationFrame(loop);
  }, [measure, settle]);

  /*
   * New pairs (model rebuilt: unfold, filter, load) → measure in the same
   * commit, then follow the entrance / unfold keyframes frame by frame, and
   * settle once they are done.
   *
   * **The measure is synchronous and before paint, and that is the whole
   * point.** A fold is the one action that rewrites the model: it removes
   * cards, moves the ones that stay, and replaces the pairs between them. All
   * of that lands in one React commit. If the edges are rebuilt by the next
   * animation frame instead — which is what `schedule()` does, and what this
   * used to rely on — then the browser paints at least one frame in which the
   * cards are in their new places and every line is still drawn to the old
   * ones. On a 137-card workflow the commit itself is a long task, so that
   * "one frame" is a few hundred milliseconds of lines hanging off nothing,
   * which is the bug a reader actually sees and reports.
   *
   * A layout effect runs after the DOM is updated and before the paint, so
   * `getBoundingClientRect()` here returns the positions the reader is about
   * to see. Measuring from them means the lines and the cards they join
   * change together, in one frame, always — a fold reads as the connection
   * opening into its steps rather than as cards moving and lines catching up.
   *
   * It also removes a class of bug rather than an instance: a line whose pair
   * is gone is simply absent from this measurement, so a path can never
   * outlive what it joins, whatever removed it.
   *
   * The cost is one extra layout pass per model change (not per frame) — the
   * same rects the next frame would have read, read a few milliseconds
   * earlier.
   */
  useLayoutEffect(() => {
    pairsRef.current = model.pairs;
    byIdRef.current = model.byId;
    /* The signature describes a pair list that no longer exists, so the
       measure below must publish whatever it finds. */
    sigRef.current = "";
    /* The cascading render this causes is the point, not an oversight. The
       rule guards against effects that derive state React could have computed
       during render — but this geometry does not exist until the DOM does, and
       the whole defect being fixed is the frame between the tree committing
       and the lines being told about it. Reading the layout here and rendering
       again before paint is the documented way to do that, and it is bounded:
       one extra render per model change, never per frame. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measureNow();
    settle();
    /* Next frame (not synchronously in the effect): raises `unfolding` and
       starts the per-frame loop that follows the keyframes. */
    const r = requestAnimationFrame(() => animateUnfold());
    return () => cancelAnimationFrame(r);
  }, [model.pairs, model.byId, measureNow, settle, animateUnfold]);

  /* Prune refs for ids the model no longer renders. */
  useEffect(() => {
    const byId = model.byId;
    for (const id of [...refFns.current.keys()]) if (!byId.has(id)) refFns.current.delete(id);
    for (const id of [...els.current.keys()]) if (!byId.has(id)) els.current.delete(id);
    const rootIds = new Set(model.roots.map((r) => r.id));
    for (const id of [...rowFns.current.keys()]) if (!rootIds.has(id)) rowFns.current.delete(id);
    for (const id of [...placeholderFns.current.keys()]) if (!rootIds.has(id)) placeholderFns.current.delete(id);
    for (const id of [...heights.current.keys()]) if (!rootIds.has(id)) heights.current.delete(id);
  }, [model.byId, model.roots]);

  /* ---------- refs ---------- */

  const refFor = useCallback(
    (id: string): RefCallback => {
      let fn = refFns.current.get(id);
      if (!fn) {
        fn = (el) => {
          if (el) els.current.set(id, el);
          else els.current.delete(id);
          schedule();
        };
        refFns.current.set(id, fn);
      }
      return fn;
    },
    [schedule]
  );

  const publishNear = useCallback(() => {
    if (windowRef.current) setNear(new Set(nearSet.current));
  }, []);

  const onCvChange = useCallback(() => measureOnRelayout(), [measureOnRelayout]);

  const observeRow = useCallback(
    (id: string, el: HTMLElement, full: boolean) => {
      rowIds.current.set(el, id);
      rows.current.set(id, el);
      io.current?.observe(el);
      if (full) {
        rowRO.current?.observe(el);
        /* A row the browser skipped (`content-visibility: auto`) has no
           geometry until it is rendered again — measure when it is. */
        el.addEventListener("contentvisibilityautostatechange", onCvChange);
      }
    },
    [onCvChange]
  );

  const unobserveRow = useCallback(
    (id: string, el: HTMLElement) => {
      io.current?.unobserve(el);
      rowRO.current?.unobserve(el);
      el.removeEventListener("contentvisibilityautostatechange", onCvChange);
      if (rows.current.get(id) === el) rows.current.delete(id);
      nearSet.current.delete(id);
    },
    [onCvChange]
  );

  const rowRefFor = useCallback(
    (id: string): RefCallback => {
      let fn = rowFns.current.get(id);
      if (!fn) {
        let last: HTMLElement | null = null;
        fn = (el) => {
          if (last && last !== el) unobserveRow(id, last);
          last = el;
          if (el) observeRow(id, el, true);
          schedule();
        };
        rowFns.current.set(id, fn);
      }
      return fn;
    },
    [observeRow, unobserveRow, schedule]
  );

  const placeholderRefFor = useCallback(
    (id: string): RefCallback => {
      let fn = placeholderFns.current.get(id);
      if (!fn) {
        let last: HTMLElement | null = null;
        fn = (el) => {
          if (last && last !== el) unobserveRow(id, last);
          last = el;
          if (el) observeRow(id, el, false);
        };
        placeholderFns.current.set(id, fn);
      }
      return fn;
    },
    [observeRow, unobserveRow]
  );

  const scrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollEl.current = el;
      io.current?.disconnect();
      io.current = null;
      if (!el || typeof IntersectionObserver === "undefined") return;
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const id = rowIds.current.get(e.target);
            if (!id) continue;
            if (e.isIntersecting) nearSet.current.add(id);
            else nearSet.current.delete(id);
          }
          nearReady.current = true;
          publishNear();
          schedule();
        },
        { root: el, rootMargin: "100% 0px" }
      );
      io.current = obs;
      for (const row of rows.current.values()) obs.observe(row);
    },
    [publishNear, schedule]
  );

  const innerRef = useCallback(
    (el: HTMLDivElement | null) => {
      innerEl.current = el;
      innerRO.current?.disconnect();
      innerRO.current = null;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => measureOnRelayout());
      ro.observe(el);
      innerRO.current = ro;
      schedule();
    },
    [measureOnRelayout, schedule]
  );

  /* Row heights (for windowed placeholders) — and any relayout inside a
     row (unfold, zoom, labels hiding) resizes the row, so this is also the
     catch-all measure trigger. One observer for all rows. */
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const id = rowIds.current.get(e.target);
        if (id) heights.current.set(id, Math.round(e.contentRect.height));
      }
      measureOnRelayout();
    });
    rowRO.current = ro;
    for (const [id, el] of rows.current) if (rowFns.current.has(id)) ro.observe(el);
    return () => {
      ro.disconnect();
      rowRO.current = null;
    };
  }, [measureOnRelayout]);

  /* Windowing toggled on: re-observe every row so the observer reports the
     whole near set once (its callback publishes the state). */
  useEffect(() => {
    windowRef.current = windowRoots;
    const obs = io.current;
    if (!windowRoots || !obs) return;
    for (const el of rows.current.values()) {
      obs.unobserve(el);
      obs.observe(el);
    }
  }, [windowRoots]);

  /* Fonts + resize. */
  useEffect(() => {
    const onResize = () => schedule();
    window.addEventListener("resize", onResize);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => schedule()).catch(() => undefined);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf.current);
      cancelAnimationFrame(loopRaf.current);
      window.clearTimeout(unfoldTimer.current);
      window.clearTimeout(settleTimer.current);
      cancelAnimationFrame(convergeRaf.current);
      window.clearTimeout(checkTimer.current);
      io.current?.disconnect();
      innerRO.current?.disconnect();
    };
  }, [schedule]);

  /* ---------- camera ---------- */

  const scrollToCentre = useCallback((el: HTMLElement, behavior: ScrollBehavior) => {
    const sb = scrollEl.current;
    if (!sb) return;
    const er = el.getBoundingClientRect();
    const sr = sb.getBoundingClientRect();
    sb.scrollTo({
      left: sb.scrollLeft + (er.left + er.width / 2) - (sr.left + sr.width / 2),
      top: sb.scrollTop + (er.top + er.height / 2) - (sr.top + sr.height / 2),
      behavior,
    });
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      const el = els.current.get(id) ?? rows.current.get(id);
      if (!el) return;
      scrollToCentre(el, reducedRef.current ? "instant" : "smooth");
    },
    [scrollToCentre]
  );

  const revealRow = useCallback(
    (rootId: string) => {
      const el = rows.current.get(rootId);
      if (el) scrollToCentre(el, "instant");
    },
    [scrollToCentre]
  );

  const onGeometry = useCallback((fn: ((list: MapEdge[]) => void) | null) => {
    sink.current = fn;
  }, []);

  const heightOf = useCallback((rootId: string) => heights.current.get(rootId) ?? ROW_PLACEHOLDER_H, []);
  const elementOf = useCallback((id: string) => els.current.get(id) ?? null, []);
  const scrollElement = useCallback(() => scrollEl.current, []);
  const innerElement = useCallback(() => innerEl.current, []);

  return {
    scrollRef,
    innerRef,
    onGeometry,
    refFor,
    rowRefFor,
    placeholderRefFor,
    edges,
    boxes,
    rowBoxes,
    schedule,
    settle,
    animateUnfold,
    unfolding,
    near: windowRoots ? near : null,
    heightOf,
    focusNode,
    revealRow,
    elementOf,
    scrollElement,
    innerElement,
  };
}
