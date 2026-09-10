"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Canvas camera — the pan/zoom state and the pointer/wheel/keyboard
 * mechanics shared by DOM-node canvases (the system map and the Martech
 * canvas): fit / zoom / pan-with-inertia / centre-on, independent of any
 * one layout.
 *
 * The hook owns no node knowledge: `centerOn` takes world coordinates and
 * node presses are reported by id, so the caller decides what a click means.
 */

export interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

export interface UseCameraOptions {
  /** World (unscaled) size the camera fits to. */
  worldW: number;
  worldH: number;
  /** A right dock is open: fit and centre leave room for it. */
  dockOpen?: boolean;
  /** Reserved dock width in px (default 330 when dockOpen). */
  dockWidth?: number;
  fitMin?: number;
  fitMax?: number;
  zoomMin?: number;
  zoomMax?: number;
  onZoomChange?: (zoom: number) => void;
}

export function useCamera({
  worldW,
  worldH,
  dockOpen = false,
  dockWidth,
  fitMin = 0.62,
  fitMax = 1.05,
  zoomMin = 0.25,
  zoomMax = 1.8,
  onZoomChange,
}: UseCameraOptions) {
  const [cam, setCam] = useState<Camera>({ zoom: 0.8, panX: 0, panY: 0 });
  const [drag, setDrag] = useState(false);
  const [glide, setGlide] = useState(false);
  const [settled, setSettled] = useState(false);

  const vp = useRef<HTMLDivElement | null>(null);
  const panData = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  const vel = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0, t: 0 });
  const raf = useRef(0);
  const pressed = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);

  /* ---------- fit ---------- */

  const fit = useCallback(() => {
    const el = vp.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const reserved = dockOpen ? (dockWidth ?? 330) : 50;
    const availW = r.width - reserved;
    const availH = r.height - 70;
    const z = Math.max(fitMin, Math.min(fitMax, availW / worldW, availH / worldH));
    const cw = worldW * z;
    const ch = worldH * z;
    // Centre when it fits; otherwise anchor top-left with a margin so the
    // first column is on screen and the rest is one drag away.
    const panX = cw <= availW ? (availW - cw) / 2 + 10 : 10;
    const panY = ch <= availH ? (availH - ch) / 2 + 10 : 10;
    setGlide(false);
    setCam({ zoom: z, panX, panY });
  }, [worldW, worldH, dockOpen, dockWidth, fitMin, fitMax]);

  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  // Fit on mount, on world-size change, and on viewport resize (rAF-debounced).
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        fitRef.current();
        setSettled(true);
      });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [worldW, worldH, dockOpen]);

  useEffect(() => {
    onZoomChange?.(cam.zoom);
  }, [cam.zoom, onZoomChange]);

  /* ---------- centre / zoom ---------- */

  /** Bring a world point into the comfortable box; no-op when already inside. */
  const centerOn = useCallback(
    (wx: number, wy: number) => {
      const el = vp.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const z = cam.zoom;
      const right = dockOpen ? (dockWidth ?? 330) : 20;
      const cx = 20 + (r.width - 20 - right) / 2;
      const cy = 40 + (r.height - 60) / 2;
      const sx = wx * z + cam.panX;
      const sy = wy * z + cam.panY;
      const inside = sx > 100 && sx < r.width - right - 80 && sy > 70 && sy < r.height - 70;
      if (inside) return;
      setGlide(false);
      setCam((c) => ({ ...c, panX: cx - z * wx, panY: cy - z * wy }));
    },
    [cam.zoom, cam.panX, cam.panY, dockOpen, dockWidth]
  );

  const zoomBy = useCallback(
    (f: number, ax?: number, ay?: number) => {
      setCam((c) => {
        const z = Math.min(zoomMax, Math.max(zoomMin, c.zoom * f));
        const el = vp.current;
        if (!el) return { ...c, zoom: z };
        const r = el.getBoundingClientRect();
        const cx = ax ?? r.width / 2;
        const cy = ay ?? r.height / 2;
        return { zoom: z, panX: cx - ((cx - c.panX) * z) / c.zoom, panY: cy - ((cy - c.panY) * z) / c.zoom };
      });
    },
    [zoomMin, zoomMax]
  );

  const panBy = useCallback((dx: number, dy: number) => {
    setGlide(false);
    setCam((c) => ({ ...c, panX: c.panX + dx, panY: c.panY + dy }));
  }, []);

  /* Wheel: zoom toward cursor with ⌘/ctrl or pinch; plain wheel pans. */
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomBy(e.deltaY < 0 ? 1.08 : 0.92, e.clientX - r.left, e.clientY - r.top);
      } else {
        setGlide(false);
        setCam((c) => ({ ...c, panX: c.panX - e.deltaX, panY: c.panY - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* ---------- pan / inertia ---------- */

  const panDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(raf.current);
    panData.current = { sx: e.clientX, sy: e.clientY, px: cam.panX, py: cam.panY, moved: false };
    vel.current = { x: 0, y: 0 };
    last.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    setGlide(false);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };
  const panMove = (e: React.PointerEvent) => {
    const d = panData.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      setDrag(true);
    }
    const now = performance.now();
    const dt = Math.max(1, now - last.current.t);
    vel.current = { x: ((e.clientX - last.current.x) / dt) * 16, y: ((e.clientY - last.current.y) / dt) * 16 };
    last.current = { x: e.clientX, y: e.clientY, t: now };
    setCam((c) => ({ ...c, panX: d.px + e.clientX - d.sx, panY: d.py + e.clientY - d.sy }));
  };
  const panUp = () => {
    const d = panData.current;
    panData.current = null;
    if (!d) return;
    setDrag(false);
    if (!d.moved) return;
    const v = { ...vel.current };
    if (Math.abs(v.x) + Math.abs(v.y) > 2) {
      setGlide(true);
      const step = () => {
        v.x *= 0.92;
        v.y *= 0.92;
        if (Math.abs(v.x) + Math.abs(v.y) < 0.4) {
          setGlide(false);
          return;
        }
        setCam((c) => ({ ...c, panX: c.panX + v.x, panY: c.panY + v.y }));
        raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    }
  };

  /* ---------- node press (click vs. pan) ---------- */

  // Node presses must not bubble to the viewport: its own pointerdown would
  // re-capture the pointer and swallow the click. The node captures instead,
  // and a press that travels becomes a pan.
  const nodeDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pressed.current = { id, sx: e.clientX, sy: e.clientY, moved: false };
    panDown(e);
  };
  const nodeMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    const p = pressed.current;
    if (p && !p.moved && Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 4) p.moved = true;
    panMove(e);
  };
  /** Returns the node id when the press was a click (did not travel). */
  const nodeUp = (e: React.PointerEvent): string | null => {
    e.stopPropagation();
    const p = pressed.current;
    pressed.current = null;
    panUp();
    return p && !p.moved ? p.id : null;
  };

  /* ---------- keyboard (viewport-level) ---------- */

  /** +/− zoom, F fits, arrows pan when the viewport itself is focused. Returns true when handled. */
  const keyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return false;
      if (e.key === "+" || e.key === "=") {
        zoomBy(1.2);
        return true;
      }
      if (e.key === "-" || e.key === "_") {
        zoomBy(0.83);
        return true;
      }
      if (e.key === "f" || e.key === "F") {
        fitRef.current();
        return true;
      }
      if (e.target === vp.current && (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const step = e.shiftKey ? 180 : 60;
        const dx = e.key === "ArrowRight" ? -step : e.key === "ArrowLeft" ? step : 0;
        const dy = e.key === "ArrowDown" ? -step : e.key === "ArrowUp" ? step : 0;
        panBy(dx, dy);
        return true;
      }
      return false;
    },
    [zoomBy, panBy]
  );

  const worldTransition = drag || glide || !settled ? "transform 0s" : "transform .45s var(--ease-out)";

  return {
    cam,
    drag,
    glide,
    settled,
    vp,
    fit,
    zoomBy,
    panBy,
    centerOn,
    keyDown,
    worldTransition,
    viewportHandlers: { onPointerDown: panDown, onPointerMove: panMove, onPointerUp: panUp, onPointerCancel: panUp },
    nodeDown,
    nodeMove,
    nodeUp,
  };
}
