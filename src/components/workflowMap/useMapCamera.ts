"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { CHAIN_GAP, FAR_AT, FAR_HYSTERESIS, STEP_COL_W, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, ZOOM_TWEEN_MS } from "@/lib/workflowMap/tokens";

/*
 * useMapCamera — map-style navigation on top of the native scroll viewport.
 *
 *  - Drag to pan: a mouse/pen drag anywhere on the canvas — cards included —
 *    moves scrollLeft/Top once it travels DRAG_PX. Below that it is a click
 *    (the node's own handler runs untouched); above it, pointer capture
 *    starts and the click that ends the drag is swallowed. Buttons, links
 *    and inputs are exempt. Touch keeps native scrolling.
 *  - Zoom: the inner content gets CSS `zoom`, so layout, scroll extents and
 *    measured rects all scale together (the measure hook divides by it).
 *    Mouse wheel and pinch (ctrl/cmd + wheel) zoom around the cursor;
 *    plain wheel / trackpad scrolling always pans natively and keeps
 *    panning natively. Wheel events are coalesced per frame so a pinch
 *    never renders more than 60×/s.
 *  - Keys on the canvas or a tree item: + / = in, − out, 0 reset, F fit.
 *
 * Slack: the zoomed inner sits in a pad element whose padding is one
 * viewport on every side (measured, not percentage, so zoom never scales
 * it). The scroll surface is therefore always at least one viewport larger
 * than the viewport in both axes — a map that fits on screen still pans in
 * all four directions. Scroll coordinates are offset by the pad: the
 * content origin sits at scroll (pad.x, pad.y), which is where the view
 * starts, so the content still opens at the design's 40/84 px offset.
 * On viewport resize the pad is re-measured and the scroll position shifts
 * by the same delta, so nothing on screen moves.
 *
 * Zoom anchoring: content point p = (scroll + cursor − pad) / zoom stays
 * under the cursor, applied in a layout effect right after the zoomed
 * render commits.
 *
 * First load frames the map once, as soon as its layout has settled, unless
 * something has already moved the camera (a deep link, a replayed run, the
 * reader). If every card fits at READABLE_ZOOM or closer, the whole map is
 * centred with even margins, never above 100 %. Otherwise the start of the
 * flow — the viewed pill, `aria-current` — is placed at the top-left of the
 * usable area at the closest zoom that still shows it and START_STEPS chain
 * steps, never below READABLE_ZOOM, and the reader pans right along the flow.
 * A rung change never reframes: layer and zoom stay independent. `fit` (F) is
 * still the full fit. The content box gets `data-wm-framed` once this has
 * run or been skipped, so a script driving the map can wait for it.
 * Zoom glides to its target over ZOOM_TWEEN_MS (ease-out, one rAF loop,
 * retargetable mid-flight) unless `instant` (LITE or reduced motion).
 */

export interface MapCamera {
  zoom: number;
  /** Semantic far mode: below FAR_AT (with hysteresis) cards become tiles. */
  far: boolean;
  scrollElement: () => HTMLDivElement | null;
  innerElement: () => HTMLDivElement | null;
  /** Ref for the slack pad that wraps the zoomed inner. */
  padRef: (el: HTMLDivElement | null) => void;
  dragging: boolean;
  zoomTo: (next: number, anchor?: { cx: number; cy: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** Fit the whole content in the viewport (never above 100 %). */
  fit: () => void;
  /** Frame a content-space rect: zoom to fit it (clamped) and centre on it. */
  fitRect: (rect: { x: number; y: number; w: number; h: number }, opts?: { padding?: number; minZoom?: number; maxZoom?: number }) => void;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  /** pointercancel / lostpointercapture: the drag is over, whatever happened. */
  onPointerAbort: (e: PointerEvent<HTMLDivElement>) => void;
  /** Capture-phase click handler that swallows the click ending a drag. */
  onClickCapture: (e: MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/* First-load framing. Viewport pixels unless noted. */
/** Even margin around a whole-map fit, and left of the start card. */
const FRAME_MARGIN = 48;
/** The band kept clear of cards at the top: the toolbar sits 12px from the
 *  top and is 34px tall, and cards start 18px below it. */
const FRAME_TOP = 12 + 34 + 18;
/** A step name is 12.5px and falls below the readability floor at 0.76, so
 *  framing never zooms out past this — well clear of far mode at FAR_AT. */
const READABLE_ZOOM = 0.8;
/** The start framing aims to show the viewed pill and this many chain steps. */
const START_STEPS = 4;
/** Layout unchanged this long counts as settled. */
const FRAME_QUIET_MS = 300;
/** Frame anyway once cards have been on the page this long. */
const FRAME_WAIT_MS = 2500;
/** A framing zoom this close to 100 % is 100 %: text renders crisp there. */
const FRAME_SNAP = 0.97;
/** Controls a drag must never start on. Tree items are fine — a click on
 *  them stays a click below DRAG_PX. */
const NO_DRAG = 'button, a, input, textarea, select, [role="dialog"], [role="img"]';
const DRAG_PX = 4;

export function useMapCamera({
  scrollElement,
  innerElement,
  instant = false,
}: {
  scrollElement: () => HTMLDivElement | null;
  innerElement: () => HTMLDivElement | null;
  /** Jump instead of gliding (LITE maps, reduced motion). */
  instant?: boolean;
}): MapCamera {
  const [view, setView] = useState({ zoom: 1, far: false });
  const zoom = view.zoom;
  const farRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const zoomRef = useRef(1);
  const anchorRef = useRef<{ cx: number; cy: number; prev: number; sl: number; st: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; sl: number; st: number; active: boolean } | null>(null);
  const swallowClick = useRef(false);
  const padEl = useRef<HTMLDivElement | null>(null);
  const pad = useRef({ x: 0, y: 0 });
  const padRef = useCallback((el: HTMLDivElement | null) => {
    padEl.current = el;
  }, []);

  /* Size the pad to the viewport and keep the content where it is. */
  const applyPad = useCallback(() => {
    const sb = scrollElement();
    const el = padEl.current;
    if (!sb || !el) return;
    const x = sb.clientWidth;
    const y = sb.clientHeight;
    const prev = pad.current;
    if (x === prev.x && y === prev.y) return;
    el.style.padding = `${y}px ${x}px`;
    pad.current = { x, y };
    const first = prev.x === 0 && prev.y === 0;
    sb.scrollTo({
      left: first ? x : sb.scrollLeft + (x - prev.x),
      top: first ? y : sb.scrollTop + (y - prev.y),
      behavior: "instant",
    });
  }, [scrollElement]);

  /* Before first paint, then on every viewport resize. */
  useLayoutEffect(() => {
    applyPad();
  }, [applyPad]);
  useEffect(() => {
    const sb = scrollElement();
    if (!sb || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => applyPad());
    ro.observe(sb);
    return () => ro.disconnect();
  }, [scrollElement, applyPad]);
  const wheelAcc = useRef<{ factor: number; cx: number; cy: number } | null>(null);
  const wheelRaf = useRef(0);
  const instantRef = useRef(instant);
  useEffect(() => {
    instantRef.current = instant;
  }, [instant]);
  const glide = useRef<{ from: number; to: number; t0: number; cx: number; cy: number } | null>(null);
  const glideRaf = useRef(0);

  /* One zoom step: commit `z` and remember the anchor so the layout effect
     below keeps the content point under the cursor. */
  const commit = useCallback(
    (z: number, cx: number, cy: number) => {
      const sb = scrollElement();
      if (sb) anchorRef.current = { cx, cy, prev: zoomRef.current, sl: sb.scrollLeft, st: sb.scrollTop };
      zoomRef.current = z;
      /* One flip per crossing: leave far only above FAR_AT + h, enter only
         below FAR_AT − h. */
      farRef.current = farRef.current ? z <= FAR_AT + FAR_HYSTERESIS : z < FAR_AT - FAR_HYSTERESIS;
      setView({ zoom: z, far: farRef.current });
    },
    [scrollElement]
  );

  const zoomTo = useCallback(
    (next: number, anchor?: { cx: number; cy: number }) => {
      const z = Math.round(clamp(next) * 1000) / 1000;
      const sb = scrollElement();
      const cx = anchor?.cx ?? (sb ? sb.clientWidth / 2 : 0);
      const cy = anchor?.cy ?? (sb ? sb.clientHeight / 2 : 0);
      if (instantRef.current) {
        glide.current = null;
        if (z !== zoomRef.current) commit(z, cx, cy);
        return;
      }
      if (z === (glide.current?.to ?? zoomRef.current)) return;
      /* Retarget from wherever the glide is now; the anchor follows the cursor. */
      glide.current = { from: zoomRef.current, to: z, t0: performance.now(), cx, cy };
      if (glideRaf.current) return;
      const tick = () => {
        const g = glide.current;
        if (!g) {
          glideRaf.current = 0;
          return;
        }
        const t = Math.min(1, (performance.now() - g.t0) / ZOOM_TWEEN_MS);
        const e = 1 - (1 - t) ** 3;
        const z1 = Math.round((g.from + (g.to - g.from) * e) * 1000) / 1000;
        if (z1 !== zoomRef.current) commit(z1, g.cx, g.cy);
        if (t >= 1) {
          glide.current = null;
          glideRaf.current = 0;
        } else glideRaf.current = requestAnimationFrame(tick);
      };
      glideRaf.current = requestAnimationFrame(tick);
    },
    [scrollElement, commit]
  );
  useEffect(() => () => cancelAnimationFrame(glideRaf.current), []);

  /* Keep the anchored content point under the cursor once the zoomed
     layout has committed (before paint). */
  useLayoutEffect(() => {
    const a = anchorRef.current;
    const sb = scrollElement();
    if (!a || !sb) return;
    anchorRef.current = null;
    const px = (a.sl + a.cx - pad.current.x) / a.prev;
    const py = (a.st + a.cy - pad.current.y) / a.prev;
    sb.scrollLeft = pad.current.x + px * zoom - a.cx;
    sb.scrollTop = pad.current.y + py * zoom - a.cy;
  }, [zoom, scrollElement]);

  const target = () => glide.current?.to ?? zoomRef.current;
  const zoomIn = useCallback(() => zoomTo(target() * ZOOM_STEP), [zoomTo]);
  const zoomOut = useCallback(() => zoomTo(target() / ZOOM_STEP), [zoomTo]);
  const resetZoom = useCallback(() => zoomTo(1), [zoomTo]);

  const fit = useCallback(() => {
    const sb = scrollElement();
    const inner = innerElement();
    if (!sb || !inner) return;
    const r = inner.getBoundingClientRect();
    const w = r.width / zoomRef.current;
    const h = r.height / zoomRef.current;
    if (w <= 0 || h <= 0) return;
    const z = clamp(Math.min(sb.clientWidth / w, sb.clientHeight / h, 1));
    /* Content origin to the viewport's top-left (the pad edge), then zoom
       anchored there so it stays put while the glide runs. */
    sb.scrollTo({ left: pad.current.x, top: pad.current.y, behavior: "instant" });
    zoomTo(z, { cx: 0, cy: 0 });
  }, [scrollElement, innerElement, zoomTo]);

  /* Frame a rect (inner coordinates): jump so its centre sits under the
     viewport centre at the current zoom, then glide the zoom anchored at
     that centre, which keeps it there. */
  const fitRect = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, opts?: { padding?: number; minZoom?: number; maxZoom?: number }) => {
      const sb = scrollElement();
      if (!sb) return;
      const padding = opts?.padding ?? 60;
      const minZ = opts?.minZoom ?? ZOOM_MIN;
      const maxZ = opts?.maxZoom ?? ZOOM_MAX;
      const vw = sb.clientWidth;
      const vh = sb.clientHeight;
      const z = Math.min(maxZ, Math.max(minZ, Math.min(vw / (rect.w + 2 * padding), vh / (rect.h + 2 * padding))));
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const z0 = zoomRef.current;
      glide.current = null;
      sb.scrollTo({ left: pad.current.x + cx * z0 - vw / 2, top: pad.current.y + cy * z0 - vh / 2, behavior: "instant" });
      zoomTo(z, { cx: vw / 2, cy: vh / 2 });
    },
    [scrollElement, zoomTo]
  );

  /* ---- first-load framing ---- */

  const framed = useRef(false);
  useEffect(() => {
    const sb = scrollElement();
    const inner = innerElement();
    if (!sb || !inner || typeof ResizeObserver === "undefined") return;
    let timer = 0;
    let firstSeen = 0;
    const done = () => {
      framed.current = true;
      inner.dataset.wmFramed = "";
    };
    const frame = () => {
      if (framed.current) return;
      done();
      /* Once the camera is someone else's — a deep link, a replayed run, the
         reader's own drag or zoom — first-load framing has nothing to add. */
      const z0 = zoomRef.current;
      if (z0 !== 1 || glide.current || Math.abs(sb.scrollLeft - pad.current.x) > 1 || Math.abs(sb.scrollTop - pad.current.y) > 1) return;
      const ir = inner.getBoundingClientRect();
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const el of inner.querySelectorAll<HTMLElement>("[data-node-id]")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      }
      if (!(right > left && bottom > top)) return;
      const vw = sb.clientWidth;
      const vh = sb.clientHeight;
      const usableW = vw - 2 * FRAME_MARGIN;
      const usableH = vh - FRAME_TOP - FRAME_MARGIN;
      if (usableW <= 0 || usableH <= 0) return;
      /* Content coordinates: the inner box's own, unscaled. */
      const box = { x: (left - ir.left) / z0, y: (top - ir.top) / z0, w: (right - left) / z0, h: (bottom - top) / z0 };
      const whole = Math.min(usableW / box.w, usableH / box.h, 1);
      let z: number;
      let point: { x: number; y: number };
      let at: { x: number; y: number };
      if (whole >= READABLE_ZOOM) {
        z = whole;
        point = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
        at = { x: vw / 2, y: FRAME_TOP + usableH / 2 };
      } else {
        const start = inner.querySelector<HTMLElement>('[aria-current="true"]')?.closest<HTMLElement>("[data-node-id]") ?? null;
        const s = start?.getBoundingClientRect();
        const sx = s ? (s.left - ir.left) / z0 : box.x;
        const sy = s ? (s.top - ir.top) / z0 : box.y;
        const sw = s ? s.width / z0 : 0;
        z = Math.max(READABLE_ZOOM, Math.min(1, usableW / (sw + START_STEPS * (STEP_COL_W + CHAIN_GAP))));
        point = { x: sx, y: sy };
        at = { x: FRAME_MARGIN, y: FRAME_TOP };
      }
      z = z >= FRAME_SNAP ? 1 : Math.round(clamp(z) * 1000) / 1000;
      /* Put the content point under its viewport anchor at the current zoom,
         then commit the zoom anchored there, which keeps it there. */
      sb.scrollTo({ left: pad.current.x + point.x * z0 - at.x, top: pad.current.y + point.y * z0 - at.y, behavior: "instant" });
      if (z !== z0) commit(z, at.x, at.y);
    };
    const settleThenFrame = () => {
      if (framed.current || !inner.querySelector("[data-node-id]")) return;
      const now = performance.now();
      if (!firstSeen) firstSeen = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(frame, Math.max(0, Math.min(FRAME_QUIET_MS, firstSeen + FRAME_WAIT_MS - now)));
    };
    const ro = new ResizeObserver(settleThenFrame);
    ro.observe(inner);
    settleThenFrame();
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, [scrollElement, innerElement, commit]);

  /* ---- wheel (non-passive, so zoom can cancel the native scroll) ---- */

  useEffect(() => {
    const sb = scrollElement();
    if (!sb) return;
    const flush = () => {
      wheelRaf.current = 0;
      const acc = wheelAcc.current;
      wheelAcc.current = null;
      if (acc) zoomTo((glide.current?.to ?? zoomRef.current) * acc.factor, { cx: acc.cx, cy: acc.cy });
    };
    const onWheel = (e: globalThis.WheelEvent) => {
      /* Scrolling pans, always — the browser's own scroll, untouched, so a
         trackpad flick can never be mistaken for a zoom. Only a pinch (which
         arrives as ctrl+wheel) or an explicit ctrl/cmd + wheel zooms. */
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch) return;
      e.preventDefault();
      const r = sb.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 0 ? 0.01 : 0.2));
      const acc = wheelAcc.current;
      wheelAcc.current = { factor: (acc?.factor ?? 1) * factor, cx: e.clientX - r.left, cy: e.clientY - r.top };
      if (!wheelRaf.current) wheelRaf.current = requestAnimationFrame(flush);
    };
    sb.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      sb.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(wheelRaf.current);
      wheelRaf.current = 0;
    };
  }, [scrollElement, zoomTo]);

  /* ---- drag to pan ---- */

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    swallowClick.current = false;
    if (e.button !== 0 || e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest(NO_DRAG)) return;
    const sb = e.currentTarget;
    /* Arm only — no capture, no state: a plain click must reach the node. */
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: sb.scrollLeft, st: sb.scrollTop, active: false };
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const sb = e.currentTarget;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dx) < DRAG_PX && Math.abs(dy) < DRAG_PX) return;
      d.active = true;
      swallowClick.current = true;
      /* A smooth scrollTo (centre-on-select) may be in flight: freeze it
         where it is and rebase the drag there so the two never fight. */
      sb.scrollTo({ left: sb.scrollLeft, top: sb.scrollTop, behavior: "instant" });
      d.sl = sb.scrollLeft;
      d.st = sb.scrollTop;
      d.x = e.clientX;
      d.y = e.clientY;
      sb.setPointerCapture(e.pointerId);
      setDragging(true);
      return;
    }
    e.preventDefault();
    sb.scrollLeft = d.sl - dx;
    sb.scrollTop = d.st - dy;
  }, []);

  const endDrag = useCallback((el: HTMLDivElement | null, pointerId: number | null) => {
    const d = drag.current;
    if (!d) return;
    if (pointerId != null && d.id !== pointerId) return;
    drag.current = null;
    if (!d.active) return;
    if (el && pointerId != null && el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    setDragging(false);
  }, []);

  const onPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => endDrag(e.currentTarget, e.pointerId), [endDrag]);
  const onPointerAbort = useCallback((e: PointerEvent<HTMLDivElement>) => endDrag(e.currentTarget, e.pointerId), [endDrag]);

  /* Fallback: a pointerup the viewport never saw (re-render mid-drag, the
     pointer released over another window) must still disarm the drag. */
  useEffect(() => {
    const up = () => endDrag(null, null);
    window.addEventListener("pointerup", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", up);
    };
  }, [endDrag]);

  /* The click that ends a pan must not select the node under the pointer. */
  const onClickCapture = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  }, []);

  /* ---- keys ---- */

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "+":
        case "=":
          e.preventDefault();
          zoomIn();
          break;
        case "-":
        case "_":
          e.preventDefault();
          zoomOut();
          break;
        case "0":
          e.preventDefault();
          resetZoom();
          break;
        case "f":
        case "F":
          e.preventDefault();
          fit();
          break;
      }
    },
    [zoomIn, zoomOut, resetZoom, fit]
  );

  return { zoom, far: view.far, dragging, scrollElement, innerElement, padRef, zoomTo, zoomIn, zoomOut, resetZoom, fit, fitRect, onPointerDown, onPointerMove, onPointerUp, onPointerAbort, onClickCapture, onKeyDown };
}
