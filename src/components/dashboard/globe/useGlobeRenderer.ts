"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { TILT_MAX, TILT_MIN, ZOOM_MAX, ZOOM_MIN, clamp } from "./geometry";
import { INTRO, INTRO_DONE } from "./intro";
import type { GlobeModel } from "./model";
import type { CanvasPalette } from "./palette";
import { drawGlobe, type Hits } from "./render";

/*
 * Owns the canvas: DPR sizing, the single rAF loop, the intro's elapsed time, and all
 * pointer / wheel / keyboard input. Camera state (rot, tilt, zoom, drag) lives
 * in refs because it changes every frame; React state is reserved for what
 * the DOM needs (hover, selection, filter), which the parent owns and mirrors
 * in here through `view`.
 */

export type Sel = { type: "node" | "arc"; i: number };
export interface Hover {
  i: number;
  x: number;
  y: number;
  /** Canvas size at the time of the hover, for clamping the tooltip. */
  w: number;
  h: number;
}
export interface GlobeView {
  hover: Hover | null;
  sel: Sel | null;
  filter: string | null;
}

export interface GlobeRendererOptions {
  model: GlobeModel;
  /** Null until the theme is known — nothing is drawn before then. */
  palette: CanvasPalette | null;
  reduced: boolean;
  /** Play the assembly intro on this mount (parent has already gated it). */
  intro: boolean;
  /** Origin of the intro clock (performance.now() domain), null until the
   *  estate is in — the canvas stays blank behind the cover until then. */
  introT0: number | null;
  autoRotate?: boolean;
  view: GlobeView;
  onHover: (h: Hover | null) => void;
  onSelect: (sel: Sel | null) => void;
}

interface Drag {
  x: number;
  y: number;
  rot: number;
  tilt: number;
  moved: boolean;
}

const INITIAL_ROT = -0.9;
const INITIAL_TILT = -0.3;

function resolveMonoFont(): string {
  if (typeof document === "undefined") return "ui-monospace, monospace";
  const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
  return fam ? `${fam}, ui-monospace, monospace` : "ui-monospace, monospace";
}

export function useGlobeRenderer(opts: GlobeRendererOptions) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rotRef = useRef(INITIAL_ROT);
  const tiltRef = useRef(INITIAL_TILT);
  const zoomRef = useRef(1);
  const dragRef = useRef<Drag | null>(null);
  const hitsRef = useRef<Hits>({ nodes: [], arcs: [] });
  const fontRef = useRef("ui-monospace, monospace");
  const introDoneRef = useRef(false);
  const lastRef = useRef(0);
  const rafRef = useRef(0);
  // Everything the frame reads that comes from React, mirrored after each
  // render (before paint) so the loop and the handlers never go stale.
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    optsRef.current = opts;
  });

  const draw = useCallback((nowMs: number) => {
    const ctx = ctxRef.current;
    const o = optsRef.current;
    if (!ctx || !o.palette) return;
    const { w, h } = sizeRef.current;
    let el = INTRO_DONE;
    if (o.intro && !introDoneRef.current) {
      if (o.introT0 === null) {
        // Nothing to assemble yet: keep the canvas blank behind the cover.
        ctx.clearRect(0, 0, w, h);
        hitsRef.current = { nodes: [], arcs: [] };
        return;
      }
      el = (nowMs - o.introT0) / 1000;
      if (el > INTRO.doneAt) {
        introDoneRef.current = true;
        el = INTRO_DONE;
      }
    }
    const hover = o.view.hover;
    const sel = o.view.sel;
    hitsRef.current = drawGlobe(ctx, {
      model: o.model,
      P: o.palette,
      w,
      h,
      rot: rotRef.current,
      tilt: tiltRef.current,
      zoom: zoomRef.current,
      time: nowMs / 1000,
      el,
      reduced: o.reduced,
      filter: o.view.filter,
      hoverIdx: hover ? hover.i : -1,
      selNode: sel && sel.type === "node" ? sel.i : -1,
      selArc: sel && sel.type === "arc" ? sel.i : -1,
      fontMono: fontRef.current,
    });
  }, []);

  /** Redraw now — the reduced-motion path calls this after every change. */
  const redraw = useCallback(() => draw(performance.now()), [draw]);

  // Size + DPR
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sizeRef.current = { w, h };
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxRef.current = ctx;
      redraw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    // ResizeObserver stays silent when only the DPR changes (browser zoom).
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [redraw]);

  // Geist Mono for canvas labels: resolve the family, wait for it to load,
  // then redraw so measureText uses the real metrics.
  useEffect(() => {
    fontRef.current = resolveMonoFont();
    let cancelled = false;
    const done = () => !cancelled && redraw();
    if (document.fonts) {
      document.fonts.load(`11px ${fontRef.current}`).then(done, done);
      document.fonts.ready.then(done, done);
    }
    return () => {
      cancelled = true;
    };
  }, [redraw]);

  // The loop (or, under reduced motion, a single static draw).
  useEffect(() => {
    if (opts.reduced) {
      redraw();
      return;
    }
    lastRef.current = performance.now();
    const loop = (t: number) => {
      const o = optsRef.current;
      const dt = Math.min(0.05, (t - lastRef.current) / 1000);
      lastRef.current = t;
      const rotate = (o.autoRotate ?? true) && !dragRef.current && o.view.hover === null;
      if (rotate) rotRef.current += dt * 0.05;
      draw(t);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [opts.reduced, draw, redraw]);

  // Reduced motion has no loop, so state changes must trigger a draw.
  const { hover, sel, filter } = opts.view;
  useEffect(() => {
    if (opts.reduced) redraw();
  }, [opts.reduced, opts.model, opts.palette, hover, sel, filter, redraw]);

  // Input
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;

    const pos = (e: PointerEvent): [number, number] => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const pick = (mx: number, my: number) => {
      const hits = hitsRef.current;
      let best: { x: number; y: number; i: number } | null = null;
      let bd = 196;
      for (const p of hits.nodes) {
        const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) return { kind: "node" as const, ...best };
      bd = 81;
      for (const p of hits.arcs) {
        const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return best ? { kind: "arc" as const, ...best } : null;
    };
    const afterInput = () => {
      if (optsRef.current.reduced) redraw();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const [x, y] = pos(e);
      dragRef.current = { x, y, rot: rotRef.current, tilt: tiltRef.current, moved: false };
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = pos(e);
      const drag = dragRef.current;
      if (drag) {
        const dx = x - drag.x;
        const dy = y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        rotRef.current = drag.rot + dx * 0.005;
        tiltRef.current = clamp(drag.tilt - dy * 0.004, TILT_MIN, TILT_MAX);
        afterInput();
        return;
      }
      const hit = pick(x, y);
      const cur = optsRef.current.view.hover;
      if (hit && hit.kind === "node") {
        if (!cur || cur.i !== hit.i) {
          optsRef.current.onHover({ i: hit.i, x: hit.x, y: hit.y, w: sizeRef.current.w, h: sizeRef.current.h });
        }
        cv.style.cursor = "pointer";
      } else {
        if (cur) optsRef.current.onHover(null);
        cv.style.cursor = hit ? "pointer" : "grab";
      }
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
      cv.style.cursor = "grab";
      if (!drag.moved) {
        const [x, y] = pos(e);
        const hit = pick(x, y);
        optsRef.current.onSelect(hit ? { type: hit.kind, i: hit.i } : null);
      }
      afterInput();
    };
    const onLeave = () => {
      if (dragRef.current) return;
      if (optsRef.current.view.hover) optsRef.current.onHover(null);
      cv.style.cursor = "grab";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current = clamp(zoomRef.current * (e.deltaY > 0 ? 0.94 : 1.06), ZOOM_MIN, ZOOM_MAX);
      afterInput();
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "ArrowLeft") rotRef.current -= 0.07;
      else if (k === "ArrowRight") rotRef.current += 0.07;
      else if (k === "ArrowUp") tiltRef.current = Math.max(TILT_MIN, tiltRef.current - 0.05);
      else if (k === "ArrowDown") tiltRef.current = Math.min(TILT_MAX, tiltRef.current + 0.05);
      else if (k === "+" || k === "=") zoomRef.current = Math.min(ZOOM_MAX, zoomRef.current * 1.08);
      else if (k === "-" || k === "_") zoomRef.current = Math.max(ZOOM_MIN, zoomRef.current * 0.92);
      else if (k === "Enter") {
        const cur = optsRef.current.view.hover;
        if (!cur) return;
        optsRef.current.onSelect({ type: "node", i: cur.i });
        e.preventDefault();
        return;
      } else return;
      e.preventDefault();
      afterInput();
    };

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("keydown", onKey);
    return () => {
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onUp);
      cv.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("keydown", onKey);
    };
  }, [redraw]);

  return { wrapRef, canvasRef, redraw };
}
