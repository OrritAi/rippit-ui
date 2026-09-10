"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { rootOf } from "@/lib/workflowMap/model";
import { CROSS_ELBOW_DY, EDGE_MIN_RUN, EDGE_PAD, EDGE_TWEEN_MS, ELBOW_AT, ELBOW_R, ELBOW_TALL, FAN_AT, FAN_RUN_STEP, ROW_PLACEHOLDER_H, SETTLE_MS, UNFOLD_MS } from "@/lib/workflowMap/tokens";
import type { DrawnEdgeKind, EdgePair, MapModel } from "@/lib/workflowMap/types";

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
 *    rounding. A 1:1 sequence edge or a small branch (< ELBOW_AT children
 *    and a column ≤ ELBOW_TALL) is a bezier `M sx sy C c1 sy, c2 ty, tx ty`
 *    with handles ≥ EDGE_MIN_RUN; a fan-out or a tall column routes
 *    orthogonally through ONE trunk per parent (key `trunk:<parent>`,
 *    `M sx sy H trunkX … V` from the first to the last child's row, single
 *    stroke weight) plus one stub per child (`M trunkX ty∓r Q(corner) L tx
 *    ty`, `stub` = the trunk key), so a child thousands of px below still
 *    reads as a connected branch. A stub ends on the absolute (tx, ty); the
 *    trunk starts at the parent's `M sx sy`; every other path does both.
 *    A chain pair (`anchor: "v"`, `data-anchor="v"`) is a straight line from
 *    the source's bottom-centre + 5 to the target's top-centre − 5.
 *    It only changes when the
 *    geometry signature changes, so committing edges never loops back into a
 *    measure: the SVG layer is absolute + pointer-events:none.
 *  - Triggers: ref mount/unmount, `ResizeObserver` on the inner box and on
 *    every root row (any relayout inside a row — unfold, zoom, labels hiding
 *    — resizes its row), `contentvisibilityautostatechange` on rows the
 *    browser skipped, `document.fonts.ready`, window resize, and a new
 *    `model.pairs` — all coalesced through one rAF `schedule()`. A new pair
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
 *  - `zoom` is the CSS `zoom` applied to the inner content. Client rects
 *    come back in visual pixels; the SVG lives inside the zoomed inner, so
 *    every coordinate is divided by it — exactly once, here, and nowhere
 *    else. Pass the value the shell renders.
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
  /** Chain edge (bottom-centre → top-centre, straight). */
  anchor?: "v";
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
  /** CSS `zoom` currently applied to the inner content (default 1). */
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
 * Orthogonal route with rounded corners: right from the parent to the trunk,
 * along the trunk to the child's row, right to the child. Ends on an
 * absolute `L tx ty` so the last point is always the child's left-centre.
 * Rows within one corner radius of each other get a straight line.
 */
/**
 * Back-edge (target left of, or level with, the source): out to the right
 * of the source, down/up to the gap between the rows, left past the target,
 * then into its left-centre — never across a card. Ends on `L tx ty`.
 */
function backPath(sx: number, sy: number, tx: number, ty: number): string {
  const r = ELBOW_R;
  const run = EDGE_MIN_RUN;
  const x1 = sx + run; // right of the source
  const x2 = tx - run; // left of the target
  const midY = Math.round(((sy + ty) / 2) * 2) / 2;
  if (Math.abs(ty - sy) <= 2 * r) return `M ${sx} ${sy} L ${tx} ${ty}`;
  const s = ty > sy ? 1 : -1;
  return [
    `M ${sx} ${sy}`,
    `H ${x1 - r}`,
    `Q ${x1} ${sy} ${x1} ${sy + s * r}`,
    `V ${midY - s * r}`,
    `Q ${x1} ${midY} ${x1 - r} ${midY}`,
    `H ${x2 + r}`,
    `Q ${x2} ${midY} ${x2} ${midY + s * r}`,
    `V ${ty - s * r}`,
    `Q ${x2} ${ty} ${x2 + r} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(" ");
}

/** One trunk per elbow parent: parent → trunkX, then the vertical from the
 *  first to the last child's row (through the parent's row when children
 *  sit on both sides). Starts on `M sx sy`. */
function trunkPath(sx: number, sy: number, trunkX: number, minTy: number, maxTy: number): string {
  const r = ELBOW_R;
  const top = Math.min(minTy, sy);
  const bottom = Math.max(maxTy, sy);
  if (trunkX - sx < r) return `M ${sx} ${sy} L ${trunkX} ${sy} M ${trunkX} ${top} V ${bottom}`;
  if (minTy < sy - r && maxTy > sy + r) return `M ${sx} ${sy} H ${trunkX} M ${trunkX} ${top} V ${bottom}`;
  if (maxTy > sy + r) return `M ${sx} ${sy} H ${trunkX - r} Q ${trunkX} ${sy} ${trunkX} ${sy + r} V ${bottom}`;
  if (minTy < sy - r) return `M ${sx} ${sy} H ${trunkX - r} Q ${trunkX} ${sy} ${trunkX} ${sy - r} V ${top}`;
  return `M ${sx} ${sy} H ${trunkX}`;
}

/** Fan-in (several callers into the viewed pill): one trunk left of the
 *  target spanning every source's row, ending with the single stub into the
 *  target — its LAST point is the target's left-centre. */
function trunkInPath(trunkX: number, minSy: number, maxSy: number, tx: number, ty: number): string {
  const top = Math.min(minSy, ty);
  const bottom = Math.max(maxSy, ty);
  return `M ${trunkX} ${top} V ${bottom} M ${trunkX} ${ty} L ${tx} ${ty}`;
}

/** Fan-in source stub: from the source's right-centre onto the trunk, with
 *  the rounded corner turning toward the target's row. Starts on `M sx sy`. */
function stubInPath(sx: number, sy: number, trunkX: number, ty: number): string {
  const r = ELBOW_R;
  const dy = ty - sy;
  if (Math.abs(dy) <= 2 * r || trunkX - sx < r) return `M ${sx} ${sy} L ${trunkX} ${sy}`;
  const s = dy > 0 ? 1 : -1;
  return `M ${sx} ${sy} H ${trunkX - r} Q ${trunkX} ${sy} ${trunkX} ${sy + s * r}`;
}

/** One stub per elbow child: off the trunk at the child's row (rounded
 *  corner on the side the trunk arrives from) into the child's left-centre. */
function stubPath(trunkX: number, sy: number, tx: number, ty: number): string {
  const r = ELBOW_R;
  const dy = ty - sy;
  if (Math.abs(dy) <= 2 * r || tx - trunkX < r) return `M ${trunkX} ${ty} L ${tx} ${ty}`;
  const s = dy > 0 ? 1 : -1;
  return `M ${trunkX} ${ty - s * r} Q ${trunkX} ${ty} ${trunkX + r} ${ty} L ${tx} ${ty}`;
}

function elbowPath(sx: number, sy: number, trunkX: number, tx: number, ty: number): string {
  const r = ELBOW_R;
  const dy = ty - sy;
  if (Math.abs(dy) <= 2 * r || trunkX - sx < r || tx - trunkX < r) return `M ${sx} ${sy} L ${tx} ${ty}`;
  const s = dy > 0 ? 1 : -1;
  return [
    `M ${sx} ${sy}`,
    `H ${trunkX - r}`,
    `Q ${trunkX} ${sy} ${trunkX} ${sy + s * r}`,
    `V ${ty - s * r}`,
    `Q ${trunkX} ${ty} ${trunkX + r} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(" ");
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
  const byIdRef = useRef(model.byId);
  const sigRef = useRef("");
  const boxSigRef = useRef("");
  const raf = useRef(0);
  const loopRaf = useRef(0);
  const unfoldTimer = useRef(0);
  const settleTimer = useRef(0);
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
      if (p.anchor === "v") {
        /* Chain edge: bottom-centre + 5 → top-centre − 5, straight. */
        const sx = r2((a.left - ir.left + a.width / 2) / z);
        const sy = r2((a.bottom - ir.top) / z + EDGE_PAD);
        const tx = r2((b.left - ir.left + b.width / 2) / z);
        const ty = r2((b.top - ir.top) / z - EDGE_PAD);
        const d = `M ${sx} ${sy} L ${tx} ${ty}`;
        out.push({ key: p.key, from: p.from, to: p.to, depth: p.depth, d, fan: false, kind: "tree", anchor: "v" });
        sig.push(p.key, d, "v");
        continue;
      }
      const sx = r2((a.right - ir.left) / z + EDGE_PAD);
      const sy = r2((a.top - ir.top + a.height / 2) / z);
      const tx = r2((b.left - ir.left) / z - EDGE_PAD);
      const ty = r2((b.top - ir.top + b.height / 2) / z);
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
      const d = trunkPath(first.sx, first.sy, x, g.minTy, g.maxTy);
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
      setEdges(out);
    }

    /* Minimap geometry: every measured node (near rows only) + every root
       row (placeholders included) — rects already read above are reused. */
    const byId = byIdRef.current;
    const nb: MapBox[] = [];
    const bs: string[] = [];
    for (const [id, el] of els.current) {
      if (gate && !gate.has(rootOf(id))) continue;
      const r = rectOf(id) ?? el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const b: MapBox = {
        id,
        x: r2((r.left - ir.left) / z),
        y: r2((r.top - ir.top) / z),
        w: r2(r.width / z),
        h: r2(r.height / z),
        pill: !!byId.get(id)?.pill,
      };
      nb.push(b);
      bs.push(id, String(b.x), String(b.y), String(b.w), String(b.h));
    }
    const rb: MapBox[] = [];
    for (const [id, el] of rows.current) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const b: MapBox = { id, x: r2((r.left - ir.left) / z), y: r2((r.top - ir.top) / z), w: r2(r.width / z), h: r2(r.height / z), pill: false };
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
    const gate = nearReady.current ? nearSet.current : null;
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
      const want =
        p.anchor === "v"
          ? [(ar.left - ir.left + ar.width / 2) / z, (ar.bottom - ir.top) / z + EDGE_PAD, (br.left - ir.left + br.width / 2) / z, (br.top - ir.top) / z - EDGE_PAD]
          : [
              (ar.right - ir.left) / z + EDGE_PAD,
              (ar.top - ir.top + ar.height / 2) / z,
              (br.left - ir.left) / z - EDGE_PAD,
              (br.top - ir.top + br.height / 2) / z,
            ];
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

  const settle = useCallback(() => {
    schedule();
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = 0;
      measure();
      if (process.env.NODE_ENV !== "production") {
        window.clearTimeout(checkTimer.current);
        checkTimer.current = window.setTimeout(() => selfCheck(true), EDGE_TWEEN_MS + 120);
      }
    }, SETTLE_MS);
  }, [schedule, measure, selfCheck]);

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

  /* New pairs (model rebuilt: unfold, filter, load) → follow the entrance /
     unfold keyframes frame by frame, then settle once they are done. */
  useEffect(() => {
    pairsRef.current = model.pairs;
    byIdRef.current = model.byId;
    settle();
    /* Next frame (not synchronously in the effect): raises `unfolding` and
       starts the per-frame loop that follows the keyframes. */
    const r = requestAnimationFrame(() => animateUnfold());
    return () => cancelAnimationFrame(r);
  }, [model.pairs, model.byId, settle, animateUnfold]);

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

  const onCvChange = useCallback(() => schedule(), [schedule]);

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
      const ro = new ResizeObserver(() => schedule());
      ro.observe(el);
      innerRO.current = ro;
      schedule();
    },
    [schedule]
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
      schedule();
    });
    rowRO.current = ro;
    for (const [id, el] of rows.current) if (rowFns.current.has(id)) ro.observe(el);
    return () => {
      ro.disconnect();
      rowRO.current = null;
    };
  }, [schedule]);

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

  const heightOf = useCallback((rootId: string) => heights.current.get(rootId) ?? ROW_PLACEHOLDER_H, []);
  const elementOf = useCallback((id: string) => els.current.get(id) ?? null, []);
  const scrollElement = useCallback(() => scrollEl.current, []);
  const innerElement = useCallback(() => innerEl.current, []);

  return {
    scrollRef,
    innerRef,
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
