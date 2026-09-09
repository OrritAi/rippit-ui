import { ARC_SEGMENTS, GRATICULE, globeRadius, liftedArcPoint, project, toScreen } from "./geometry";
import { arcReveal, captionAlpha, gridAlpha, nodeIn, pulsesOn, ringProgress } from "./intro";
import type { GlobeModel } from "./model";
import { drawMarker, platformColor, type CanvasPalette } from "./palette";

/*
 * One frame of the globe. Pure in the sense that it only reads `Frame` and
 * writes to `ctx`; the hit-test buffers it returns are what the pointer
 * handlers pick against on the next event. Order matters: back ghosts, arcs,
 * pulses, front nodes (with labels), captions — later passes paint over
 * earlier ones.
 */
export interface Frame {
  model: GlobeModel;
  P: CanvasPalette;
  w: number;
  h: number;
  rot: number;
  tilt: number;
  zoom: number;
  /** Seconds, for ambient motion (dash drift, pulses, halos). */
  time: number;
  /** Seconds since the intro started, or INTRO_DONE. */
  el: number;
  reduced: boolean;
  filter: string | null;
  hoverIdx: number;
  selNode: number;
  selArc: number;
  /** Resolved mono font family list for ctx.font. */
  fontMono: string;
}

export interface HitPoint {
  x: number;
  y: number;
  i: number;
}

export interface Hits {
  nodes: HitPoint[];
  arcs: HitPoint[];
}

const EMPTY_HITS: Hits = { nodes: [], arcs: [] };

export function drawGlobe(ctx: CanvasRenderingContext2D, f: Frame): Hits {
  const { model, P, w, h, rot, tilt, time, el, reduced, filter } = f;
  if (!w || !h) return EMPTY_HITS;
  const R = globeRadius(w, h, f.zoom);
  const cx = w / 2;
  const cy = h / 2;
  ctx.clearRect(0, 0, w, h);

  // Sphere outline — draws itself as a growing arc during the intro.
  const ringP = ringProgress(el);
  if (ringP <= 0) return EMPTY_HITS;
  ctx.beginPath();
  ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ringP);
  if (ringP >= 1) {
    ctx.fillStyle = P.fill;
    ctx.fill();
  }
  ctx.strokeStyle = P.stroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Graticule
  const ga = gridAlpha(el);
  if (ga <= 0) return EMPTY_HITS;
  ctx.globalAlpha = ga;
  ctx.strokeStyle = P.grid;
  for (const line of GRATICULE) {
    let open = false;
    ctx.beginPath();
    for (const v of line) {
      const p = project(v, rot, tilt);
      if (p[2] > 0) {
        const [sx, sy] = toScreen(p, R, w, h);
        if (!open) {
          ctx.moveTo(sx, sy);
          open = true;
        } else ctx.lineTo(sx, sy);
      } else open = false;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const nodes = model.nodes;
  const dimmed = (i: number) => filter !== null && nodes[i].provider !== filter;
  const projected = nodes.map((n) => project(n.v, rot, tilt));

  // Back-hemisphere ghosts
  ctx.globalAlpha = 0.2;
  projected.forEach((p, i) => {
    if (dimmed(i) || p[2] > 0) return;
    const ni = nodeIn(el, i);
    if (ni <= 0) return;
    const [sx, sy] = toScreen(p, R, w, h);
    ctx.fillStyle = platformColor(P, nodes[i].provider);
    drawMarker(ctx, sx, sy, 2.6 * ni, model.shapes[nodes[i].provider] ?? "circle");
  });
  ctx.globalAlpha = 1;

  // Arcs
  const arcHits: HitPoint[] = [];
  ctx.setLineDash([3, 5]);
  model.arcs.forEach((arc, ai) => {
    const reveal = arcReveal(el, ai);
    if (reveal <= 0) return;
    const A = nodes[arc.a].v;
    const B = nodes[arc.b].v;
    const bothDim = dimmed(arc.a) && dimmed(arc.b);
    const selected = ai === f.selArc;
    ctx.globalAlpha = bothDim ? 0.12 : arc.dead ? 0.75 : 1;
    ctx.strokeStyle = selected ? P.ring : arc.dead ? P.err : P.arc;
    ctx.lineWidth = selected ? 1.5 : 1;
    // Dead links do not drift: nothing is travelling along them.
    ctx.lineDashOffset = reduced || arc.dead ? 0 : -time * 14;
    let open = false;
    ctx.beginPath();
    const maxS = Math.round(ARC_SEGMENTS * reveal);
    for (let s = 0; s <= maxS; s++) {
      const t = s / ARC_SEGMENTS;
      const p = project(liftedArcPoint(A, B, t), rot, tilt);
      if (p[2] > -0.08) {
        const [sx, sy] = toScreen(p, R, w, h);
        if (s % 3 === 0 && !bothDim) arcHits.push({ x: sx, y: sy, i: ai });
        if (!open) {
          ctx.moveTo(sx, sy);
          open = true;
        } else ctx.lineTo(sx, sy);
      } else open = false;
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // Run pulses — one bright dot travelling each live arc
  if (pulsesOn(el)) {
    for (const arc of model.arcs) {
      if (arc.dead || (dimmed(arc.a) && dimmed(arc.b))) continue;
      const u = reduced ? 0.5 : (time * 0.16 + arc.phase) % 1;
      const p = project(liftedArcPoint(nodes[arc.a].v, nodes[arc.b].v, u), rot, tilt);
      if (p[2] > -0.08) {
        const [sx, sy] = toScreen(p, R, w, h);
        ctx.beginPath();
        ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = P.pulse;
        ctx.shadowColor = P.pulse;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  // Front nodes
  const nodeHits: HitPoint[] = [];
  const labelBoxes: { x: number; y: number; w: number; h: number }[] = [];
  ctx.font = `11px ${f.fontMono}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  projected.forEach((p, i) => {
    if (p[2] <= 0) return;
    const ni = nodeIn(el, i);
    if (ni <= 0) return;
    const n = nodes[i];
    const shape = model.shapes[n.provider] ?? "circle";
    const [sx, sy] = toScreen(p, R, w, h);
    if (dimmed(i)) {
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = platformColor(P, n.provider);
      drawMarker(ctx, sx, sy, 2.6, shape);
      ctx.globalAlpha = 1;
      return;
    }
    nodeHits.push({ x: sx, y: sy, i });
    const incident = n.status === "err" || n.status === "warn";
    const r = ((model.hubs.has(i) ? 4.4 : 3.4) + (incident ? 1.4 : 0)) * (0.85 + 0.35 * p[2]) * ni;
    if (incident) {
      const sc = n.status === "err" ? P.err : P.warn;
      const halo = reduced ? 8 : 7.5 + 2 * Math.sin(time * 4 + i);
      ctx.beginPath();
      ctx.arc(sx, sy, halo, 0, Math.PI * 2);
      ctx.strokeStyle = sc;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowColor = sc;
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = n.status === "off" ? P.off : platformColor(P, n.provider);
    drawMarker(ctx, sx, sy, r, shape);
    ctx.shadowBlur = 0;
    if (i === f.hoverIdx || i === f.selNode) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = P.ring;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    // Labels on-globe: incidents only, front-facing, collision-culled.
    if (model.labeled.has(i) && p[2] > 0.4 && i !== f.hoverIdx) {
      const text = n.name.length > 26 ? n.name.slice(0, 25) + "…" : n.name;
      const tw = ctx.measureText(text).width;
      const bx = sx + 9;
      const by = sy - 8;
      const box = { x: bx, y: by - 10, w: tw, h: 14 };
      const clash = labelBoxes.some(
        (b) => !(box.x > b.x + b.w || box.x + box.w < b.x || box.y > b.y + b.h || box.y + box.h < b.y),
      );
      if (!clash) {
        labelBoxes.push(box);
        ctx.fillStyle = n.status === "err" ? P.err : n.status === "warn" ? P.warn : P.label;
        ctx.fillText(text, bx, by);
      }
    }
  });

  // Cluster captions
  const ca = captionAlpha(el);
  if (ca > 0) {
    ctx.font = `11.5px ${f.fontMono}`;
    ctx.fillStyle = P.label;
    ctx.textAlign = "center";
    ctx.globalAlpha = ca;
    for (const c of model.clusters) {
      const p = project([c.v[0] * 1.24, c.v[1] * 1.24, c.v[2] * 1.24], rot, tilt);
      if (p[2] > 0.25) {
        const [sx, sy] = toScreen(p, R, w, h);
        ctx.fillText(c.label, sx, sy);
      }
    }
    ctx.globalAlpha = 1;
  }

  return { nodes: nodeHits, arcs: arcHits };
}
