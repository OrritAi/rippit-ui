/*
 * App identity — puck colors, glyphs, and display names for Make.com apps.
 * Per the design handoff, app pucks are the only chrome allowed to carry
 * color (besides status); everything else stays monochrome.
 */

const APP_COLORS: [RegExp, string][] = [
  [/^make$/i, "#a855f7"],
  [/gateway|webhook|hook/i, "#3b82f6"],
  [/router|flow|builtin/i, "#64748b"],
  [/openai|gpt|\bai\b|anthropic|claude/i, "#14b8a6"],
  [/slack/i, "#d946ef"],
  [/sheet|google/i, "#22c55e"],
  [/highlevel|ghl/i, "#0ea5e9"],
  [/clickfunnels/i, "#e8552f"],
  [/close/i, "#4f46e5"],
  [/jotform|typeform|form/i, "#f59e0b"],
  [/http|api|json/i, "#f97316"],
  [/util|tools|text/i, "#8b5cf6"],
  [/stripe|payment/i, "#635bff"],
];

const FALLBACK_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#f59e0b",
  "#d946ef",
  "#64748b",
];

export function appColor(app: string): string {
  for (const [re, col] of APP_COLORS) if (re.test(app)) return col;
  let h = 0;
  for (let i = 0; i < app.length; i++) h = (h * 31 + app.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

/**
 * Gradient for surfaces that carry white glyph text. Stops are darkened so
 * white stays ≥4.5:1 even on the brightest app colors (green/amber) — the
 * old white-topped gradient bottomed out near 2.2:1.
 */
export function onColorGradient(col: string): string {
  return `linear-gradient(180deg, color-mix(in srgb, ${col} 65%, #000) 0%, color-mix(in srgb, ${col} 52%, #000) 55%, color-mix(in srgb, ${col} 40%, #000) 100%)`;
}

export function appGlyph(app: string): string {
  // Platform identity matches the connector glyphs ("M", "GH").
  if (/^make$/i.test(app)) return "M";
  if (/^clickfunnels(_classic)?$/i.test(app)) return "CF";
  // Make's "gateway" package is its webhook modules — "GA" reads as noise.
  if (/^gateway$/i.test(app)) return "WH";
  const words = app.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || "?").slice(0, 2).toUpperCase();
}

/** "close-crm" → "Close CRM", "google-sheets" → "Google Sheets" */
export function appName(app: string): string {
  const SPECIAL: Record<string, string> = {
    crm: "CRM",
    json: "JSON",
    http: "HTTP",
    api: "API",
    ai: "AI",
    ghl: "GHL",
    clickfunnels: "ClickFunnels",
    gateway: "Webhooks",
  };
  return app
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      return SPECIAL[lower] ?? w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}
