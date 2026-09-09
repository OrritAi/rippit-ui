#!/usr/bin/env node
/*
 * Contrast audit — guards the design-token pairs in src/app/globals.css
 * against regressions. WCAG 2.1: 4.5:1 for normal text, 3:1 for non-text UI.
 * Run: node scripts/contrast-audit.mjs   (wired into `pnpm lint:contrast`)
 *
 * Pairs are asserted against literal hex values; if you retune a token in
 * globals.css, update it here too — that's the point: the change gets a
 * conscious contrast check instead of a silent regression.
 */

function lum(hex) {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** Composite an rgba(255,255,255,alpha) hairline over a dark bg. */
function whiteOver(bgHex, alpha) {
  const c = bgHex.replace("#", "");
  const ch = (i) =>
    Math.round(parseInt(c.slice(i, i + 2), 16) * (1 - alpha) + 255 * alpha)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

const DARK_BG = "#09090b";
const LIGHT_BG = "#fafafa";

const CHECKS = [
  // [label, fg, bg, minimum]
  ["dark --t3 on --bg", "#8b8b94", DARK_BG, 4.5],
  ["dark --t2 on --bg", "#a1a1aa", DARK_BG, 4.5],
  ["dark --ok-text on --bg", "#4ade80", DARK_BG, 4.5],
  ["dark --warn-text on --bg", "#fbbf24", DARK_BG, 4.5],
  ["dark --err-text on --bg", "#f87171", DARK_BG, 4.5],
  ["dark --off-text on --bg", "#a1a1aa", DARK_BG, 4.5],
  ["dark --line-strong on --bg (non-text)", whiteOver(DARK_BG, 0.38), DARK_BG, 3],
  ["light --t3 on --bg", "#6b6b74", LIGHT_BG, 4.5],
  ["light --t2 on --bg", "#52525b", LIGHT_BG, 4.5],
  ["light --ok-text on --bg", "#15803d", LIGHT_BG, 4.5],
  ["light --warn-text on --bg", "#92400e", LIGHT_BG, 4.5],
  ["light --err-text on --bg", "#b91c1c", LIGHT_BG, 4.5],
  ["light --off-text on --bg", "#52525b", LIGHT_BG, 4.5],
  ["light --line-strong on --bg (non-text)", "#8f8f98", LIGHT_BG, 3],
  ["light --ok graphic on --bg (non-text)", "#16a34a", LIGHT_BG, 3],
  ["light --warn graphic on --bg (non-text)", "#d97706", LIGHT_BG, 3],
  ["light --err graphic on --bg (non-text)", "#dc2626", LIGHT_BG, 3],
  // Globe canvas palette (src/components/dashboard/globe/palette.ts) — the
  // canvas can't read tokens, so these literals are what it actually paints.
  ["globe dark ghl on --bg (non-text)", "#4cc3fa", DARK_BG, 3],
  ["globe dark make on --bg (non-text)", "#cf9bfc", DARK_BG, 3],
  ["globe dark off on --bg (non-text)", "#8b8b94", DARK_BG, 3],
  ["globe dark label on --bg", "#c5c5cc", DARK_BG, 4.5],
  ["globe light ghl on --bg (non-text)", "#0369a1", LIGHT_BG, 3],
  ["globe light make on --bg (non-text)", "#7e22ce", LIGHT_BG, 3],
  ["globe light off on --bg (non-text)", "#6b6b74", LIGHT_BG, 3],
  ["globe light label on --bg", "#3f3f46", LIGHT_BG, 4.5],
];

let failed = 0;
for (const [label, fg, bg, min] of CHECKS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(
    `${ok ? "✓" : "✗"} ${label}: ${r.toFixed(2)}:1 (needs ${min}:1)`
  );
}

if (failed) {
  console.error(`\n${failed} contrast check(s) failed.`);
  process.exit(1);
}
console.log("\nAll contrast checks pass.");
