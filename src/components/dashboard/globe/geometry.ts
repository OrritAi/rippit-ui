/*
 * Pure globe math — no DOM, no React. The sphere is the unit sphere; nodes
 * are unit vectors; the camera is a Y rotation followed by an X tilt and an
 * orthographic drop of z. Everything the renderer and the hit-tester need is
 * here so it can be reasoned about (and tested) in isolation.
 */

export type Vec3 = [number, number, number];

export const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const D2R = Math.PI / 180;

export const TILT_MIN = -1.1;
export const TILT_MAX = 0.5;
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.9;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const easeOutCubic = (v: number) => 1 - Math.pow(1 - v, 3);

export function latLonToVec(latDeg: number, lonDeg: number): Vec3 {
  const la = latDeg * D2R;
  const lo = lonDeg * D2R;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Sunflower (Fibonacci) fill of a spherical cap: `n` points spread evenly
 * inside angular radius `spread` around `center`. Index `i` always lands in
 * the same place for the same `n`, so ordering the inputs stably keeps the
 * picture stable across refetches.
 */
export function capPoints(center: Vec3, spread: number, n: number): Vec3[] {
  const up: Vec3 = Math.abs(center[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = normalize(cross(up, center));
  const e2 = normalize(cross(center, e1));
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = spread * Math.sqrt((i + 0.5) / n);
    const th = i * GOLDEN;
    const s = Math.sin(a);
    const cA = Math.cos(a);
    const ct = Math.cos(th);
    const st = Math.sin(th);
    pts.push([
      center[0] * cA + (e1[0] * ct + e2[0] * st) * s,
      center[1] * cA + (e1[1] * ct + e2[1] * st) * s,
      center[2] * cA + (e1[2] * ct + e2[2] * st) * s,
    ]);
  }
  return pts;
}

/** Cap radius for `n` nodes — 56 → 1.0 rad, 29 → 0.72 rad (the handoff values). */
export function capSpread(n: number): number {
  return clamp(0.134 * Math.sqrt(Math.max(n, 1)), 0.35, 1.0);
}

const CAP_PRESETS: Record<string, { lat: number; lon: number }> = {
  ghl: { lat: 8, lon: -55 },
  make: { lat: 2, lon: 115 },
};

/** Where a platform's cap sits. Known platforms use the handoff positions;
 *  any further platform is spaced around the sphere between them. */
export function capCenter(provider: string, extraIndex: number): Vec3 {
  const preset = CAP_PRESETS[provider];
  if (preset) return latLonToVec(preset.lat, preset.lon);
  const lon = 30 + extraIndex * 97;
  const lat = extraIndex % 2 === 0 ? 12 : -12;
  return latLonToVec(lat, lon);
}

/** Rotate around Y by `rot`, tilt around X by `tilt`. z > 0 faces the viewer. */
export function project(v: Vec3, rot: number, tilt: number): Vec3 {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const x = v[0] * cr - v[2] * sr;
  const z0 = v[0] * sr + v[2] * cr;
  const y = v[1];
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return [x, y * ct - z0 * st, y * st + z0 * ct];
}

export function toScreen(p: Vec3, R: number, w: number, h: number): [number, number] {
  return [w / 2 + p[0] * R, h / 2 - p[1] * R];
}

export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const om = Math.acos(dot);
  const so = Math.sin(om);
  if (so < 1e-5) return a;
  const k0 = Math.sin((1 - t) * om) / so;
  const k1 = Math.sin(t * om) / so;
  return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
}

/** Point along the arc from A to B at `t`, lifted off the surface so the arc
 *  reads as a hop rather than a surface line. */
export function liftedArcPoint(A: Vec3, B: Vec3, t: number): Vec3 {
  const lift = 1 + 0.16 * Math.sin(Math.PI * t);
  const v = slerp(A, B, t);
  return [v[0] * lift, v[1] * lift, v[2] * lift];
}

export const ARC_SEGMENTS = 48;

function buildGraticule(): Vec3[][] {
  const lines: Vec3[][] = [];
  for (let lon = 0; lon < 180; lon += 30) {
    const pts: Vec3[] = [];
    for (let la = -90; la <= 90; la += 4) pts.push(latLonToVec(la, lon));
    for (let la = 90; la >= -90; la -= 4) pts.push(latLonToVec(la, lon + 180));
    lines.push(pts);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts: Vec3[] = [];
    for (let lo = 0; lo <= 360; lo += 4) pts.push(latLonToVec(lat, lo));
    lines.push(pts);
  }
  return lines;
}

/** Meridians every 30° (closed through the antimeridian) and parallels −60…60. */
export const GRATICULE: Vec3[][] = buildGraticule();

/** Globe radius in CSS px for a canvas of `w`×`h` at `zoom`. */
export function globeRadius(w: number, h: number, zoom: number): number {
  return (Math.min(w, h) / 2 - 44) * zoom;
}
