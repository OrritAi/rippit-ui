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

/** A fan-out arm folds into one card only when it stands for at least this
 *  many steps — the shape signature's own floor of three, below which a
 *  "2 steps" card costs more to read than the steps it hides. */
export const FOLD_AT = 3;
/** At the macro rung a run of plain consecutive steps packs into its first
 *  card at this length. The same floor of three: two steps is a pair, not a
 *  run worth a count. */
export const PACK_AT = 3;

/* ── Where lines meet cards ────────────────────────────────────────────────
   The viewed workflow runs left to right: a chain is one top-aligned row of
   cards, a fan-out ends its row with its branches stacked to the right, and
   a workflow a step calls hangs below that step. A connected workflow runs
   top to bottom, in a column left-aligned with its pill. These fix where the
   lines meet the cards, so they are derived from the card rather than chosen
   — change the card and they must move with it. */

/** Height of a chain's rail below the top of its row: the centre of a step
 *  card's 32px puck — the card's 1px border, its 10px body padding, and half
 *  the puck (`StepNode`: `border`, `p-2.5`, `AppPuck size={32}`). Every card
 *  in a row is top-aligned, so this single height is one straight line
 *  through the whole row, whatever each card's own height. */
export const CHAIN_RAIL_Y = 1 + 10 + 32 / 2;
/** How far in from a step card's left edge the line to a pill hanging below
 *  it leaves the card's bottom: under the centre of the same puck, so the
 *  drop reads as coming out of the step's own icon. */
export const DROP_X = 1 + 10 + 32 / 2;
/** A workflow pill's minimum height (`WorkflowPill`: `min-h-10`). A pill that
 *  starts a row drops by CHAIN_RAIL_Y − PILL_MIN_H / 2 so its centre is on the
 *  rail. A pill whose name wraps is taller and sits that much off it. */
export const PILL_MIN_H = 40;
/* ── Spacing: width over height ───────────────────────────────────────────
   Screens are wide and scrolling up and down is what makes a map feel
   cramped, so the map spends width to save height: wide cards that wrap
   less, generous gaps along a row, compact but breathing gaps between the
   lanes stacked down it. */

/** Step and branch cards (was 236): a name of about forty characters fits on
 *  two lines, so cards stay short and a row stays low. */
export const STEP_COL_W = 288;
/** Between two linked cards in a row: a generous link the eye follows as a
 *  line, spending the width the screen has. */
export const CHAIN_GAP = 56;
/** Between two cards down a connected workflow's column: compact, since
 *  every step there costs height, with 22px of line still reading as a link. */
export const COLUMN_GAP = 32;
/** Between stacked lanes — branches, entry chains, workflows hanging from one
 *  step, callers: close enough that a fan of branches reads as one group,
 *  with room for a stub to turn into each lane. */
export const LANE_GAP = 28;
/** A card's bottom to the first workflow hanging from it: the drop clears
 *  its card far enough for its turn to read as a turn. */
export const HANG_GAP = 20;
/** The drop line's run right into a hanging pill. With DROP_X it indents the
 *  hanging workflow 48px under its step — past the step's puck, so the two
 *  never share a left edge. */
export const HANG_RUN = 48 - DROP_X;
/** Between root rows. */
export const ROW_GAP = 48;
/** The callers block → the viewed pill: room for the fan-in trunk 40px left
 *  of the pill with clear space past the widest caller. */
export const ROOT_SPACER = 84;
/** A card → the lanes beside it — a fan-out's branches, a group's entry
 *  chains, a connected step's calls, shared steps: the trunk sits at the
 *  midpoint with a 32px stub either side of it. */
export const DEEP_SPACER = 64;
export const EDGE_PAD = 5; // bezier starts 5px right of the parent, ends 5px left of the child
export const SIDEBAR_W = 322;
/** Pill names wrap past this instead of truncating — nothing on the map ellipsises. */
export const PILL_NAME_MAX_W = 300;

/* Timings (ms) — from the handoff. */
export const UNFOLD_MS = 650; // rAF measure loop after a toggle
/** One trailing measure after the longest entrance (rise 450 + stagger cap
 *  250) so edges land on the settled layout, not mid-animation. */
export const SETTLE_MS = 720;
/**
 * A settle keeps measuring until the geometry stops changing: this many
 * consecutive identical measurements mean the layout has converged.
 *
 * A settle used to be two measures — the next frame, then SETTLE_MS — which
 * assumes the layout a commit produces is final. It is not. A column's width
 * redistributes as its content lays out, a row the browser was skipping is
 * rendered, a windowed placeholder gives up the stale height it was standing
 * at. None of those resize a box an observer is watching, so nothing reports
 * them, and the 700ms between the two measures is a long time to be drawing
 * lines to where cards used to be: measured at up to 101px on the 119-step
 * workflow, under reduced motion, where there is no unfold loop to cover it.
 *
 * Convergence rather than a list of timings on purpose. Which frame the layout
 * stops moving on depends on the workflow, the machine and how much else is on
 * screen, so any set of milliseconds is a guess that is wrong somewhere —
 * whereas "it stopped changing" is the actual condition, and it costs one
 * extra measure on a layout that was stable to begin with.
 */
export const CONVERGE_STABLE_FRAMES = 2;
/**
 * And the hard cap on that, because it must never become the per-frame loop
 * LITE and reduced motion exist to avoid. Past this the trailing SETTLE_MS
 * measure is the backstop. Something still moving after 400ms is an animation
 * being followed, which is `UNFOLD_MS`'s job, not this one's.
 */
export const CONVERGE_MAX_MS = 400;
/** Edges glide to a new measurement over this (filter, labels hiding, sidebar). */
export const EDGE_TWEEN_MS = 260;
/** Zoom glides to its target over this (wheel notch, +/−, Fit). */
export const ZOOM_TWEEN_MS = 160;
export const FOCUS_DELAY_MS = 380; // centre a toggled pill once layout settled
export const FILTER_DEBOUNCE_MS = 120;
export const SIDEBAR_MS = 300;

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
/** A column of shared steps whose rendered subtree holds at least this many
 *  nodes is "tall": it top-aligns with the lanes that reach it instead of
 *  centring against them. */
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
