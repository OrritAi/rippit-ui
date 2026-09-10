"use client";

import { memo, useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { MINIMAP_H, MINIMAP_W } from "@/lib/workflowMap/tokens";
import type { MapBox } from "./useMapMeasure";

/*
 * MapMinimap — the whole map in a glass panel at the bottom-right of the
 * canvas, shown only while the content overflows the viewport (zoomed in,
 * or simply a big map). Root rows are faint blocks, pills accent rounded
 * rects, steps small squares, and the viewport a stroked accent rectangle.
 * Click or drag anywhere on it to move the viewport there. Everything is
 * in inner (content) coordinates; the viewport rectangle comes from the
 * viewport's and the inner's client rects on every scroll (rAF-throttled,
 * passive), so the slack pad around the content never shifts it.
 */

interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
  cw: number;
  ch: number;
  /** Scroll coordinates of the content origin (the pad's inner edge). */
  ox: number;
  oy: number;
}

export const MapMinimap = memo(function MapMinimap({
  scrollElement,
  innerElement,
  zoom,
  boxes,
  rowBoxes,
}: {
  scrollElement: () => HTMLDivElement | null;
  innerElement: () => HTMLDivElement | null;
  zoom: number;
  boxes: MapBox[];
  rowBoxes: MapBox[];
}) {
  const [vp, setVp] = useState<Viewport | null>(null);
  const raf = useRef(0);
  const dragging = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const read = useCallback(() => {
    raf.current = 0;
    const sb = scrollElement();
    const inner = innerElement();
    if (!sb || !inner) return;
    const ir = inner.getBoundingClientRect();
    const sr = sb.getBoundingClientRect();
    const z = zoom || 1;
    const next: Viewport = {
      x: (sr.left - ir.left) / z,
      y: (sr.top - ir.top) / z,
      w: sb.clientWidth / z,
      h: sb.clientHeight / z,
      cw: ir.width / z,
      ch: ir.height / z,
      ox: sb.scrollLeft + ir.left - sr.left,
      oy: sb.scrollTop + ir.top - sr.top,
    };
    setVp((cur) =>
      cur && cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h && cur.cw === next.cw && cur.ch === next.ch && cur.ox === next.ox && cur.oy === next.oy
        ? cur
        : next
    );
  }, [scrollElement, innerElement, zoom]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(read);
  }, [read]);

  useEffect(() => {
    const sb = scrollElement();
    if (!sb) return;
    schedule();
    sb.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      sb.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [scrollElement, schedule]);

  /* Content size follows the measured boxes and the zoom. */
  useEffect(() => schedule(), [boxes, rowBoxes, zoom, schedule]);

  const overflow = vp != null && (vp.w < vp.cw - 1 || vp.h < vp.ch - 1);

  const moveTo = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      const sb = scrollElement();
      const svg = svgRef.current;
      if (!sb || !svg || !vp) return;
      const r = svg.getBoundingClientRect();
      const scale = Math.min(r.width / vp.cw, r.height / vp.ch);
      const ox = (r.width - vp.cw * scale) / 2;
      const oy = (r.height - vp.ch * scale) / 2;
      const cx = (e.clientX - r.left - ox) / scale;
      const cy = (e.clientY - r.top - oy) / scale;
      const z = zoom || 1;
      sb.scrollTo({ left: vp.ox + (cx - vp.w / 2) * z, top: vp.oy + (cy - vp.h / 2) * z, behavior: "instant" });
    },
    [scrollElement, vp, zoom]
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      moveTo(e);
    },
    [moveTo]
  );
  const onPointerMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (dragging.current) moveTo(e);
    },
    [moveTo]
  );
  const onPointerUp = useCallback((e: PointerEvent<SVGSVGElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  if (!vp || !overflow) return null;

  const scale = Math.min(MINIMAP_W / vp.cw, MINIMAP_H / vp.ch);
  const ox = (MINIMAP_W - vp.cw * scale) / 2;
  const oy = (MINIMAP_H - vp.ch * scale) / 2;
  const sx = (v: number) => ox + v * scale;
  const sy = (v: number) => oy + v * scale;

  return (
    <div className="wm-rise absolute bottom-3 right-3 z-[4] overflow-hidden rounded-card border border-line bg-glass shadow-[var(--shadow-float)] backdrop-blur-[14px]">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Map overview — click or drag to move the view"
        width={MINIMAP_W}
        height={MINIMAP_H}
        className="block cursor-crosshair touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {rowBoxes.map((b) => (
          <rect key={b.id} x={sx(b.x)} y={sy(b.y)} width={Math.max(1, b.w * scale)} height={Math.max(1, b.h * scale)} rx={2} fill="var(--hover)" />
        ))}
        {boxes.map((b) => (
          <rect
            key={b.id}
            x={sx(b.x)}
            y={sy(b.y)}
            width={Math.max(1.5, b.w * scale)}
            height={Math.max(1.5, b.h * scale)}
            rx={b.pill ? Math.max(1, (b.h * scale) / 2) : 1}
            fill={b.pill ? "color-mix(in srgb, var(--map-accent) 70%, transparent)" : "var(--t3)"}
          />
        ))}
        <rect
          x={sx(vp.x)}
          y={sy(vp.y)}
          width={Math.max(2, vp.w * scale)}
          height={Math.max(2, vp.h * scale)}
          rx={2}
          fill="color-mix(in srgb, var(--map-accent) 10%, transparent)"
          stroke="var(--map-accent)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
});
