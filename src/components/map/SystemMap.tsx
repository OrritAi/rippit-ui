"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { Connection, GraphData, LinkMap, ModuleInfo, NodeId, WorkflowCard } from "@/app/lib/api";
import { CONNECTORS, isProviderId, providerColor } from "@/lib/connectors";
import { appColor } from "@/lib/apps";
import { SoftwareLogo } from "@/components/shared/SoftwareLogo";
import { workflowHref } from "@/lib/portals";
import { AppPuck } from "@/components/shared/AppPuck";
import { IconBtn } from "@/components/shell/IconBtn";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { computeLayout, edgePath, CROSS_KINDS } from "@/components/canvas/layout";
import { kindLabel } from "@/components/shared/AssetsSection";

/*
 * System map — the whole estate on one canvas.
 *  Workflows mode: one cluster per workflow (title · provider · status dot ·
 *    step chips), dashed warn/err edges for cross-links, dotted edges for
 *    shared assets. Clusters lay out by who-calls-whom (layered), components
 *    stacked. Hovering a cluster dims everything not linked to it.
 *  Nodes mode: the linkable set at node level — every step as a 22px mini
 *    node inside its workflow box, sequence edges inside, cross edges running
 *    from the exact source step to the exact target step.
 */

export const cardId = (w: { source: string; refId: string }) => `${w.source}:${w.refId}`;

const CLUSTER_W = 196;
const CLUSTER_H = 66;
const WF_SPACING = { colW: 300, rowH: 130, marginX: 150, marginY: 90, compGap: 60 };
const SM_SCALE = 0.52;
const MINI = 22;
const PULSE_CAP = 40;

type Mode = "workflows" | "nodes";

interface WfCluster {
  key: string;
  card: WorkflowCard;
  x: number;
  y: number;
  w: number;
  h: number;
  dead: boolean;
  sev: "err" | "warn" | null;
}

export function SystemMap({
  mode,
  linkMap,
  workflows,
  showAssets,
  graph,
  onZoomChange,
}: {
  mode: Mode;
  linkMap: LinkMap;
  /** Filtered workflow cards to show in Workflows mode. */
  workflows: WorkflowCard[];
  showAssets: boolean;
  /** Node-level data for Nodes mode (already fetched by the page). */
  graph: GraphData | null;
  onZoomChange?: (z: number) => void;
}) {
  const router = useRouter();
  const reduced = usePrefersReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const vp = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [drag, setDrag] = useState(false);
  const [settled, setSettled] = useState(false);
  const pan = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);

  /* ---------- workflows-mode layout ---------- */
  const wf = useMemo(() => {
    const ids = new Set(workflows.map(cardId));
    const modules: ModuleInfo[] = workflows.map((w) => ({
      id: cardId(w), module: "workflow", app: w.source, label: w.name, depth: 0, x: null, y: null, hasFilter: false, filterName: null, hasErrorHandler: false,
    }));
    const conns: Connection[] = linkMap.links
      .filter((l) => ids.has(cardId(l.from)) && ids.has(cardId(l.to)))
      .map((l) => ({ from: cardId(l.from), to: cardId(l.to), kind: l.kind, status: l.status }));
    const assetEdges: { a: string; b: string; label: string }[] = [];
    if (showAssets) {
      const seen = new Set<string>();
      for (const a of linkMap.assetLinks ?? []) {
        const members = a.workflows.map(cardId).filter((id) => ids.has(id));
        for (let i = 1; i < members.length; i++) {
          const key = `${members[i - 1]}|${members[i]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          assetEdges.push({ a: members[i - 1], b: members[i], label: a.label || kindLabel(a.kind) });
        }
      }
    }
    const layoutConns = [...conns, ...assetEdges.map((e) => ({ from: e.a, to: e.b, kind: "shared-asset" }))];
    const lay = computeLayout(modules, layoutConns, undefined, WF_SPACING);
    const clusters = new Map<string, WfCluster>();
    const deadOf = new Set<string>();
    const sevOf = new Map<string, "err" | "warn">();
    for (const l of linkMap.links) if (l.status === "dead") { deadOf.add(cardId(l.from)); deadOf.add(cardId(l.to)); }
    for (const w of workflows) {
      const ic = w.issueCounts;
      if (ic && ic.error > 0) sevOf.set(cardId(w), "err");
      else if ((ic && ic.warn > 0) || (w.changedSince?.count ?? 0) > 0) sevOf.set(cardId(w), "warn");
    }
    for (const w of workflows) {
      const p = lay.posOf.get(cardId(w));
      if (!p) continue;
      clusters.set(cardId(w), { key: cardId(w), card: w, x: p.cx - CLUSTER_W / 2, y: p.cy - CLUSTER_H / 2, w: CLUSTER_W, h: CLUSTER_H, dead: deadOf.has(cardId(w)), sev: sevOf.get(cardId(w)) ?? null });
    }
    const center = (k: string) => {
      const c = clusters.get(k)!;
      return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
    };
    const edges = conns.map((c, i) => ({ key: `e${i}`, a: String(c.from), b: String(c.to), dead: c.status === "dead", d: edgePath(center(String(c.from)).x, center(String(c.from)).y, center(String(c.to)).x, center(String(c.to)).y), asset: false as const, label: undefined as string | undefined }));
    const aEdges = assetEdges.map((e, i) => ({ key: `a${i}`, a: e.a, b: e.b, dead: false, d: edgePath(center(e.a).x, center(e.a).y, center(e.b).x, center(e.b).y), asset: true as const, label: e.label }));
    return { clusters: [...clusters.values()], edges: [...edges, ...aEdges], w: lay.w + CLUSTER_W, h: lay.h + CLUSTER_H, adj: buildAdj([...edges, ...aEdges]) };
  }, [workflows, linkMap, showAssets]);

  /* ---------- nodes-mode layout ---------- */
  const nd = useMemo(() => {
    if (!graph) return null;
    const lay = computeLayout(graph.nodes, graph.connections, graph.groups);
    const pos = new Map<NodeId, { x: number; y: number }>();
    for (const [id, p] of lay.posOf) pos.set(id, { x: p.cx * SM_SCALE, y: p.cy * SM_SCALE });
    const boxes = lay.groupBoxes.map((g) => ({ ...g, x: g.x * SM_SCALE, y: g.y * SM_SCALE, w: g.w * SM_SCALE, h: g.h * SM_SCALE, group: graph.groups.find((x) => x.id === g.id)! }));
    const groupOf = (id: NodeId) => graph.groups.find((g) => String(id).startsWith(`${g.id}:`))?.id ?? "";
    const internal: { key: string; d: string; g: string }[] = [];
    const cross: { key: string; d: string; a: string; b: string; dead: boolean }[] = [];
    graph.connections.forEach((c, i) => {
      const p1 = pos.get(c.from);
      const p2 = pos.get(c.to);
      if (!p1 || !p2) return;
      const d = edgePath(p1.x, p1.y, p2.x, p2.y);
      if (CROSS_KINDS.has(c.kind ?? "")) cross.push({ key: `x${i}`, d, a: groupOf(c.from), b: groupOf(c.to), dead: c.status === "dead" });
      else if (c.kind !== "shared-asset") internal.push({ key: `i${i}`, d, g: groupOf(c.from) });
    });
    const nodes = graph.nodes.filter((n) => n.kind !== "portal").map((n) => ({ n, p: pos.get(n.id)!, g: groupOf(n.id) })).filter((x) => x.p);
    return { boxes, internal, cross, nodes, w: lay.w * SM_SCALE + 40, h: lay.h * SM_SCALE + 40, adj: buildAdj(cross.map((c) => ({ a: c.a, b: c.b }))) };
  }, [graph]);

  const world = mode === "workflows" ? { w: wf.w, h: wf.h } : { w: nd?.w ?? 800, h: nd?.h ?? 500 };

  /* ---------- camera ---------- */
  const fit = useCallback(() => {
    const el = vp.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const z = Math.max(0.3, Math.min(1, (r.width - 40) / world.w, (r.height - 60) / world.h));
    setCam({ zoom: z, panX: Math.max(20, (r.width - world.w * z) / 2), panY: Math.max(30, (r.height - world.h * z) / 2) });
  }, [world.w, world.h]);
  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    let f = 0;
    const run = () => {
      cancelAnimationFrame(f);
      f = requestAnimationFrame(() => {
        fitRef.current();
        setSettled(true);
      });
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(f);
    };
  }, [mode, world.w, world.h]);
  useEffect(() => onZoomChange?.(cam.zoom), [cam.zoom, onZoomChange]);

  const zoomBy = useCallback((f: number, ax?: number, ay?: number) => {
    setCam((c) => {
      const z = Math.min(1.6, Math.max(0.25, c.zoom * f));
      const el = vp.current;
      if (!el) return { ...c, zoom: z };
      const r = el.getBoundingClientRect();
      const cx = ax ?? r.width / 2;
      const cy = ay ?? r.height / 2;
      return { zoom: z, panX: cx - ((cx - c.panX) * z) / c.zoom, panY: cy - ((cy - c.panY) * z) / c.zoom };
    });
  }, []);
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomBy(e.deltaY < 0 ? 1.08 : 0.92, e.clientX - r.left, e.clientY - r.top);
      } else setCam((c) => ({ ...c, panX: c.panX - e.deltaX, panY: c.panY - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pan.current = { sx: e.clientX, sy: e.clientY, px: cam.panX, py: cam.panY, moved: false };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };
  const onMove = (e: React.PointerEvent) => {
    const d = pan.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      setDrag(true);
    }
    setCam((c) => ({ ...c, panX: d.px + e.clientX - d.sx, panY: d.py + e.clientY - d.sy }));
  };
  const onUp = () => {
    const d = pan.current;
    pan.current = null;
    setDrag(false);
    return d?.moved ?? false;
  };
  const clickGuard = useRef(false);
  const handleUp = () => {
    clickGuard.current = onUp();
  };
  const go = (href: string) => {
    if (clickGuard.current) return;
    router.push(href);
  };

  const linkedTo = (key: string) => hover === key || (hover != null && (mode === "workflows" ? wf.adj : nd?.adj)?.get(hover)?.has(key));
  const edgeHot = (a: string, b: string) => !hover || a === hover || b === hover;
  const pulses = !reduced && settled;

  return (
    <div
      ref={vp}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      role="group"
      aria-label={mode === "workflows" ? "System map, workflows mode. Click a workflow to open its canvas." : "System map, nodes mode. Click a step to open it in its canvas."}
      className="absolute inset-0 overflow-hidden bg-plane outline-none"
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
          width: world.w,
          height: world.h,
          transform: `translate(${cam.panX}px, ${cam.panY}px) scale(${cam.zoom})`,
          transformOrigin: "0 0",
          transition: drag ? "transform 0s" : "transform .35s var(--ease-out)",
          willChange: "transform",
        }}
      >
        {mode === "workflows" ? (
          <>
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ overflow: "visible" }} width={1} height={1}>
              {wf.edges.map((e) => {
                const hot = edgeHot(e.a, e.b);
                return (
                  <g key={e.key} style={{ opacity: hot ? 1 : 0.18, transition: "opacity .15s" }}>
                    <path
                      d={e.d}
                      fill="none"
                      stroke={e.asset ? "var(--t3)" : e.dead ? "var(--err)" : "var(--warn)"}
                      strokeWidth={hover && hot ? 2.2 : 1.6}
                      strokeDasharray={e.asset ? "2 5" : "7 6"}
                      opacity={e.asset ? 0.7 : 0.85}
                      className={!e.asset && !reduced ? "edge-drift" : undefined}
                    />
                  </g>
                );
              })}
              {pulses &&
                wf.edges
                  .filter((e) => !e.asset && !e.dead)
                  .slice(0, PULSE_CAP)
                  .map((e, i) => (
                    <circle key={`p${e.key}`} r={2.6} fill="var(--t1)" opacity={0.9}>
                      <animateMotion dur="3s" repeatCount="indefinite" begin={`${(i * 0.2).toFixed(2)}s`} path={e.d} />
                    </circle>
                  ))}
            </svg>
            {wf.clusters.map((c, i) => {
              const conn = CONNECTORS[c.card.source];
              const dim = hover && !linkedTo(c.key);
              const tone = c.card.status === "paused" ? "var(--warn)" : c.card.isActive ? "var(--ok)" : "var(--off)";
              const steps = Math.min(c.card.stepCount ?? 0, 24);
              return (
                <div
                  key={c.key}
                  className="absolute"
                  style={{ left: c.x, top: c.y, width: c.w, height: c.h, opacity: dim ? 0.35 : 1, transition: "opacity .15s", animation: settled && !reduced ? `fadeUp .45s var(--ease-out) ${Math.min(i, 20) * 0.04}s both` : undefined }}
                >
                  <button
                    type="button"
                    onClick={() => go(workflowHref(c.card))}
                    onMouseEnter={() => setHover(c.key)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(c.key)}
                    onBlur={() => setHover(null)}
                    title={`Open ${c.card.name}`}
                    className="absolute bottom-full left-0 mb-[5px] flex max-w-[260px] cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left"
                  >
                    <AppPuck app={conn.id} color={conn.brandColor} size={16} />
                    <span className="min-w-0 [overflow-wrap:anywhere] text-[12px] font-bold text-t1">{c.card.name}</span>
                    <span className="tabular flex-none font-mono text-[9px] text-t3">{conn.shortLabel}</span>
                    <span aria-hidden="true" className="size-[5px] flex-none rounded-full" style={{ background: tone }} />
                    {c.sev && <span aria-hidden="true" className="size-[5px] flex-none rounded-full" style={{ background: c.sev === "err" ? "var(--err)" : "var(--warn)", boxShadow: `0 0 5px ${c.sev === "err" ? "var(--err)" : "var(--warn)"}` }} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => go(workflowHref(c.card))}
                    onMouseEnter={() => setHover(c.key)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(c.key)}
                    onBlur={() => setHover(null)}
                    aria-label={`Open ${c.card.name}`}
                    className="absolute inset-0 cursor-pointer rounded-[10px] border text-left transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
                    style={{
                      borderColor: c.dead ? "color-mix(in srgb, var(--err) 45%, var(--line))" : hover === c.key ? "var(--line-strong)" : "var(--line)",
                      background: "color-mix(in srgb, var(--panel) 70%, transparent)",
                      boxShadow: hover === c.key ? "var(--shadow-float)" : "var(--shadow-card)",
                    }}
                  >
                    <span className="absolute inset-0 flex flex-wrap items-center justify-center gap-1 px-3.5">
                      {Array.from({ length: steps }).map((_, k) => (
                        <span key={k} className="size-[9px] rounded-[3px] border border-white/25" style={{ background: `color-mix(in oklab, ${providerColor(c.card.source)} 52%, #000)` }} />
                      ))}
                      {(c.card.stepCount ?? 0) > 24 && <span className="font-mono text-[9px] text-t3">+{(c.card.stepCount ?? 0) - 24}</span>}
                      {(c.card.stepCount ?? 0) === 0 && <span className="font-mono text-[9px] text-t3">no steps</span>}
                    </span>
                  </button>
                </div>
              );
            })}
          </>
        ) : nd ? (
          <>
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ overflow: "visible" }} width={1} height={1}>
              {nd.internal.map((e) => (
                <path key={e.key} d={e.d} fill="none" stroke="var(--edge)" strokeWidth={1} style={{ opacity: hover && hover !== e.g ? 0.25 : 1, transition: "opacity .15s" }} />
              ))}
              {nd.cross.map((e) => {
                const hot = edgeHot(e.a, e.b);
                return (
                  <g key={e.key} style={{ opacity: hot ? 1 : 0.18, transition: "opacity .15s" }}>
                    <path d={e.d} fill="none" stroke={e.dead ? "var(--err)" : "var(--warn)"} strokeWidth={hover && hot ? 2.2 : 1.6} strokeDasharray="7 6" opacity={0.9} className={!reduced ? "edge-drift" : undefined} />
                    {pulses && !e.dead && (
                      <circle r={2.4} fill="var(--t1)" opacity={0.9}>
                        <animateMotion dur="2.6s" repeatCount="indefinite" path={e.d} />
                      </circle>
                    )}
                  </g>
                );
              })}
            </svg>
            {nd.boxes.map((b, i) => {
              const conn = CONNECTORS[b.source];
              const dim = hover && !linkedTo(b.id);
              const card = linkMap.workflows.find((w) => cardId(w) === b.id);
              return (
                <div
                  key={b.id}
                  className="absolute"
                  style={{ left: b.x, top: b.y, width: b.w, height: b.h, opacity: dim ? 0.35 : 1, transition: "opacity .15s", animation: settled && !reduced ? `fadeUp .45s var(--ease-out) ${Math.min(i, 20) * 0.06}s both` : undefined }}
                >
                  <button type="button" onClick={() => go(workflowHref(b.group))} onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(b.id)} onBlur={() => setHover(null)} title={`Open ${b.name}`} className="absolute bottom-full left-0 mb-[5px] flex max-w-[260px] cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left">
                    <AppPuck app={conn.id} color={conn.brandColor} size={16} />
                    <span className="min-w-0 [overflow-wrap:anywhere] text-[12px] font-bold text-t1">{b.name}</span>
                    <span className="tabular flex-none font-mono text-[9px] text-t3">{conn.shortLabel}</span>
                    {card && <span aria-hidden="true" className="size-[5px] flex-none rounded-full" style={{ background: card.status === "paused" ? "var(--warn)" : card.isActive ? "var(--ok)" : "var(--off)" }} />}
                  </button>
                  <div
                    aria-hidden="true"
                    onMouseEnter={() => setHover(b.id)}
                    onMouseLeave={() => setHover(null)}
                    className="absolute inset-0 rounded-[10px] border transition-[border-color,box-shadow] duration-[var(--dur-fast)]"
                    style={{
                      borderColor: hover === b.id ? "var(--line-strong)" : "var(--line)",
                      background: "color-mix(in srgb, var(--panel) 70%, transparent)",
                      boxShadow: hover === b.id ? "var(--shadow-float)" : "var(--shadow-card)",
                    }}
                  />
                </div>
              );
            })}
            {nd.nodes.map(({ n, p, g }) => {
              const dim = hover && !linkedTo(g);
              const col = appColor(n.app || n.module);
              const parts = String(n.id).split(":");
              const source = parts[0];
              const refId = parts[1];
              const node = parts.slice(2).join(":");
              return (
                <button
                  key={String(n.id)}
                  type="button"
                  title={`${n.ordinal ? `${n.ordinal} · ` : ""}${n.label} — open in canvas`}
                  aria-label={`${n.label}, open in canvas`}
                  onClick={() => isProviderId(source) && go(`${workflowHref({ source, refId })}?step=${encodeURIComponent(node)}`)}
                  onMouseEnter={() => setHover(g)}
                  onMouseLeave={() => setHover(null)}
                  className="absolute flex cursor-pointer items-center justify-center rounded-[6px] border border-white/35 p-0 font-mono text-[8px] font-extrabold text-white transition-transform duration-[120ms] ease-[var(--ease-out)] hover:scale-[1.35] focus-visible:scale-[1.35]"
                  style={{
                    left: p.x - MINI / 2,
                    top: p.y - MINI / 2,
                    width: MINI,
                    height: MINI,
                    background: `color-mix(in oklab, ${col} 52%, #000)`,
                    boxShadow: `0 2px 0 color-mix(in oklab, ${col} 40%, #000)`,
                    opacity: dim ? 0.35 : 1,
                    // 28px hit area around a 22px node
                    outlineOffset: 3,
                  }}
                >
                  <SoftwareLogo app={n.app || n.module} size={13} />
                </button>
              );
            })}
          </>
        ) : null}
      </div>

      {/* inline legend + zoom cluster */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[2] flex flex-wrap items-center gap-3.5 font-mono text-[10.5px] text-t3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: "var(--warn)" }} />
          cross-system link
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: "var(--err)" }} />
          dead link
        </span>
        {mode === "workflows" && showAssets && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-5 border-t-2 border-dotted" style={{ borderColor: "var(--t3)" }} />
            shared asset
          </span>
        )}
        <span>{mode === "nodes" ? "edges run step → step across systems" : "click a title to open its canvas"}</span>
        <span>zoom {Math.round(cam.zoom * 100)}%</span>
      </div>
      <div onPointerDown={(e) => e.stopPropagation()} className="absolute bottom-3 right-3 z-[2] flex items-center gap-1">
        <IconBtn icon={Minus} label="Zoom out" size={26} onClick={() => zoomBy(0.85)} className="bg-glass backdrop-blur-[8px]" />
        <IconBtn icon={Plus} label="Zoom in" size={26} onClick={() => zoomBy(1.18)} className="bg-glass backdrop-blur-[8px]" />
        <IconBtn icon={Maximize2} label="Fit" size={26} onClick={fit} className="bg-glass backdrop-blur-[8px]" />
      </div>
      {mode === "nodes" && graph && (
        <div className="pointer-events-none absolute left-3 top-3 z-[2] flex max-w-[70%] flex-wrap items-center gap-1.5">
          {graph.groups.map((g) => (
            <Link key={g.id} href={workflowHref(g)} className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-glass px-2.5 py-1 text-[11px] font-semibold text-t2 backdrop-blur-[8px] hover:text-t1">
              <span aria-hidden="true" className="size-[7px] rounded-[2px]" style={{ background: providerColor(g.source) }} />
              <span className="max-w-[160px] text-left [overflow-wrap:anywhere]">{g.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function buildAdj(edges: { a: string; b: string }[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!m.has(e.a)) m.set(e.a, new Set());
    if (!m.has(e.b)) m.set(e.b, new Set());
    m.get(e.a)!.add(e.b);
    m.get(e.b)!.add(e.a);
  }
  return m;
}
