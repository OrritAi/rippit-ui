/*
 * Workflow map — the motion vocabulary.
 *
 * Layout constants and the timings the renderer keys off live in `tokens.ts`.
 * This file holds only what describes *how a thing arrives*, kept separate
 * because the two have different owners and different reasons to change.
 * Pure data, no imports, so it stays safe under
 * `node --experimental-strip-types` the way tokens.ts is.
 *
 * ── The one idea: a ladder, descended on purpose ───────────────────────
 *
 * What a reader sees is chosen by an explicit click, not by where they
 * happen to have dragged or how far they happen to have zoomed. L1 shows the
 * shape of the workflow in ~4 elements; L2 its structure in ~14; L3 one arm's
 * actual steps; L4 is the sidebar. **Layer and zoom are independent and must
 * never fight** — zoom stays free roam, and nothing here may change what the
 * map is showing because the camera moved.
 *
 * So the layer transition is the map's primary animation. It has to do one
 * job: make it obvious that you moved *into* something, and where you came
 * from, so a descent is never disorienting and the way back is never in
 * doubt.
 *
 * It is two phases with a timer between them, never a chained `.finished`:
 *
 *   1. **Push.** The content scales up about the clicked element's own screen
 *      position and dims. Aiming at the clicked point rather than the
 *      viewport centre is the whole trick — it is what reads as falling
 *      toward the thing you clicked instead of a generic zoom.
 *   2. **Resolve.** The layer state changes, and the new layer's cards arrive
 *      *from that same point*, each starting offset toward it. The origin is
 *      the visual thread between the two layers.
 *
 * Only the arrival is animated. A departure that owns an element's inline
 * style strands it the moment React reuses that node, which is a bug already
 * paid for once here.
 *
 * ── Scroll: demoted, deliberately ──────────────────────────────────────
 *
 * An earlier design made scroll the mechanism — cards revealing as a pan
 * brought them into view. It is kept, because it is a genuinely cheap
 * entrance for a layer holding a lot of cards and it costs nothing when
 * there are few, but it is no longer what carries the feel and it does not
 * shape anything. What it still contributes is the guarantee below.
 *
 * ── The guarantee ──────────────────────────────────────────────────────
 *
 * Every card is revealed exactly once, ever, and a reveal is monotonic: a
 * card goes hidden → shown and can never go back. This is not a preference.
 * A card that could be re-hidden is a card that can be invisible, and an
 * invisible card is an unclickable card — the failure that has cost a full
 * debugging cycle here before. Every hiding rule in this layer is paired
 * with a failsafe that drops it unconditionally.
 */

/** The design system's ease, as the tuple Motion takes. Identical curve to
 *  `--ease-out` in globals.css — one curve, two syntaxes. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
/*
 * The exit curve lives in globals.css as `--ease-in`, not here, because the
 * one thing that leaves — the push at the start of a layer change — is a CSS
 * state change rather than a tween. That is deliberate, and it is the second
 * time this file has paid for the lesson: a stopped Motion animation can
 * write its sampled value back to inline style on a later tick than the call
 * that stopped it, so a synchronous clear runs first and the commit lands on
 * top of it. The content box was left at `scale(0.945)` and `opacity 0.447`
 * with no animation running — the whole map dimmed and 5.5% undersized for
 * the rest of the session, and every edge off its card, because the measure
 * hook divides client rects by CSS `zoom` alone.
 *
 * A class or an attribute cannot be raced. Removing it removes the
 * transition with it, so the box returns to identity atomically.
 *
 * The rule this file follows: **anything that can be a state change is a
 * state change.** Motion animates what genuinely needs per-element
 * scheduling — the staggered card arrivals, the edge draw — and nothing
 * else.
 */

/**
 * The identity transform, written out.
 *
 * Never `'none'` as a Motion keyframe: it parses to `matrix(0,0,0,0,0,0)`,
 * i.e. scale 0, and the element renders 0×0 — present in the DOM, correct
 * text, invisible and unclickable. This constant exists so the mistake
 * cannot be made by hand. (CSS `transform: none` is unaffected and stays
 * valid — the existing `@keyframes rise` / `branchin` are fine as written.)
 */
export const IDENTITY = "translateY(0px) scale(1)";

/* ── Reveal: a card arriving, whether by entrance or by pan ───────────── */

/**
 * Card reveal duration.
 *
 * The handoff says 500 ms. This map says 460, and the 40 ms is not taste:
 * `SETTLE_MS = 720` is the measure hook's trailing measure, documented as
 * "after the longest entrance", and the edges land on whatever the layout is
 * at that moment. 460 + `REVEAL_STAGGER_CAP_MS` 250 = 710 ms fits inside it;
 * 500 + 250 = 750 does not, and would settle the edges onto cards still in
 * flight. The handoff's map had no measure system to fit inside.
 */
export const REVEAL_MS = 460;
/** Per-card delay inside one batch, in DOM (reading) order. */
export const REVEAL_STAGGER_MS = 32;
/** Total stagger ceiling — a batch of 80 must not take two and a half
 *  seconds. Past this every remaining card shares the last delay. */
export const REVEAL_STAGGER_CAP_MS = 250;
/** How far a card rises as it arrives. Transform + opacity only: both
 *  composite, neither reflows, and neither fires a ResizeObserver. */
export const REVEAL_RISE_PX = 16;
/** And how much it grows into place. */
export const REVEAL_SCALE = 0.965;

/** The reveal's start keyframe, written as an explicit transform. */
export const REVEAL_FROM = `translateY(${REVEAL_RISE_PX}px) scale(${REVEAL_SCALE})`;

/**
 * Viewport margin for the reveal observer, as an IntersectionObserver
 * `rootMargin`.
 *
 * Positive, and small. Zero pops the card exactly at the edge; a large
 * margin reveals it well off screen, where the whole point of the animation
 * is wasted. 24 px starts the tween as the card's edge crosses, so the rise
 * plays while it slides in — which is the thing the founder asked to see.
 */
export const REVEAL_MARGIN = "24px";

/**
 * Failsafe. If the observer has not reported once by now — a detached root,
 * a browser quirk, an exception upstream — the reveal is abandoned for this
 * view and the hiding class comes off, so the map renders plainly and every
 * card that appears afterwards is visible too.
 *
 * A motion layer must never be able to leave a card invisible, because an
 * invisible card is an unclickable card and the map is then simply broken.
 * This is the one timer whose job is to make the feature fail open.
 */
export const REVEAL_FAILSAFE_MS = 2500;

/* ── Edges drawing themselves ─────────────────────────────────────────── */

/**
 * Each line runs out over this. The handoff's number, kept.
 *
 * A line draws only after both of its cards have landed and one measure has
 * run since. A card runs on the compositor and keeps moving through a
 * main-thread stall; a line's `d` moves only when the main thread measures,
 * so a line drawn under a moving card is left behind for the whole stall. A
 * line has no stagger of its own: its cards' landing times already cascade.
 *
 * Predicted, not yet measured: every line drawn at hold start + 1320 ms +
 * latency (reveal start 17 + stagger cap 250 + rise 460 + hand-back 40 +
 * two-frame measure 33 + this 520).
 */
export const EDGE_DRAW_MS = 520;

/**
 * Failsafe for the edge hold, which keeps a line invisible from render until
 * its own draw begins.
 *
 * Every hold expires. Aged per line from the later of when it was first held
 * and when both of its cards were first seen shown; a line waiting on a card
 * not yet shown is exempt, because releasing it would draw a line to an
 * invisible card that then arrives under it. Past this, the line is released,
 * treated as drawn, and its holder marked `data-wm-failsafe` — so a hold that
 * had to be dropped fails the geometry checker instead of passing quietly.
 * When motion switches off (LITE, reduced motion, the reveal failsafe giving
 * up) every hold is cleared at once, unmarked: no rule is hiding those lines.
 */
export const EDGE_HOLD_FAILSAFE_MS = 2000;

/*
 * Two registers are deliberately *not* here: the selection lift and dim, and
 * the collapsed-group stack. Both are pure CSS state changes with no JS
 * involved, so their numbers live with their rules in globals.css rather
 * than in a second copy here that is free to drift. The reasoning lives
 * there too.
 */

/* ── The camera ───────────────────────────────────────────────────────── */

/*
 * The rule: **programmatic moves are eased, direct manipulation is not.** A
 * transition on a per-frame update reads as lag rather than smoothness, so
 * dragging and wheel-zoom must have none, and an eased move must be dropped
 * the instant the canvas is touched.
 *
 * `useMapCamera` already gets both halves right for zoom — the glide is a
 * rAF tween, a drag writes `scrollLeft` directly, and starting a drag
 * freezes an in-flight smooth scroll. The gap is pan: `focusNode` centres
 * with the browser's own `behavior: "smooth"`, whose duration and curve are
 * the user agent's. So the map's single most frequent move — centring on
 * what you just clicked — is the one move that does not use the design
 * system's ease, cannot be retargeted, and is timed differently in every
 * browser. These replace it.
 */

/** Below this the move is a nudge; it should not take longer than a nudge. */
export const PAN_MIN_MS = 260;
/** And a jump across a 119-step map should not become a journey. */
export const PAN_MAX_MS = 620;
/** Between the two, duration follows distance, so near and far moves read
 *  as the same camera travelling rather than two different gestures. */
export const PAN_MS_PER_PX = 0.6;
/** Below this the camera is already there — moving would be a twitch. */
export const PAN_MIN_PX = 2;

/** How long an eased pan across `dist` px should take. */
export function panMs(dist: number): number {
  return Math.min(PAN_MAX_MS, Math.max(PAN_MIN_MS, dist * PAN_MS_PER_PX));
}

/**
 * Delay for the i-th of n members of a batch. Card reveals only: a line has
 * no stagger of its own.
 *
 * The batch is spread evenly across the cap rather than stepped at a fixed
 * rate and clipped. Clipping was the original rule and it clumps: at the
 * card step (32 ms) and cap (250 ms), eight arrivals cascade and every one
 * after that lands at exactly 250 ms together — measured, 9 of 17 cards
 * sharing the cap, which is the size of a descent into Structure on a real
 * GoHighLevel workflow. It reads as a cascade that stalls into a pop.
 *
 * The cap cannot simply rise to make room: a card's rise plus the cap has to
 * finish inside the measure hook's 720 ms settle. So the *step* gives way
 * instead — never faster than `step` for a small batch, which is therefore
 * unchanged, and compressed evenly for a large one so the last member still
 * lands on the cap and every member in between is still distinct.
 */
export function staggerAt(i: number, n: number, step: number, cap: number): number {
  const even = n > 1 ? cap / (n - 1) : step;
  return Math.round(i * Math.min(step, even));
}

/* ── The layer change ─────────────────────────────────────────────────── */

/**
 * Phase 1, the push: how long the outgoing layer scales up and dims before
 * the layer state actually changes.
 *
 * The handoff says 380 ms, for a dive that was a real camera move to a new
 * scope. This one is a visual hint sitting *in front of* a navigation, and
 * every millisecond of it is latency between the click and the new content.
 * 190 ms is enough to read as "moving in" and short enough not to read as
 * the app hesitating.
 */
export const PUSH_MS = 190;
/**
 * `apply()` fires here, just inside the push. Never sequenced off
 * `.finished`: it differs across Motion builds, and a library API difference
 * must not be able to strand a navigation half-done.
 *
 * This is when the *state* changes, not when the new rung *appears*, and the
 * two are far apart on real data. After `apply()` the new rung still has to
 * render and commit, which on a real workflow takes about another 290 ms: a
 * rung change reaches the page about 460 ms after the click (measured, n=10;
 * an arm reopen 441 ms, a pill reopen 268 ms, because less renders).
 *
 * So the push, which ends at 190 ms, is not covering the arrival of the new
 * content — it has visibly stopped roughly 270 ms before that content
 * lands. Every later timing on this page starts from commit arrival, not
 * from here. Treating these as the same moment is the assumption that put
 * an earlier prediction of the draw start 370 ms too early.
 */
export const PUSH_SWAP_MS = 175;

/**
 * How far the content scales up, about the clicked element's own screen
 * position.
 *
 * Modest on purpose. The handoff pushes to 1.9× because that *was* the scope
 * change; here the content is about to be replaced outright, so the push
 * only has to establish direction. Anything larger reads as a lurch, and on
 * a descent the user is about to have to re-read the screen anyway.
 *
 * Scaling about the clicked point rather than the viewport centre is the
 * part that matters — it is the same thing the handoff's camera maths
 * (`k = z / zoom; tx = cx - (cx - pan.x) * k`) does, expressed as a
 * transform-origin instead of a scroll offset.
 */
export const PUSH_SCALE = 1.1;
/** Ascending pushes the other way: the content recedes as you step back out. */
export const PULL_SCALE = 0.94;
/** Going back is shorter than going in. Ascending is a return to something
 *  already seen, and making it as ceremonious as the descent makes the way
 *  back feel expensive — which is how a ladder acquires dead ends. */
export const PULL_MS = 150;
export const PULL_SWAP_MS = 135;
/** The outgoing layer dims rather than vanishing, so the swap is not a cut. */
export const PUSH_FADE = 0.4;

/**
 * How much of the distance to the origin a card starts displaced by, when it
 * arrives as part of a layer change.
 *
 * This is the visual thread between the two layers: every card flies out
 * from the point you clicked, so the new layer demonstrably came from that
 * element rather than simply replacing the screen. A fraction rather than a
 * fixed offset, so a card near the origin barely moves and one at the far
 * edge sweeps — which is the radial parting the handoff describes, obtained
 * from the geometry instead of from per-sibling bookkeeping.
 */
export const ARRIVE_PULL = 0.32;
/** And how small it starts. Deeper than a plain reveal's 0.965: arriving
 *  from a layer change is a bigger event than scrolling onto a card. */
export const ARRIVE_SCALE = 0.88;
/** The window after a layer change during which arrivals use the origin.
 *  After it, reveals go back to the plain rise — a card panned onto later
 *  has nothing to do with where the layer change started. */
export const ARRIVE_WINDOW_MS = 900;

/** A card's start transform when it arrives as part of a layer change.
 *  Explicit identity is the end state, never `'none'`. */
export function arriveFrom(dx: number, dy: number): string {
  return `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${ARRIVE_SCALE})`;
}
