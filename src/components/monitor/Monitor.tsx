"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTheme } from "next-themes";
import {
  COS_TILT,
  EDGES,
  FEED_BAD,
  FEED_INITIAL,
  FEED_OK,
  JS_THEMES,
  NODES,
  PANEL,
  WORLD,
  type NodeStatus,
} from "./data";
import { MonitorHeader } from "./MonitorHeader";
import { WorkflowsRail, type FeedItem } from "./WorkflowsRail";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";
import { NodePuck } from "./NodePuck";
import { Pulses } from "./Pulses";
import { ZoomCluster } from "./ZoomCluster";
import { WorkflowChip } from "./WorkflowChip";

export interface MonitorProps {
  incident?: boolean;
  simSpeed?: number;
  clientView?: boolean;
}

export interface EdgeView {
  id: number;
  d: string;
  base: string;
  drift: string;
  halo: string;
  core: string;
  t0: number;
  t1: number;
}

const SQRT2 = 1.4142;

export function Monitor({
  incident = false,
  simSpeed = 1,
  clientView = false,
}: MonitorProps) {
  const [sel, setSel] = useState("sms");
  const [tab, setTab] = useState("output");
  const [paused, setPaused] = useState(false);
  const [tilt, setTilt] = useState(true);
  const [cam, setCam] = useState({ zoom: 0.5, panX: 380, panY: 240 });
  const [drag, setDrag] = useState(false);
  const [glide, setGlide] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pos, setPos] = useState<Record<string, { cx: number; cy: number }>>({});
  const [feed, setFeed] = useState<FeedItem[]>(() =>
    FEED_INITIAL.map((f, i) => ({ ...f, id: -i - 1 }))
  );
  const [opsTick, setOpsTick] = useState(0);
  const [errTick, setErrTick] = useState(0);
  const [wf, setWf] = useState(0);

  const vp = useRef<HTMLDivElement | null>(null);
  const panData = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const vel = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0, t: 0 });
  const raf = useRef(0);
  const nd = useRef<{
    id: string;
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    moved: boolean;
  } | null>(null);
  const feedIdx = useRef(0);
  const pausedRef = useRef(paused);
  const camRef = useRef(cam);
  const tiltRef = useRef(tilt);
  useEffect(() => {
    pausedRef.current = paused;
    camRef.current = cam;
    tiltRef.current = tilt;
  }, [paused, cam, tilt]);

  /* Theme comes from the app-wide next-themes provider (persisted, no-flash).
     Only the JS-side canvas colors need the resolved value. */
  const { resolvedTheme } = useTheme();
  const T = resolvedTheme === "dark" ? JS_THEMES.dark : JS_THEMES.light;

  /* ---------- geometry ---------- */

  const curPos = useCallback(
    (id: string) => {
      const o = pos[id];
      if (o) return o;
      const n = NODES.find((x) => x.id === id)!;
      return { cx: n.cx, cy: n.cy };
    },
    [pos]
  );

  const fit = useCallback(() => {
    const el = vp.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const P = PANEL;
    const aw = r.width - P.left - P.right;
    const ah = r.height - P.top - P.bottom;
    const isTilt = tiltRef.current;
    const pw = isTilt ? 1680 : WORLD.w;
    const ph = isTilt ? 990 : WORLD.h;
    const z = Math.min((aw - 30) / pw, (ah - 20) / ph);
    setGlide(false);
    setCam({
      zoom: z,
      panX: P.left + (aw - WORLD.w * z) / 2,
      panY: P.top + (ah - WORLD.h * z) / 2 - (isTilt ? 30 * z : 0),
    });
  }, []);

  const centerOn = useCallback(
    (id: string) => {
      const el = vp.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const P = PANEL;
      const p = curPos(id);
      const z = camRef.current.zoom;
      const dx = p.cx - WORLD.w / 2;
      const dy = p.cy - WORLD.h / 2;
      let wx: number, wy: number;
      if (tiltRef.current) {
        wx = WORLD.w / 2 + (dx - dy) / SQRT2;
        wy = WORLD.h / 2 + ((dx + dy) / SQRT2) * COS_TILT;
      } else {
        wx = p.cx;
        wy = p.cy;
      }
      const cx = P.left + (r.width - P.left - P.right) / 2;
      const cy = P.top + (r.height - P.top - P.bottom) / 2;
      setGlide(false);
      setCam((c) => ({ ...c, panX: cx - z * wx, panY: cy - z * wy }));
    },
    [curPos]
  );

  const zoomBy = useCallback((f: number, ax?: number, ay?: number) => {
    setCam((c) => {
      const z = Math.min(1.8, Math.max(0.25, c.zoom * f));
      const el = vp.current;
      if (!el) return { ...c, zoom: z };
      const r = el.getBoundingClientRect();
      const P = PANEL;
      const cx = ax ?? P.left + (r.width - P.left - P.right) / 2;
      const cy = ay ?? P.top + (r.height - P.top - P.bottom) / 2;
      return {
        zoom: z,
        panX: cx - ((cx - c.panX) * z) / c.zoom,
        panY: cy - ((cy - c.panY) * z) / c.zoom,
      };
    });
  }, []);

  /* Initial camera settle */
  useEffect(() => {
    const t = setTimeout(fit, 60);
    return () => clearTimeout(t);
  }, [fit]);

  /* Wheel: zoom toward cursor (non-passive so browser zoom/scroll never fires) */
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.08 : 0.92, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  /* Live feed simulation */
  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current) return;
      const pool = incident ? FEED_BAD : FEED_OK;
      feedIdx.current += 1;
      const entry = { ...pool[feedIdx.current % pool.length], id: feedIdx.current };
      setFeed((f) => [entry, ...f].slice(0, 8));
      setOpsTick((o) => o + 1 + Math.floor(Math.random() * 3));
      setErrTick(
        (e) =>
          e +
          ((incident && feedIdx.current % 2 === 0) || feedIdx.current % 9 === 0
            ? 1
            : 0)
      );
    }, 2400 / simSpeed);
    return () => clearInterval(id);
  }, [incident, simSpeed]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* ---------- pan / inertia ---------- */

  const panDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(raf.current);
    panData.current = {
      sx: e.clientX,
      sy: e.clientY,
      px: camRef.current.panX,
      py: camRef.current.panY,
    };
    vel.current = { x: 0, y: 0 };
    last.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    setDrag(true);
    setGlide(false);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const panMove = (e: React.PointerEvent) => {
    const d = panData.current;
    if (!d) return;
    const now = performance.now();
    const dt = Math.max(1, now - last.current.t);
    vel.current = {
      x: ((e.clientX - last.current.x) / dt) * 16,
      y: ((e.clientY - last.current.y) / dt) * 16,
    };
    last.current = { x: e.clientX, y: e.clientY, t: now };
    setCam((c) => ({
      ...c,
      panX: d.px + e.clientX - d.sx,
      panY: d.py + e.clientY - d.sy,
    }));
  };

  const panUp = () => {
    if (!panData.current) return;
    panData.current = null;
    setDrag(false);
    const v = { ...vel.current };
    if (Math.abs(v.x) + Math.abs(v.y) > 2) {
      setGlide(true);
      const step = () => {
        v.x *= 0.93;
        v.y *= 0.93;
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

  /* ---------- node drag / select ---------- */

  const nodeDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const p = curPos(id);
    nd.current = { id, sx: e.clientX, sy: e.clientY, cx: p.cx, cy: p.cy, moved: false };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const nodeMove = (e: React.PointerEvent) => {
    const d = nd.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      setDragId(d.id);
    }
    if (!d.moved) return;
    const z = camRef.current.zoom;
    let px: number, py: number;
    if (tiltRef.current) {
      const u = dx / z;
      const v = dy / (z * COS_TILT);
      px = (u + v) / SQRT2;
      py = (v - u) / SQRT2;
    } else {
      px = dx / z;
      py = dy / z;
    }
    const nx = Math.max(-1600, Math.min(3200, d.cx + px));
    const ny = Math.max(-1200, Math.min(2000, d.cy + py));
    setPos((p) => ({ ...p, [d.id]: { cx: nx, cy: ny } }));
  };

  const nodeUp = () => {
    const d = nd.current;
    nd.current = null;
    if (!d) return;
    if (!d.moved) {
      setSel(d.id);
      centerOn(d.id);
    }
    setDragId(null);
  };

  /* ---------- toggles ---------- */

  const toggle3d = () => {
    const next = !tiltRef.current;
    tiltRef.current = next;
    setTilt(next);
    setTimeout(fit, 20);
  };

  /* ---------- derived view models ---------- */

  const stOf = useCallback(
    (id: string, status: NodeStatus): NodeStatus =>
      id === "sms" && incident ? "err" : status,
    [incident]
  );

  const merged = useMemo(
    () => NODES.map((n) => ({ ...n, ...(pos[n.id] || {}) })),
    [pos]
  );

  const edges: EdgeView[] = useMemo(() => {
    const byId = Object.fromEntries(merged.map((n) => [n.id, n]));
    return EDGES.map((e) => {
      const a = byId[e.from];
      const b = byId[e.to];
      const flip = b.cx < a.cx ? -1 : 1;
      const sx = a.cx + 38 * flip;
      const sy = a.cy;
      const tx = b.cx - 38 * flip;
      const ty = b.cy;
      const dx = Math.max(48, Math.min(130, Math.abs(tx - sx) / 2)) * flip;
      const st = e.hot ? (incident ? "err" : "warn") : "ok";
      return {
        id: e.id,
        t0: e.t0,
        t1: e.t1,
        d: `M${sx} ${sy} C${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
        base:
          st === "ok"
            ? T.edgeBase
            : st === "warn"
              ? "rgba(245,158,11,.35)"
              : "rgba(239,68,68,.4)",
        drift: st === "ok" ? T.drift : st === "warn" ? "#f59e0b" : "#ef4444",
        halo: st === "ok" ? T.halo : st === "warn" ? "#f59e0b" : "#ef4444",
        core: st === "ok" ? T.core : st === "warn" ? "#fde68a" : "#fecaca",
      };
    });
  }, [merged, incident, T]);

  const selNode = merged.find((n) => n.id === sel) ?? merged[0];
  const errCount = (incident ? 47 : 12) + errTick;

  const worldTrans =
    drag || glide ? "transform 0s" : "transform .55s cubic-bezier(.22,1,.36,1)";
  const tiltT = tilt ? "rotateX(55deg) rotateZ(45deg)" : "none";
  /* The trailing translateZ lifts each billboard toward the camera so the
     tilted plane can't clip it (Chrome does true 3D intersection inside
     preserve-3d — without the lift, label pills sink below the surface). */
  const billT = tilt
    ? "rotateZ(-45deg) rotateX(-55deg) translateZ(110px)"
    : "none";

  return (
    <div
      className="grid h-dvh overflow-hidden bg-bg text-t1"
      style={{ gridTemplateRows: "54px 1fr" }}
    >
      <MonitorHeader
        incident={incident}
        clientView={clientView}
        ops={1284 + opsTick}
        errors={errCount}
        paused={paused}
      />

      <main
        id="main"
        tabIndex={-1}
        aria-label="Live workflow monitor"
        className="relative overflow-hidden"
      >
        <h1 className="sr-only">Orrit Monitor — Lead Capture → Nurture</h1>
        {/* ---------- canvas ---------- */}
        <div
          ref={vp}
          onPointerDown={panDown}
          onPointerMove={panMove}
          onPointerUp={panUp}
          className="absolute inset-0 overflow-hidden bg-vpbg"
          style={{
            cursor: drag ? "grabbing" : "grab",
            touchAction: "none",
            perspective: "1800px",
            perspectiveOrigin: "50% 38%",
          }}
        >
          {/* world */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: WORLD.w,
              height: WORLD.h,
              transform: `translate(${cam.panX}px, ${cam.panY}px) scale(${cam.zoom})`,
              transition: worldTrans,
              transformOrigin: "0 0",
              transformStyle: "preserve-3d",
            }}
          >
            {/* infinite dot-grid plane */}
            <div
              style={{
                position: "absolute",
                left: -3220,
                top: -2630,
                width: 8000,
                height: 6000,
                backgroundColor: "var(--plane)",
                backgroundImage:
                  "radial-gradient(var(--dot) 1.2px, transparent 1.6px)",
                backgroundSize: "24px 24px",
                transform: tiltT,
                transformOrigin: "4000px 3000px",
                transition: worldTrans,
                pointerEvents: "none",
              }}
            />
            {/* content layer (tilted with the plane) */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: tiltT,
                transformOrigin: `${WORLD.w / 2}px ${WORLD.h / 2}px`,
                transition: worldTrans,
                transformStyle: "preserve-3d",
              }}
            >
              <svg
                aria-hidden="true"
                width={WORLD.w}
                height={WORLD.h}
                className="pointer-events-none absolute inset-0"
                style={{ overflow: "visible" }}
              >
                {edges.map((e) => (
                  <g key={e.id}>
                    <path d={e.d} fill="none" stroke={e.base} strokeWidth={1.5} />
                    <path
                      d={e.d}
                      fill="none"
                      stroke={e.drift}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeDasharray="3 23"
                      style={{ animation: "ddrift 1.5s linear infinite" }}
                    />
                  </g>
                ))}
              </svg>

              <Pulses edges={edges} speed={simSpeed} paused={paused} />

              {merged.map((n, i) => (
                <NodePuck
                  key={n.id}
                  node={n}
                  index={i}
                  status={stOf(n.id, n.status)}
                  selected={sel === n.id}
                  dragging={dragId === n.id}
                  tilt={tilt}
                  billT={billT}
                  worldTrans={worldTrans}
                  ring={T.ring}
                  ambient={T.ambient}
                  onPointerDown={(e) => nodeDown(e, n.id)}
                  onPointerMove={nodeMove}
                  onPointerUp={nodeUp}
                  onActivate={() => {
                    setSel(n.id);
                    centerOn(n.id);
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <WorkflowsRail
          active={wf}
          incident={incident}
          feed={feed}
          sparkActive={T.sparkA}
          sparkIdle={T.spark}
          onSelect={setWf}
        />

        <WorkflowChip incident={incident} />

        <ZoomCluster
          tilt={tilt}
          paused={paused}
          onZoomIn={() => zoomBy(1.2)}
          onZoomOut={() => zoomBy(0.83)}
          onFit={fit}
          onToggle3d={toggle3d}
          onTogglePause={() => setPaused((p) => !p)}
        />

        <Inspector
          node={selNode}
          status={stOf(selNode.id, selNode.status)}
          incident={incident}
          clientView={clientView}
          tab={tab}
          onTab={setTab}
          ring={T.ring}
        />

        <Timeline incident={incident} errors={errCount} />
      </main>
    </div>
  );
}
