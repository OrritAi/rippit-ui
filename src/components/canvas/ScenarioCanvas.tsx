"use client";

import { SoftwareLogo } from "@/components/shared/SoftwareLogo";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { appColor, appGlyph, appName } from "@/lib/apps";
import { CONNECTORS, badgeTooltip, isProviderId, providerColor } from "@/lib/connectors";
import type { UnifiedGroup } from "@/lib/connectors/types";
import type { ModuleInfo, Connection, NodeId } from "@/app/lib/api";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { IconBtn } from "@/components/shell/IconBtn";
import {
  ASSET_KINDS,
  COL_W,
  CROSS_KINDS,
  MARGIN_X,
  MARGIN_Y,
  NODE_HALF,
  NON_LAYOUT_KINDS,
  ROW_H,
  computeLayout,
  edgePath,
  ordinalPhrase,
  worstSeverity,
} from "./layout";

export { worstSeverity, ordinalPhrase } from "./layout";

/*
 * Workflow canvas (v2 shell). DOM nodes + one SVG for edges; pan/zoom via a
 * single transform on the world layer. Keyboard: Tab reaches steps (roving
 * tabindex), arrows move along the flow, Enter opens; with the canvas itself
 * focused arrows pan and + / − / F zoom / fit. A screen-reader list mirrors
 * the structure. Live runs animate as pulses along sequence edges (SMIL),
 * only while the tab is visible and the user hasn't asked for reduced motion.
 */

const SEVERITY_VAR = { error: "--err", warn: "--warn", info: "--off" } as const;
const FIT_MIN = 0.62;
const FIT_MAX = 1.05;
const PULSE_CAP = 40;
const LITE_AT = 120;

interface CanvasNode {
  id: NodeId;
  cx: number;
  cy: number;
  col: number;
  label: string;
  app: string;
  color: string;
  glyph: string;
  hasFilter: boolean;
  filterName: string | null;
  hasErrorHandler: boolean;
  badge?: string;
  kind?: string;
  summary?: string;
  ordinal?: string | null;
  waitText?: string | null;
  issueSeverity?: "error" | "warn" | "info" | null;
  issueText?: string | null;
  changed?: boolean;
  commentCount?: number;
  runLine?: { text: string; failing: boolean } | null;
}

interface EdgeView {
  key: number;
  d: string;
  label?: string;
  kind?: string;
  status?: string;
  mx: number;
  my: number;
  seq: boolean;
}

/** Per-step run annotation (under the label). Optional — never invented. */
export interface RunStat {
  text: string;
  failing?: boolean;
}

function useTabVisible(): boolean {
  const [v, setV] = useState(true);
  useEffect(() => {
    const on = () => setV(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return v;
}

export default function ScenarioCanvas({
  modules,
  connections,
  groups,
  selectedId,
  onNodeClick,
  live = false,
  dockOpen = false,
  dockWidth,
  runStats,
  onZoomChange,
  entrance = true,
  matchingNodeIds,
}: {
  modules: ModuleInfo[];
  connections: Connection[];
  groups?: UnifiedGroup[];
  selectedId?: NodeId | null;
  onNodeClick?: (moduleId: NodeId) => void;
  /** Workflow is active and ran recently → pulses along sequence edges. */
  live?: boolean;
  /** A right dock is open: fit leaves room for it. */
  dockOpen?: boolean;
  /** Actual reserved dock width in px. Defaults to 330 when dockOpen is true;
   *  the linked-workflow panel opens wider (560), so it passes this. */
  dockWidth?: number;
  /** Optional per-step run line, keyed by node id. */
  runStats?: Record<string, RunStat>;
  onZoomChange?: (zoom: number) => void;
  /** Stagger the nodes in on first paint. */
  entrance?: boolean;
  /** Filter emphasis preserves every branch and its context. */
  matchingNodeIds?: Set<string> | null;
}) {
  const [cam, setCam] = useState({ zoom: 0.8, panX: 0, panY: 0 });
  const [drag, setDrag] = useState(false);
  const [glide, setGlide] = useState(false);
  const [settled, setSettled] = useState(false);
  const reduced = usePrefersReducedMotion();
  const visible = useTabVisible();

  const vp = useRef<HTMLDivElement | null>(null);
  const panData = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  const vel = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0, t: 0 });
  const raf = useRef(0);
  const pressed = useRef<{ id: NodeId; sx: number; sy: number; moved: boolean } | null>(null);

  const layout = useMemo(() => computeLayout(modules, connections, groups), [modules, connections, groups]);

  const nodes: CanvasNode[] = useMemo(
    () =>
      modules.map((m, i) => {
        const base = layout.posOf.get(m.id) ?? {
          cx: MARGIN_X + (i % 4) * COL_W,
          cy: MARGIN_Y + Math.floor(i / 4) * ROW_H,
          col: 0,
        };
        const rs = runStats?.[String(m.id)];
        return {
          id: m.id,
          cx: base.cx,
          cy: base.cy,
          col: base.col,
          label: m.label || m.module,
          app: m.app || m.module,
          color: appColor(m.app || m.module),
          glyph: appGlyph(m.app || m.module),
          hasFilter: m.hasFilter,
          filterName: m.filterName,
          hasErrorHandler: m.hasErrorHandler,
          badge: m.badge,
          kind: m.kind,
          summary: m.summary,
          ordinal: m.ordinal ?? null,
          waitText: m.waitFor?.text ?? null,
          issueSeverity: worstSeverity(m.issues),
          issueText: m.issues?.map((i) => i.message).join(" · ") ?? null,
          changed: m.changed,
          commentCount: m.commentCount,
          runLine: rs ? { text: rs.text, failing: !!rs.failing } : null,
        };
      }),
    [modules, layout, runStats]
  );

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const lite = nodes.length > LITE_AT;

  const edges: EdgeView[] = useMemo(
    () =>
      connections
        .filter((c) => byId.has(c.from) && byId.has(c.to))
        .map((c, i) => {
          const a = byId.get(c.from)!;
          const b = byId.get(c.to)!;
          // midpoint of the cubic at t = .5 for the label pill
          const mx = (a.cx + b.cx) / 2;
          const my = (a.cy + b.cy) / 2;
          return {
            key: i,
            d: edgePath(a.cx, a.cy, b.cx, b.cy),
            label: c.label,
            kind: c.kind,
            status: c.status,
            mx,
            my,
            seq: !NON_LAYOUT_KINDS.has(c.kind ?? "") && a.kind !== "portal" && b.kind !== "portal",
          };
        }),
    [connections, byId]
  );

  const pulseEdges = useMemo(() => edges.filter((e) => e.seq).slice(0, PULSE_CAP), [edges]);
  const showPulses = live && visible && !reduced && !lite && pulseEdges.length > 0;

  /* ---------- camera ---------- */

  const fit = useCallback(() => {
    const el = vp.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const reserved = dockOpen ? (dockWidth ?? 330) : 50;
    const availW = r.width - reserved;
    const availH = r.height - 70;
    const z = Math.max(FIT_MIN, Math.min(FIT_MAX, availW / layout.w, availH / layout.h));
    const cw = layout.w * z;
    const ch = layout.h * z;
    // Centre when it fits; otherwise anchor top-left with a margin so the
    // first column is on screen and the rest is one drag away.
    const panX = cw <= availW ? (availW - cw) / 2 + 10 : 10;
    const panY = ch <= availH ? (availH - ch) / 2 + 10 : 10;
    setGlide(false);
    setCam({ zoom: z, panX, panY });
  }, [layout, dockOpen, dockWidth]);

  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  // Fit on mount, on layout change, and on viewport resize (rAF-debounced).
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
  }, [layout, dockOpen]);

  useEffect(() => {
    onZoomChange?.(cam.zoom);
  }, [cam.zoom, onZoomChange]);

  const centerOn = useCallback(
    (id: NodeId) => {
      const el = vp.current;
      const n = byId.get(id);
      if (!el || !n) return;
      const r = el.getBoundingClientRect();
      const z = cam.zoom;
      const right = dockOpen ? (dockWidth ?? 330) : 20;
      const cx = 20 + (r.width - 20 - right) / 2;
      const cy = 40 + (r.height - 60) / 2;
      // Only move when the node is outside the comfortable box.
      const sx = n.cx * z + cam.panX;
      const sy = n.cy * z + cam.panY;
      const inside = sx > 100 && sx < r.width - right - 80 && sy > 70 && sy < r.height - 70;
      if (inside) return;
      setGlide(false);
      setCam((c) => ({ ...c, panX: cx - z * n.cx, panY: cy - z * n.cy }));
    },
    [byId, cam.zoom, cam.panX, cam.panY, dockOpen, dockWidth]
  );

  const zoomBy = useCallback((f: number, ax?: number, ay?: number) => {
    setCam((c) => {
      const z = Math.min(1.8, Math.max(0.25, c.zoom * f));
      const el = vp.current;
      if (!el) return { ...c, zoom: z };
      const r = el.getBoundingClientRect();
      const cx = ax ?? r.width / 2;
      const cy = ay ?? r.height / 2;
      return { zoom: z, panX: cx - ((cx - c.panX) * z) / c.zoom, panY: cy - ((cy - c.panY) * z) / c.zoom };
    });
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
  const nodeDown = (e: React.PointerEvent, n: CanvasNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pressed.current = { id: n.id, sx: e.clientX, sy: e.clientY, moved: false };
    panDown(e);
  };
  const nodeMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    const p = pressed.current;
    if (p && !p.moved && Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 4) p.moved = true;
    panMove(e);
  };
  const nodeUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    const p = pressed.current;
    pressed.current = null;
    panUp();
    if (p && !p.moved) {
      onNodeClick?.(p.id);
      centerOn(p.id);
    }
  };

  /* ---------- keyboard ---------- */

  const [focusId, setFocusId] = useState<NodeId | null>(null);
  const nodeEls = useRef(new Map<NodeId, HTMLDivElement>());
  const tabTarget = focusId != null && byId.has(focusId) ? focusId : nodes[0]?.id;

  const focusNodeAt = useCallback(
    (index: number) => {
      const n = nodes[Math.max(0, Math.min(nodes.length - 1, index))];
      if (n) nodeEls.current.get(n.id)?.focus();
    },
    [nodes]
  );

  const nodeKeyDown = useCallback(
    (e: React.KeyboardEvent, n: CanvasNode) => {
      const idx = nodes.findIndex((x) => x.id === n.id);
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onNodeClick?.(n.id);
        centerOn(n.id);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        focusNodeAt(idx + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        focusNodeAt(idx - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusNodeAt(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusNodeAt(nodes.length - 1);
      }
    },
    [nodes, onNodeClick, centerOn, focusNodeAt]
  );

  const canvasKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      if (e.key === "+" || e.key === "=") zoomBy(1.2);
      else if (e.key === "-" || e.key === "_") zoomBy(0.83);
      else if (e.key === "f" || e.key === "F") fitRef.current();
      else if (e.target === vp.current && (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const step = e.shiftKey ? 180 : 60;
        const dx = e.key === "ArrowRight" ? -step : e.key === "ArrowLeft" ? step : 0;
        const dy = e.key === "ArrowDown" ? -step : e.key === "ArrowUp" ? step : 0;
        setGlide(false);
        setCam((c) => ({ ...c, panX: c.panX + dx, panY: c.panY + dy }));
      }
    },
    [zoomBy]
  );

  // Programmatic selection (palette / search / ?step= deep link) brings the
  // node into view.
  useEffect(() => {
    if (selectedId != null) centerOn(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const nodeAriaLabel = useCallback((n: CanvasNode) => {
    if (n.kind === "portal") {
      const target = isProviderId(n.app) ? CONNECTORS[n.app].label : appName(n.app);
      return `Open connected workflow ${n.label} in ${target}${n.badge === "deadLink" ? " (link broken)" : ""}`;
    }
    const parts = [n.label];
    if (n.summary && n.summary !== n.label) parts.push(n.summary);
    else parts.push(appName(n.app));
    if (n.ordinal) parts.push(`step ${n.ordinal}`);
    if (n.kind === "trigger") parts.push("trigger");
    if (n.kind === "wait" && n.waitText) parts.push(n.waitText);
    if (n.issueText) parts.push(`issue: ${n.issueText}`);
    if (n.changed) parts.push("changed since you last looked");
    if (n.commentCount) parts.push(`${n.commentCount} open comment thread${n.commentCount === 1 ? "" : "s"}`);
    if (n.hasFilter) parts.push(n.filterName ? `filtered: ${n.filterName}` : "filtered");
    if (n.hasErrorHandler) parts.push("has error handler");
    if (n.runLine) parts.push(n.runLine.text);
    if (n.badge) {
      const tip = badgeTooltip(n.badge);
      if (tip) parts.push(tip);
    }
    return parts.join(", ");
  }, []);

  const srAdjacency = useMemo(() => {
    const map = new Map<NodeId, string[]>();
    for (const c of connections) {
      if (byId.has(c.from) && byId.has(c.to)) {
        const arr = map.get(c.from) ?? [];
        arr.push(byId.get(c.to)!.label);
        map.set(c.from, arr);
      }
    }
    return map;
  }, [connections, byId]);

  const worldTrans = drag || glide || !settled ? "transform 0s" : "transform .45s var(--ease-out)";
  // Entrance is a one-shot: it plays on first paint, then latches off, so
  // toggling a filter (which flips matchingNodeIds) can never replay it on an
  // already-settled canvas.
  const [entranceDone, setEntranceDone] = useState(false);
  useEffect(() => {
    if (!entrance || lite || reduced) return;
    const t = setTimeout(() => setEntranceDone(true), 1600);
    return () => clearTimeout(t);
  }, [entrance, lite, reduced]);
  const enter = entrance && !lite && !reduced && !entranceDone;

  return (
    <div className="absolute inset-0 overflow-hidden bg-plane" onKeyDown={canvasKeyDown}>
      {/* screen-reader alternative: the flow as a structured list */}
      <div className="sr-only">
        <h2>Workflow structure</h2>
        <ol>
          {nodes.map((n) => {
            const targets = srAdjacency.get(n.id);
            return (
              <li key={String(n.id)}>
                {n.label} ({appName(n.app)})
                {targets?.length ? ` — connects to ${targets.join(", ")}` : ""}
              </li>
            );
          })}
        </ol>
      </div>

      {/* viewport — the pan/zoom surface; dot grid moves with the camera */}
      <div
        ref={vp}
        onPointerDown={panDown}
        onPointerMove={panMove}
        onPointerUp={panUp}
        onPointerCancel={panUp}
        tabIndex={0}
        role="group"
        aria-label="Workflow canvas. Tab to reach steps, arrow keys to move between them, Enter to open details. With the canvas itself focused, arrow keys pan and plus or minus zoom; F fits."
        className="absolute inset-0 outline-none"
        style={{
          cursor: drag ? "grabbing" : "grab",
          touchAction: "none",
          backgroundImage: "radial-gradient(var(--dot) 1.2px, transparent 1.6px)",
          backgroundSize: `${24 * cam.zoom}px ${24 * cam.zoom}px`,
          backgroundPosition: `${cam.panX}px ${cam.panY}px`,
          opacity: settled ? 1 : 0,
          transition: "opacity .2s var(--ease-out)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: layout.w,
            height: layout.h,
            transform: `translate(${cam.panX}px, ${cam.panY}px) scale(${cam.zoom})`,
            transition: worldTrans,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          {/* group containers — behind everything */}
          {layout.groupBoxes.map((g) => (
            <div key={g.id} aria-hidden="true">
              <div
                className="absolute rounded-card border"
                style={{
                  left: g.x,
                  top: g.y,
                  width: g.w,
                  height: g.h,
                  borderColor: "var(--line)",
                  background: "color-mix(in srgb, var(--panel) 40%, transparent)",
                }}
              />
              <div className="pointer-events-none absolute flex -translate-y-1/2 items-center gap-2 rounded-full border border-line bg-pill px-2.5 py-[4px] shadow-[var(--shadow-card)]" style={{ left: g.x + 14, top: g.y }}>
                <span className="size-[7px] flex-none rounded-[2px]" style={{ background: providerColor(g.source) }} />
                <span className="max-w-[240px] truncate text-[11.5px] font-semibold text-t1">{g.name}</span>
                <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-t3">{CONNECTORS[g.source].shortLabel}</span>
              </div>
            </div>
          ))}

          {/* edges */}
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ overflow: "visible" }} width={1} height={1}>
            {edges.map((e) => {
              const isGoto = e.kind === "goto";
              const isCross = CROSS_KINDS.has(e.kind ?? "");
              const isAsset = ASSET_KINDS.has(e.kind ?? "");
              const isDead = e.status === "dead";
              const stroke = isAsset ? "var(--t3)" : isCross ? (isDead ? "var(--err)" : "var(--warn)") : "var(--edge)";
              return (
                <path
                  key={e.key}
                  d={e.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isCross ? 1.75 : 1.5}
                  opacity={isGoto ? 0.55 : isAsset ? 0.8 : 1}
                  strokeDasharray={isGoto ? "6 6" : isCross ? "7 6" : isAsset ? "2 5" : undefined}
                  className={isCross && !lite && !reduced ? "edge-drift" : undefined}
                />
              );
            })}
            {showPulses &&
              pulseEdges.map((e, i) => (
                <circle key={`p${e.key}`} r={2.3} fill="var(--t1)" opacity={0.9}>
                  <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${(i * 0.35).toFixed(2)}s`} path={e.d} />
                </circle>
              ))}
          </svg>

          {/* edge label pills */}
          {edges
            .filter((e) => e.label)
            .map((e) => {
              const isCross = CROSS_KINDS.has(e.kind ?? "");
              const isDead = e.status === "dead";
              const accent = isDead ? "var(--err)" : "var(--warn)";
              return (
                <div
                  key={`l${e.key}`}
                  className="pointer-events-none absolute max-w-[180px] -translate-x-1/2 -translate-y-1/2 truncate rounded-full border px-2 py-[2px] text-[10.5px] font-semibold shadow-[var(--shadow-card)]"
                  style={{
                    left: e.mx,
                    top: e.my,
                    ...(isCross
                      ? { color: isDead ? "var(--err-text)" : "var(--warn-text)", borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`, background: `color-mix(in srgb, ${accent} 12%, var(--pill))` }
                      : { color: "var(--t2)", borderColor: "var(--line)", background: "var(--pill)" }),
                  }}
                >
                  {isDead ? `! ${e.label}` : e.label}
                </div>
              );
            })}

          {/* nodes */}
          {nodes.map((n, i) => {
            const selected = selectedId === n.id;
            const delay = enter ? `${(Math.min(i, 30) * 0.035).toFixed(3)}s` : "0s";

            if (n.kind === "portal") {
              const dead = n.badge === "deadLink";
              const accent = dead ? "var(--err)" : "var(--warn)";
              const text = dead ? "var(--err-text)" : "var(--warn-text)";
              const provider = isProviderId(n.app) ? CONNECTORS[n.app].shortLabel : appName(n.app);
              return (
                <div
                  key={n.id}
                  ref={(el) => {
                    if (el) nodeEls.current.set(n.id, el);
                    else nodeEls.current.delete(n.id);
                  }}
                  onPointerDown={(e) => nodeDown(e, n)}
                  onPointerMove={nodeMove}
                  onPointerUp={nodeUp}
                  onKeyDown={(e) => nodeKeyDown(e, n)}
                  onFocus={() => {
                    setFocusId(n.id);
                    centerOn(n.id);
                  }}
                  role="button"
                  tabIndex={tabTarget === n.id ? 0 : -1}
                  aria-label={nodeAriaLabel(n)}
                  title={dead ? "Dead link — target hook gone" : `Opens ${n.label}`}
                  className="group/portal absolute flex w-[160px] cursor-pointer flex-col items-center gap-[3px] outline-none focus-visible:[&>span:first-child]:ring-2 focus-visible:[&>span:first-child]:ring-[var(--ringc)]"
                  style={{
                    left: n.cx - 80,
                    top: n.cy - 18,
                    touchAction: "none",
                    // Portals can't match a software/trigger/asset filter, so a
                    // filtered view dims them like every other non-match rather
                    // than leaving them lit over a greyed canvas.
                    opacity: matchingNodeIds && !matchingNodeIds.has(String(n.id)) && !selected ? 0.3 : 1,
                    animation: enter && !matchingNodeIds ? `fadeUp .4s var(--ease-out) .4s both` : undefined, // one-shot; see entranceDone
                  }}
                >
                  <span
                    className={`flex max-w-[160px] items-center gap-1.5 rounded-full border-2 px-[11px] py-[5px] text-[11.5px] font-bold backdrop-blur-[8px] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] group-hover/portal:-translate-y-[2px] ${
                      selected ? "scale-[1.1]" : ""
                    }`}
                    style={{
                      borderColor: accent,
                      background: `color-mix(in srgb, ${accent} 12%, var(--glass))`,
                      color: text,
                      boxShadow: `0 4px 12px var(--shade)${selected ? ", 0 0 0 2.5px var(--ringc)" : ""}`,
                    }}
                  >
                    <span aria-hidden="true">↗</span>
                    <span className="truncate">{n.label}</span>
                  </span>
                  <span className="text-[9.5px] font-semibold uppercase tracking-[.04em] text-t3">
                    {provider}
                    {dead ? " · broken" : ""}
                  </span>
                </div>
              );
            }

            const second = n.kind === "wait" && n.waitText ? n.waitText : n.summary && n.summary !== n.label ? n.summary : appName(n.app);
            return (
              <div
                key={n.id}
                ref={(el) => {
                  if (el) nodeEls.current.set(n.id, el);
                  else nodeEls.current.delete(n.id);
                }}
                onPointerDown={(e) => nodeDown(e, n)}
                onPointerMove={nodeMove}
                onPointerUp={nodeUp}
                onKeyDown={(e) => nodeKeyDown(e, n)}
                onFocus={() => {
                  setFocusId(n.id);
                  centerOn(n.id);
                }}
                role="button"
                tabIndex={tabTarget === n.id ? 0 : -1}
                aria-label={nodeAriaLabel(n)}
                aria-pressed={selected}
                className="group/node absolute flex w-[132px] cursor-pointer flex-col items-center gap-[5px] outline-none transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:-translate-y-[2px] focus-visible:[&_.puck]:ring-2 focus-visible:[&_.puck]:ring-[var(--ringc)] focus-visible:[&_.puck]:ring-offset-2 focus-visible:[&_.puck]:ring-offset-[var(--plane)]"
                style={{
                  left: n.cx - NODE_HALF,
                  top: n.cy - 24,
                  touchAction: "none",
                  zIndex: selected ? 2 : 1,
                  opacity: matchingNodeIds && !matchingNodeIds.has(String(n.id)) && !selected ? 0.3 : 1,
                  animation: enter && !matchingNodeIds ? `fadeUp .3s var(--ease-out) ${delay} both` : undefined,
                }}
              >
                {/* Selection scale lives here, not on the wrapper — the entrance
                    animation's fill:both owns the wrapper's transform. */}
                <span
                  className={`relative size-[46px] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] ${
                    selected ? "scale-[1.18]" : ""
                  }`}
                >
                  <span
                    className="puck absolute inset-0 flex items-center justify-center rounded-node border border-white/40 font-mono text-[12.5px] font-extrabold text-white transition-[box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
                    style={{
                      background: `color-mix(in oklab, ${n.color} 52%, #000)`,
                      boxShadow: `${selected ? "0 0 0 2.5px var(--ringc), " : ""}0 4px 0 color-mix(in oklab, ${n.color} 40%, #000), 0 9px 18px var(--ambient)`,
                      textShadow: "0 1px 2px rgba(0,0,0,.3)",
                    }}
                  >
                    <SoftwareLogo app={n.app} fallback={n.glyph} size={24} />
                  </span>
                  {n.hasFilter && (
                    <span aria-hidden="true" title={n.filterName || "Filter"} className="absolute -right-[3px] -top-[3px] size-[10px] rounded-full border-2 border-plane" style={{ background: "var(--warn)" }} />
                  )}
                  {n.hasErrorHandler && (
                    <span aria-hidden="true" title="Error handler" className="absolute -bottom-[3px] -right-[3px] size-[10px] rounded-full border-2 border-plane" style={{ background: "var(--err)" }} />
                  )}
                  {n.badge && (
                    <span
                      aria-hidden="true"
                      title={badgeTooltip(n.badge) ?? undefined}
                      className="absolute -left-[3px] -top-[3px] size-[10px] rounded-full border-2 border-plane"
                      style={{ background: n.badge === "unmatchedLink" ? "var(--err)" : "var(--warn)" }}
                    />
                  )}
                  {n.issueSeverity && (
                    <span
                      aria-hidden="true"
                      title={n.issueText ?? undefined}
                      className="absolute -bottom-[3px] -left-[3px] flex size-3 items-center justify-center rounded-full border-2 border-plane text-center text-[8.5px] font-bold leading-none text-white"
                      style={{ background: `var(${SEVERITY_VAR[n.issueSeverity]})`, boxShadow: `0 0 8px var(${SEVERITY_VAR[n.issueSeverity]})` }}
                    >
                      !
                    </span>
                  )}
                  {n.changed && (
                    <span
                      aria-hidden="true"
                      title="Changed since you last looked"
                      className="pointer-events-none absolute -inset-[5px] rounded-[12px] border-2"
                      style={{ borderColor: "var(--chg)", boxShadow: "0 0 9px color-mix(in srgb, var(--chg) 55%, transparent)" }}
                    />
                  )}
                </span>
                <span className="flex max-w-[140px] items-center gap-1">
                  {n.ordinal && (
                    <span
                      aria-hidden="true"
                      title={`Fires ${ordinalPhrase(n.ordinal)}`}
                      className="tabular flex-none rounded-full border border-line bg-pill px-[5px] py-px font-mono text-[9.5px] leading-[1.4] text-t3"
                    >
                      {n.ordinal}
                    </span>
                  )}
                  <span
                    className="truncate whitespace-nowrap rounded-full border bg-pill px-2 py-[3px] text-[11px] font-semibold leading-none text-t1"
                    style={{ borderColor: selected ? "var(--line-strong)" : "var(--line)" }}
                  >
                    {n.label}
                  </span>
                  {n.commentCount ? (
                    <span
                      aria-hidden="true"
                      title={`${n.commentCount} open comment thread${n.commentCount === 1 ? "" : "s"}`}
                      className="flex-none rounded-full border border-line bg-pill px-[5px] py-px font-mono text-[9.5px] leading-[1.4] text-t2"
                    >
                      💬 {n.commentCount}
                    </span>
                  ) : null}
                </span>
                <span
                  className="tabular max-w-[150px] truncate whitespace-nowrap font-mono text-[10px] leading-none"
                  style={{ color: n.runLine?.failing ? "var(--err-text)" : "var(--t3)" }}
                  title={n.runLine ? n.runLine.text : second}
                >
                  {n.runLine ? n.runLine.text : second}
                  {!n.runLine && n.hasFilter && <span className="text-warn-text"> · filtered</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* zoom cluster — sibling of the pan surface so clicks always land */}
      <div onPointerDown={(e) => e.stopPropagation()} className="absolute bottom-3 right-3 z-[2] flex items-center gap-1 anim-fade-in" style={{ animationDelay: ".3s" }}>
        <IconBtn icon={Minus} label="Zoom out (−)" size={26} onClick={() => zoomBy(0.83)} className="bg-glass backdrop-blur-[8px]" />
        <IconBtn icon={Plus} label="Zoom in (+)" size={26} onClick={() => zoomBy(1.2)} className="bg-glass backdrop-blur-[8px]" />
        <IconBtn icon={Maximize2} label="Fit to view (F)" size={26} onClick={fit} className="bg-glass backdrop-blur-[8px]" />
      </div>
    </div>
  );
}
