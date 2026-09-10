/*
 * Workflow map constants — the numbers the design handoff fixes (gaps,
 * timings, the accent) and the scale thresholds the renderer keys off.
 * Pure data: no imports, safe under `node --experimental-strip-types`.
 */

/** Accent for rings, edges, chips and filter hits. A CSS variable so the
 *  light theme (4.0:1) and dark theme (exactly the design) both work. */
export const MAP_ACCENT = "var(--map-accent)";
export const MAP_ACCENT_TEXT = "var(--map-accent-text)";

/** Above this many rendered nodes the map drops drift, pulses, stagger and
 *  the unfold measure loop (one measure after commit + ResizeObserver). */
export const LITE_AT = 150;
/** Above this many roots, rows far from the viewport render as a fixed-height
 *  placeholder (see `useMapMeasure.heights`). */
export const ROOT_WINDOW_AT = 200;
/** Placeholder height for a windowed root row before it was ever measured. */
export const ROW_PLACEHOLDER_H = 60;

/* Layout (px) — from the handoff. */
export const ROW_GAP = 44; // between root rows
export const ROOT_SPACER = 84; // root pill → its children column
export const DEEP_SPACER = 72; // any deeper parent → its children column
export const CHILD_GAP_ROOT = 26; // between a root's children — a chain edge is gap − 10px of line
export const CHILD_GAP_DEEP = 26; // between deeper children
export const EDGE_PAD = 5; // bezier starts 5px right of the parent, ends 5px left of the child
export const SIDEBAR_W = 322;
/** Pill names wrap past this instead of truncating — nothing on the map ellipsises. */
export const PILL_NAME_MAX_W = 300;
/** Step cards: puck + full name + one detail line. */
export const STEP_COL_W = 236;

/* Timings (ms) — from the handoff. */
export const UNFOLD_MS = 650; // rAF measure loop after a toggle
/** One trailing measure after the longest entrance (rise 450 + stagger cap
 *  250) so edges land on the settled layout, not mid-animation. */
export const SETTLE_MS = 720;
/** Edges glide to a new measurement over this (filter, labels hiding, sidebar). */
export const EDGE_TWEEN_MS = 260;
/** Zoom glides to its target over this (wheel notch, +/−, Fit). */
export const ZOOM_TWEEN_MS = 160;
export const FOCUS_DELAY_MS = 380; // centre a toggled pill once layout settled
export const FILTER_DEBOUNCE_MS = 120;
export const SIDEBAR_MS = 300;
export const STAGGER_MS = 50;
export const STAGGER_CAP_MS = 250;

/* Camera (CSS `zoom` on the inner content; native scroll stays). */
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 1.12; // one wheel notch / one +/− press
/** Below this zoom, step labels and pill meta lines hide (unreadable anyway,
 *  and it keeps a zoomed-out estate light). */
export const FAR_AT = 0.5;
/** Hysteresis around FAR_AT so a glide never flickers the mode. */
export const FAR_HYSTERESIS = 0.03;
/** Far mode: a step card collapses to this square puck tile. */
export const FAR_TILE = 44;
/** A children column whose rendered subtree holds at least this many nodes
 *  (or any child with its own column) is "tall": its parent top-aligns with
 *  the column instead of centring against it. */
export const TALL_COLUMN_AT = 4;
/** Minimum horizontal run of a bezier's control handles, so a connector to
 *  a far-away child still reads as an S-curve, never a vertical hairline. */
export const EDGE_MIN_RUN = 40;
/** Orthogonal elbow routing (shared trunk + stubs) instead of beziers when a
 *  parent has ≥ ELBOW_AT children or its children column spans more than
 *  ELBOW_TALL px (inner space); corners are ELBOW_R px. */
export const ELBOW_AT = 3;
export const ELBOW_TALL = 600;
export const ELBOW_R = 6;
/** Cross edges (join / jump) route orthogonally past this vertical distance
 *  or whenever the target is left of the source (a back-edge). */
export const CROSS_ELBOW_DY = 300;
/** Fan-out: a node with at least this many rendered children gets the wider
 *  spacer, staggered handle runs and `.wm-edge-fan` on its edges. */
export const FAN_AT = 6;
export const FAN_SPACER = 120;
/** Each successive edge from one parent runs this much further before it
 *  turns, so a fan peels off at different x instead of bundling. */
export const FAN_RUN_STEP = 6;

/* Minimap (bottom-right glass panel; shown when the content overflows). */
export const MINIMAP_W = 184;
export const MINIMAP_H = 120;

/* Data loading. */
export const SUMMARY_LRU_MAX = 200;
export const SUMMARIES_CHUNK = 40;
