import { clamp01, easeOutCubic } from "./geometry";

/*
 * The first-load assembly timeline, in seconds from the intro clock's origin.
 * Canvas phases read `el` (elapsed) through these helpers; DOM entrances use
 * the millisecond delays. One file so the two never drift.
 *
 * The origin is handed out by the boot screen (BootProvider.start) so that
 * its fade always lands at t = overlayFadeAtMs. When the estate takes longer
 * than a second to arrive the origin is placed in the past: the phases the
 * cover would have hidden anyway are skipped, and what the eye sees as the
 * cover lifts — ring closing, nodes popping — is the same every time.
 */
export const INTRO = {
  ring: { at: 0.7, dur: 0.8 },
  grid: { at: 1.1, dur: 0.6 },
  node: { at: 1.35, stagger: 0.018, dur: 0.35 },
  arc: { at: 2.0, stagger: 0.07, dur: 0.6 },
  caption: { at: 2.4, dur: 0.5 },
  pulsesAt: 2.9,
  /** The cover starts fading at 1.0s and is gone by 1.4s. */
  overlayFadeAtMs: 1000,
  overlayFadeDurMs: 400,
  /** Once the estate is in, the status line shows its count for at least
   *  this long before the cover fades. */
  readyHoldMs: 500,
  panelDelayMs: 2100,
  hintDelayMs: 2250,
  /** After this every phase is complete; the renderer stops evaluating them. */
  doneAt: 3.6,
} as const;

/** Sentinel elapsed value meaning "final state, no intro". */
export const INTRO_DONE = 99;

export const ringProgress = (el: number) => easeOutCubic(clamp01((el - INTRO.ring.at) / INTRO.ring.dur));
export const gridAlpha = (el: number) => clamp01((el - INTRO.grid.at) / INTRO.grid.dur);
export const nodeIn = (el: number, i: number) =>
  easeOutCubic(clamp01((el - INTRO.node.at - (i % 40) * INTRO.node.stagger) / INTRO.node.dur));
export const arcReveal = (el: number, ai: number) =>
  easeOutCubic(clamp01((el - INTRO.arc.at - ai * INTRO.arc.stagger) / INTRO.arc.dur));
export const captionAlpha = (el: number) => clamp01((el - INTRO.caption.at) / INTRO.caption.dur);
export const pulsesOn = (el: number) => el >= INTRO.pulsesAt;
