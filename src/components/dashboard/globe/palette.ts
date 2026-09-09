import { isProviderId, providerColor } from "@/lib/connectors";

/*
 * Canvas colours, resolved once per theme. A 2D canvas cannot read CSS custom
 * properties per frame, so the handoff gives literal values: the platform
 * brand colours are contrast-boosted variants that keep ≥3:1 against the page
 * background in each theme (guarded by scripts/contrast-audit.mjs).
 */
export interface CanvasPalette {
  stroke: string;
  grid: string;
  fill: string;
  arc: string;
  ghl: string;
  make: string;
  ok: string;
  warn: string;
  err: string;
  off: string;
  label: string;
  pulse: string;
  ring: string;
}

export const CANVAS_PALETTES: Record<"dark" | "light", CanvasPalette> = {
  dark: {
    stroke: "rgba(255,255,255,.14)",
    grid: "rgba(255,255,255,.05)",
    fill: "rgba(255,255,255,.015)",
    arc: "rgba(255,255,255,.32)",
    ghl: "#4cc3fa",
    make: "#cf9bfc",
    ok: "#22c55e",
    warn: "#f59e0b",
    err: "#ef4444",
    off: "#8b8b94",
    label: "#c5c5cc",
    pulse: "rgba(255,255,255,.9)",
    ring: "#f4f4f5",
  },
  light: {
    stroke: "rgba(0,0,0,.16)",
    grid: "rgba(0,0,0,.06)",
    fill: "rgba(0,0,0,.02)",
    arc: "rgba(0,0,0,.38)",
    ghl: "#0369a1",
    make: "#7e22ce",
    ok: "#16a34a",
    warn: "#b45309",
    err: "#dc2626",
    off: "#6b6b74",
    label: "#3f3f46",
    pulse: "rgba(0,0,0,.65)",
    ring: "#18181b",
  },
};

export function paletteFor(resolvedTheme: string | undefined): CanvasPalette {
  return resolvedTheme === "dark" ? CANVAS_PALETTES.dark : CANVAS_PALETTES.light;
}

export function platformColor(P: CanvasPalette, provider: string): string {
  if (provider === "ghl") return P.ghl;
  if (provider === "make") return P.make;
  return isProviderId(provider) ? providerColor(provider) : P.label;
}

/** Colour-independent platform coding: each platform gets its own marker. */
export type MarkerShape = "circle" | "diamond" | "triangle" | "square";

const EXTRA_SHAPES: MarkerShape[] = ["triangle", "square"];

export function markerShape(provider: string, extraIndex: number): MarkerShape {
  if (provider === "ghl") return "circle";
  if (provider === "make") return "diamond";
  return EXTRA_SHAPES[extraIndex % EXTRA_SHAPES.length];
}

export function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, shape: MarkerShape) {
  ctx.beginPath();
  if (shape === "diamond") {
    const d = r * 1.25;
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d, y);
    ctx.closePath();
  } else if (shape === "triangle") {
    const d = r * 1.3;
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d * 0.9, y + d * 0.6);
    ctx.lineTo(x - d * 0.9, y + d * 0.6);
    ctx.closePath();
  } else if (shape === "square") {
    ctx.rect(x - r, y - r, r * 2, r * 2);
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
}
