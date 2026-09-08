"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { geoOrthographic, geoPath, geoGraticule, geoDistance, select, drag, type D3DragEvent } from "d3";
import { useConnections, useWorkflowIndex } from "@/components/app/ConnectionsProvider";
import { appColor, appGlyph, appName } from "@/lib/apps";
import { workflowHref } from "@/lib/portals";
import { SoftwareLogo } from "@/components/shared/SoftwareLogo";

/*
 * The estate as a globe. Workflows sit on the surface of a sphere — each
 * platform is a region, its hub at the centre, its workflows spread evenly
 * around it — rendered through an orthographic projection so it reads as a
 * real globe: drag to spin it, scroll to zoom, the far side hidden and the
 * limb receding. Nodes are the same logo pucks as the canvas (crisp HTML, not
 * WebGL), the real cross-platform links are drawn as great-circle arcs, and
 * hover lights up a node's connections and expands its card. Still until you
 * touch it.
 */
type Node = {
  id: string; name: string; platform: string; color: string; isHub: boolean;
  href?: string; status?: string | null; degree: number; lon: number; lat: number;
};
type Link = { s: Node; t: Node; dead: boolean };

const PUCK = 30;
const HUB = 52;
const LABEL_W = 108;
const RAD = Math.PI / 180;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Point at angular distance `dist` from (lonC, latC) along `bearing` — radians in, degrees out. */
function destination(lonC: number, latC: number, dist: number, bearing: number): [number, number] {
  const lat = Math.asin(Math.sin(latC) * Math.cos(dist) + Math.cos(latC) * Math.sin(dist) * Math.cos(bearing));
  const lon = lonC + Math.atan2(Math.sin(bearing) * Math.sin(dist) * Math.cos(latC), Math.cos(dist) - Math.sin(latC) * Math.sin(lat));
  return [lon / RAD, lat / RAD];
}

export function SystemGlobe() {
  const all = useWorkflowIndex();
  const { linkMap } = useConnections();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rot, setRot] = useState<[number, number]>([0, -14]);
  const [k, setK] = useState(1);
  const kRef = useRef(k);
  useEffect(() => {
    kRef.current = k;
  }, [k]);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const { nodes, links, neighbors, legend } = useMemo(() => {
    const platforms = [...new Set(all.map((w) => w.provider))];
    const n = platforms.length;
    // one region per platform, spread across the front of the globe
    const centerLon = new Map<string, number>(platforms.map((p, i) => [p, n < 2 ? 0 : (i / (n - 1) - 0.5) * 112]));
    const nodes: Node[] = [];
    for (const p of platforms) {
      const wfs = all.filter((w) => w.provider === p);
      const lonC = (centerLon.get(p) ?? 0) * RAD;
      const cap = Math.min(52, Math.max(16, Math.sqrt(wfs.length) * 7)) * RAD;
      nodes.push({ id: `platform:${p}`, name: appName(p), platform: p, color: appColor(p), isHub: true, degree: 0, lon: lonC / RAD, lat: 0 });
      wfs.forEach((w, i) => {
        // sunflower spread inside the region's cap, kept clear of the hub
        const r = Math.max(cap * Math.sqrt((i + 0.75) / (wfs.length + 0.5)), 7 * RAD);
        const [lon, lat] = destination(lonC, 0, r, i * GOLDEN);
        nodes.push({
          id: `${w.provider}:${w.refId}`, name: w.name || "Untitled", platform: w.provider, color: appColor(w.provider),
          isHub: false, status: w.status, href: workflowHref({ source: w.provider, refId: w.refId }), degree: 0, lon, lat,
        });
      });
    }
    const byId = new Map(nodes.map((nd) => [nd.id, nd]));
    const links: Link[] = [];
    for (const l of linkMap?.links ?? []) {
      const s = byId.get(`${l.from.source}:${l.from.refId}`);
      const t = byId.get(`${l.to.source}:${l.to.refId}`);
      if (s && t && s !== t) {
        links.push({ s, t, dead: l.status === "dead" });
        s.degree++;
        t.degree++;
      }
    }
    const neighbors = new Map<string, Set<string>>(nodes.map((nd) => [nd.id, new Set([nd.id])]));
    for (const l of links) {
      neighbors.get(l.s.id)!.add(l.t.id);
      neighbors.get(l.t.id)!.add(l.s.id);
    }
    const legend = platforms.map((p) => ({ p, name: appName(p), color: appColor(p), count: all.filter((w) => w.provider === p).length }));
    return { nodes, links, neighbors, legend };
  }, [all, linkMap]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Drag spins the globe; the wheel zooms it. Finer when zoomed in.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const spin = drag<HTMLDivElement, unknown>().on("drag", (e: D3DragEvent<HTMLDivElement, unknown, unknown>) => {
      const s = 0.28 / kRef.current;
      setRot(([lam, phi]) => [lam + e.dx * s, Math.max(-72, Math.min(72, phi - e.dy * s))]);
    });
    select(el).call(spin);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setK((v) => Math.max(0.6, Math.min(3.2, v * Math.exp(-e.deltaY * 0.0015))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      select(el).on(".drag", null);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  const R = Math.min(size.w, size.h) * 0.42 * k;
  const { path, placed } = useMemo(() => {
    const proj = geoOrthographic().rotate(rot).scale(Math.max(R, 1)).translate([size.w / 2, size.h / 2]).clipAngle(90);
    const path = geoPath(proj);
    const center: [number, number] = [-rot[0], -rot[1]];
    const placed = nodes.map((nd) => {
      const dist = geoDistance([nd.lon, nd.lat], center);
      const p = proj([nd.lon, nd.lat]);
      return { nd, x: p?.[0] ?? 0, y: p?.[1] ?? 0, front: dist < Math.PI / 2, depth: Math.max(0, Math.cos(dist)) };
    });
    return { path, placed };
  }, [nodes, rot, R, size.w, size.h]);

  if (nodes.length === 0 || !size.w) return <div ref={wrapRef} className="h-full w-full bg-plane" />;

  const activeSet = hoverId ? neighbors.get(hoverId) : null;
  const hovered = hoverId ? placed.find((p) => p.nd.id === hoverId) : null;
  const graticule = path(geoGraticule().step([30, 30])()) ?? "";
  const sphere = path({ type: "Sphere" as const }) ?? "";

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full cursor-grab select-none overflow-hidden bg-plane active:cursor-grabbing"
      style={{ backgroundImage: "radial-gradient(var(--dot) 1.2px, transparent 1.6px)", backgroundSize: "24px 24px" }}
    >
      <svg className="absolute inset-0" width={size.w} height={size.h}>
        <defs>
          <radialGradient id="globe-shade" cx="38%" cy="32%" r="72%">
            <stop offset="0%" stopColor="var(--pill)" />
            <stop offset="70%" stopColor="var(--pill)" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--line-strong) 34%, var(--pill))" />
          </radialGradient>
        </defs>
        {/* the globe */}
        <path d={sphere} fill="url(#globe-shade)" stroke="var(--line-strong)" strokeWidth={1} style={{ filter: "drop-shadow(0 22px 34px var(--ambient))" }} />
        <path d={graticule} fill="none" stroke="var(--line)" strokeWidth={0.8} style={{ opacity: 0.9 }} />
        {/* real links, as great-circle arcs (clipped at the horizon) */}
        {links.map((l, i) => {
          const d = path({ type: "LineString" as const, coordinates: [[l.s.lon, l.s.lat], [l.t.lon, l.t.lat]] });
          if (!d) return null;
          const on = activeSet ? activeSet.has(l.s.id) && activeSet.has(l.t.id) : false;
          const dim = activeSet ? !on : false;
          return (
            <path key={i} d={d} fill="none"
              stroke={l.dead ? "var(--err)" : on ? "var(--text)" : "var(--line-strong)"}
              strokeWidth={on ? 2 : 1.4} strokeDasharray={l.dead ? "5 4" : undefined} strokeLinecap="round"
              style={{ opacity: dim ? 0.1 : l.dead ? 0.9 : 0.7, transition: "opacity .18s, stroke .18s" }} />
          );
        })}
      </svg>

      {/* workflow pucks on the surface — the far side stays hidden, the limb recedes */}
      {placed.map(({ nd, x, y, front, depth }) => {
        if (!front) return null;
        const base = nd.isHub ? HUB : PUCK;
        const sc = 0.55 + 0.45 * depth;
        const s = base * sc;
        const on = hoverId === nd.id;
        const dim = activeSet ? !activeSet.has(nd.id) : false;
        return (
          <button
            key={nd.id}
            type="button"
            aria-label={nd.href ? `Open ${nd.name}` : nd.name}
            tabIndex={nd.href ? 0 : -1}
            className="absolute flex appearance-none flex-col items-center gap-[5px] border-0 bg-transparent p-0 outline-none focus-visible:[&_.puck]:ring-2 focus-visible:[&_.puck]:ring-[var(--ringc)]"
            style={{ left: x - LABEL_W / 2, top: y - s / 2, width: LABEL_W, opacity: dim ? 0.25 : 0.3 + 0.7 * depth, transition: "opacity .18s", zIndex: on ? 4 : Math.round(depth * 3) }}
            onMouseEnter={() => setHoverId(nd.id)}
            onMouseLeave={() => setHoverId(null)}
            onClick={() => nd.href && router.push(nd.href)}
          >
            <span
              className="puck flex flex-none cursor-pointer items-center justify-center rounded-node border border-white/40 text-white transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]"
              style={{
                width: s, height: s,
                transform: on ? "scale(1.14) translateY(-2px)" : "scale(1)",
                background: `color-mix(in oklab, ${nd.color} 52%, #000)`,
                boxShadow: `${on ? "0 0 0 2.5px var(--ringc), " : ""}0 4px 0 color-mix(in oklab, ${nd.color} 40%, #000), 0 9px 18px var(--ambient)`,
              }}
            >
              <SoftwareLogo app={nd.platform} fallback={appGlyph(nd.platform)} size={Math.round(s * 0.5)} />
            </span>
            {(nd.isHub || depth > 0.35) && (
              <span className={`max-w-full truncate text-center leading-tight ${nd.isHub ? "text-[12.5px] font-semibold text-t1" : on ? "text-[10.5px] font-semibold text-t1" : "text-[10.5px] text-t2"}`}>
                {nd.name}
              </span>
            )}
            {nd.isHub && <span className="-mt-1 text-[10.5px] text-t3">{legend.find((l) => l.p === nd.platform)?.count} workflows</span>}
          </button>
        );
      })}

      {/* hover card */}
      {hovered && hovered.front && !hovered.nd.isHub && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full" style={{ left: hovered.x, top: hovered.y - (PUCK * (0.55 + 0.45 * hovered.depth)) / 2 - 14 }}>
          <div className="anim-pop-in min-w-[200px] rounded-card border border-line bg-panel px-3 py-2.5 shadow-[var(--shadow-float)] backdrop-blur-[10px]">
            <div className="flex items-center gap-2.5">
              <span className="flex size-7 flex-none items-center justify-center rounded-[7px] border border-white/40 text-white" style={{ background: `color-mix(in oklab, ${hovered.nd.color} 52%, #000)` }}>
                <SoftwareLogo app={hovered.nd.platform} fallback={appGlyph(hovered.nd.platform)} size={14} />
              </span>
              <span className="min-w-0">
                <span className="block max-w-[240px] truncate text-[13px] font-semibold text-t1">{hovered.nd.name}</span>
                <span className="block text-[11px] text-t3">
                  {appName(hovered.nd.platform)}
                  {hovered.nd.status ? ` · ${hovered.nd.status}` : ""}
                  {` · ${hovered.nd.degree} link${hovered.nd.degree !== 1 ? "s" : ""}`}
                </span>
              </span>
            </div>
            <div className="mt-1.5 text-[11px] font-medium text-t2">Open workflow →</div>
          </div>
        </div>
      )}

      {/* title + legend */}
      <div className="pointer-events-none absolute left-6 top-5 flex flex-col gap-3">
        <div>
          <div className="text-[15px] font-semibold text-t1">System map</div>
          <div className="text-[12px] text-t3">{all.length} workflows · {legend.length} platform{legend.length !== 1 ? "s" : ""}</div>
        </div>
        <div className="flex flex-col gap-1.5">
          {legend.map((l) => (
            <div key={l.p} className="flex items-center gap-2 text-[12px] text-t2">
              <span className="flex size-[18px] flex-none items-center justify-center rounded-[5px] border border-white/40 text-white" style={{ background: `color-mix(in oklab, ${l.color} 52%, #000)` }}>
                <SoftwareLogo app={l.p} fallback={appGlyph(l.p)} size={10} />
              </span>
              <span className="font-medium text-t1">{l.name}</span>
              <span className="text-t3">{l.count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 right-5 text-[11px] text-t3">Drag to spin · scroll to zoom · click to open</div>
    </div>
  );
}
