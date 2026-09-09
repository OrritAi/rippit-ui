import { clamp01, easeOutCubic } from "./geometry";

/*
 * The first-load assembly timeline, in seconds from the moment the globe has
 * data. Canvas phases read `el` (elapsed) through these helpers; DOM
 * entrances use the millisecond delays. One file so the two never drift.
 */
export const INTRO = {
  ring: { at: 0.7, dur: 0.8 },
  grid: { at: 1.1, dur: 0.6 },
  node: { at: 1.35, stagger: 0.018, dur: 0.35 },
  arc: { at: 2.0, stagger: 0.07, dur: 0.6 },
  caption: { at: 2.4, dur: 0.5 },
  pulsesAt: 2.9,
  /** Overlay starts fading at 1.0s and is gone by 1.4s. */
  overlayFadeAtMs: 1000,
  overlayFadeDurMs: 400,
  panelDelayMs: 2100,
  hintDelayMs: 2250,
  /** After this every phase is complete; the renderer stops evaluating them. */
  doneAt: 3.6,
} as const;

/** Sentinel elapsed value meaning "final state, no intro". */
export const INTRO_DONE = 99;

export const BOOTED_KEY = "rippit.globe.booted";

export const ringProgress = (el: number) => easeOutCubic(clamp01((el - INTRO.ring.at) / INTRO.ring.dur));
export const gridAlpha = (el: number) => clamp01((el - INTRO.grid.at) / INTRO.grid.dur);
export const nodeIn = (el: number, i: number) =>
  easeOutCubic(clamp01((el - INTRO.node.at - (i % 40) * INTRO.node.stagger) / INTRO.node.dur));
export const arcReveal = (el: number, ai: number) =>
  easeOutCubic(clamp01((el - INTRO.arc.at - ai * INTRO.arc.stagger) / INTRO.arc.dur));
export const captionAlpha = (el: number) => clamp01((el - INTRO.caption.at) / INTRO.caption.dur);
export const pulsesOn = (el: number) => el >= INTRO.pulsesAt;

export function readBooted(): boolean {
  try {
    return sessionStorage.getItem(BOOTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeBooted() {
  try {
    sessionStorage.setItem(BOOTED_KEY, "1");
  } catch {
    /* private mode etc. — the intro simply replays next time */
  }
}
