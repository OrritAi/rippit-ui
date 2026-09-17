"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { animate } from "framer-motion";
import {
  ARRIVE_WINDOW_MS,
  ARRIVE_PULL,
  arriveFrom,
  EASE_OUT,
  EDGE_DRAW_MS,
  EDGE_HOLD_FAILSAFE_MS,
  IDENTITY,
  REVEAL_FAILSAFE_MS,
  REVEAL_FROM,
  REVEAL_MARGIN,
  REVEAL_MS,
  REVEAL_STAGGER_CAP_MS,
  REVEAL_STAGGER_MS,
  PAN_MIN_PX,
  panMs,
  PULL_MS,
  PULL_SCALE,
  PULL_SWAP_MS,
  PUSH_FADE,
  PUSH_MS,
  PUSH_SCALE,
  PUSH_SWAP_MS,
  staggerAt,
} from "@/lib/workflowMap/motion";

/*
 * useMapMotion — the map's motion layer, in one place.
 *
 * Owns three things and nothing else: when a card is revealed, when an edge
 * draws itself, and what recedes while something is selected. It never
 * decides what renders — that is the tree's job — and it never moves
 * geometry the measure hook reads for a layout decision.
 *
 * ── Why it is imperative, and why it is not `whileInView` ───────────────
 *
 * This is motion.dev's scroll-triggered register — `whileInView` with
 * `viewport={{ root: scrollRef, once: true }}` — with the same semantics and
 * a different implementation, for two reasons:
 *
 *  - The cards belong to `StepNode` / `WorkflowPill`, which another owner is
 *    editing. Turning 200 cards into `motion.div`s means rewriting both, and
 *    the seam would then be everywhere instead of in one file. The elements
 *    already carry `data-node-id` (they carry it for the measure hook), so
 *    the seam already exists and costs neither of us anything.
 *  - One shared `IntersectionObserver` over ≤200 cards is cheaper than 200
 *    components each holding viewport state, on a screen whose whole reason
 *    for existing is staying readable at 119 steps.
 *
 * The animating is still Motion's — `animate()` runs every tween — so the
 * easing, interpolation and scheduling are the library's, not hand-rolled.
 *
 * ── Two invariants, both paid for in blood ─────────────────────────────
 *
 *  1. **Reveal is monotonic, and keyed by node id rather than by element.**
 *     A card goes hidden → shown and can never go back. The record lives in
 *     a JS `Set` of ids, not on the DOM node, because a far-mode flip
 *     (`FAR_AT`) *replaces* a card with a tile — a flag stored on the
 *     element would vanish with it and the whole map would re-hide on a zoom
 *     notch. An invisible card is an unclickable card.
 *  2. **Every tween hands the element back to the stylesheet.** Motion owns
 *     an inline style only while it runs; a timer clears it afterwards. A
 *     tween that keeps its inline style strands the element the moment React
 *     reuses that node, and a left-behind `transform` would also block the
 *     CSS selection lift for the rest of the session.
 *
 * Sequencing is by timer throughout. Never `.finished`: it differs across
 * Motion builds, and a library API difference must not be able to strand
 * the map.
 */

export interface UseMapMotionOptions {
  /** The zoomed content box the tree and the edge SVG live in. */
  innerElement: () => HTMLElement | null;
  /** The scroll viewport — the reveal observer's root. Panning writes
   *  `scrollLeft` / `scrollTop` on this element, which is the whole reason
   *  scroll-triggered animation applies to a free-roam canvas at all. */
  scrollElement: () => HTMLElement | null;
  /** Changes once per view change (the workflow being looked at). Resets the
   *  reveal, so arriving at a workflow plays its entrance exactly once.
   *  Never pass anything a fit, settle or resize can change. */
  viewKey: string;
  /** Motion at all: false under `prefers-reduced-motion`, and under LITE
   *  where the map already drops drift, pulses and stagger. */
  enabled: boolean;
  /** A measure on the next frame (`useMapMeasure`'s `schedule`). A line
   *  draws only after one has run since both of its cards landed. */
  requestMeasure: () => void;
  /** The selected node, or null. Drives the lift and the dim. */
  selectedId: string | null;
}

export interface ChangeLayerOptions {
  /** The element the user clicked. The push scales about its screen
   *  position and the new layer's cards fly out from it, which is the whole
   *  visual thread between the two layers. Null aims at the viewport
   *  centre — fine for a breadcrumb, wrong for a card. */
  origin: HTMLElement | null;
  /** Descending costs more ceremony than coming back out. */
  direction: "down" | "up";
  /**
   * Whether the rung being returned to should re-arrive card by card.
   * Defaults to true on an ascent, which is what a rung change wants: going
   * back out adds no cards, only removes them, so with the reveal record
   * kept there would be nothing left to animate and the pull would end in a
   * snap.
   *
   * Pass false for a collapse *within* a rung — closing one arm among many.
   * There the reasoning inverts: re-announcing every card on screen is a
   * great deal of motion for a small, frequent action whose whole request
   * was for something to go away. Those get an opacity-only resolve, which
   * is also the only kind that is free — a scale on the content box is read
   * as real geometry by the measure hook, and every edge would be drawn
   * against it.
   */
  reannounce?: boolean;
  /** The caller's own state change. Called on a timer inside the push, never
   *  chained off `.finished` — that differs across Motion builds and a
   *  library API difference must not be able to strand a navigation
   *  half-done. Called synchronously when motion is off, so the ladder
   *  behaves identically with no animation at all. */
  apply: () => void;
}

export interface MapMotion {
  /**
   * Move between layers of the ladder. The caller owns what a layer *is*;
   * this owns when the change lands and what it looks like getting there.
   */
  changeLayer: (opts: ChangeLayerOptions) => void;
  /**
   * Centre the viewport on an element, eased. Returns false when it declined
   * — no element, no viewport, motion off, or the camera is already there —
   * so the caller can fall back to the measure hook's instant centring
   * rather than silently doing nothing.
   */
  panTo: (el: HTMLElement | null) => boolean;
}

/**
 * A live tween.
 *
 * `settle` is the whole point of the shape: handing the element back to the
 * stylesheet is a step that must happen *whether the tween finished or was
 * cancelled*. Cancelling and clearing the timer without settling is what
 * strands an element — a card frozen part-way through its rise, or an edge
 * left holding a `stroke-dasharray` and a suspended drift, i.e. a line that
 * simply stops half-drawn. `settle` is idempotent, so the timer and a
 * cancellation can both call it.
 */
interface Running {
  stop: () => void;
  settle: () => void;
  timer: number;
}

/**
 * The element every motion attribute and every tween is applied to: the
 * card's wrapper, not the card.
 *
 * The card carries the tree's own hover lift and its selection transition —
 * two owners of `transform` is one too many, and a reveal that fought a
 * hover would jitter. The wrapper carries nothing, holds exactly one node,
 * and is stable across a far-mode flip (React reconciles the same `div` and
 * replaces only its contents), so the reveal can own it outright.
 */
const boxOf = (el: HTMLElement): HTMLElement => el.parentElement ?? el;

const releaseBox = (inner: HTMLElement): void => {
  delete inner.dataset.wmPush;
  inner.style.transformOrigin = "";
  inner.style.removeProperty("--wm-push-ms");
  inner.style.removeProperty("--wm-push-scale");
  inner.style.removeProperty("--wm-push-fade");
  /* Belt and braces: an older build of this file drove the push with a tween
     and could leave these behind. Clearing them costs nothing and means a
     hot reload across the change cannot strand the map. */
  inner.style.transform = "";
  inner.style.opacity = "";
};

/**
 * What the line-hold is applied to: the `<g data-edge>` wrapping a path, not
 * the path.
 *
 * A line and whatever is drawn on it are one thing. Conditions are moving
 * onto the edges they gate, so a group will soon hold a label as well as a
 * path — and holding only the path would leave that label hanging at full
 * strength in empty space while its line was still invisible, which is
 * precisely the artefact the hold exists to prevent.
 *
 * The group rather than a `:has()` selector because this runs over every
 * edge on the map during a transition, and the map is budgeted for 200
 * nodes. One attribute set from JS costs nothing; a structural selector
 * re-evaluated per group on every attribute change is not worth finding out
 * about at 200.
 *
 * Falls back to the path when there is no group, so it cannot break if the
 * SVG is ever restructured.
 */
const holderFor = (path: SVGPathElement): Element => {
  const g = path.parentElement;
  return g && g.hasAttribute("data-edge") ? g : path;
};

/** A card has landed once it is shown and no longer revealing: the same
 *  attributes the geometry checker reads, so the two cannot disagree. */
const hasLanded = (box: HTMLElement | null | undefined): boolean =>
  !!box && box.hasAttribute("data-wm-shown") && !box.hasAttribute("data-wm-revealing");

/** Shown, landed or not. A line is exempt from the edge-hold failsafe only
 *  while one of its cards is not shown at all. */
const isShown = (box: HTMLElement | null | undefined): boolean =>
  !!box && box.hasAttribute("data-wm-shown");

/** Each card's wrapper by node id: the first match, as a lookup by id finds it. */
const boxesIn = (inner: HTMLElement): Map<string, HTMLElement> => {
  const boxes = new Map<string, HTMLElement>();
  for (const el of inner.querySelectorAll<HTMLElement>("[data-node-id]")) {
    const id = el.dataset.nodeId;
    if (id && !boxes.has(id)) boxes.set(id, boxOf(el));
  }
  return boxes;
};

/** The cards a line's position depends on: a trunk's node, from its key
 *  (`trunk:<parent>` / `trunkin:<target>`); any other line's two ends. Node
 *  ids contain `:`, so only the known prefix is stripped. */
const endpointsOf = (path: SVGPathElement): string[] => {
  const trunk = path.dataset.trunk;
  if (trunk?.startsWith("trunkin:")) return [trunk.slice(8)];
  if (trunk?.startsWith("trunk:")) return [trunk.slice(6)];
  return [path.dataset.from, path.dataset.to].filter((id): id is string => !!id);
};

export function useMapMotion({
  innerElement,
  scrollElement,
  viewKey,
  enabled,
  requestMeasure,
  selectedId,
}: UseMapMotionOptions): MapMotion {
  /** Node ids already revealed. Survives element replacement (far flip),
   *  re-render and re-parenting — see invariant 1. */
  const shown = useRef(new Set<string>());
  /** Edge keys already drawn, for the same reason. */
  const drawn = useRef(new Set<string>());
  const running = useRef(new Map<string, Running>());
  const observer = useRef<IntersectionObserver | null>(null);
  /** Elements handed to the *current* observer. Reset whenever one is made. */
  const observed = useRef(new WeakSet<Element>());
  const failsafe = useRef(0);
  /** Where the current layer change came from, in viewport coordinates, and
   *  when it expires. While it is live, a card arriving flies out from this
   *  point instead of doing the plain rise. */
  const arrival = useRef<{ x: number; y: number; until: number } | null>(null);
  const layerTimer = useRef(0);
  /** Runs the swap that `layerTimer` is waiting to run, immediately and
   *  once. Null when nothing is pending. */
  const flushSwap = useRef<(() => void) | null>(null);
  /** Unconditional deadline for taking the push back off, whatever else
   *  happened — the failsafe every hiding or dimming rule in this file has. */
  const pushGuard = useRef(0);
  /** The observer has reported at least once, so it works. */
  const reported = useRef(false);
  /** It did not, within REVEAL_FAILSAFE_MS. The reveal is abandoned for this
   *  view and the map renders plainly. Cleared only on a view change, which
   *  rebuilds the observer and re-arms the deadline — so a map that reports
   *  nothing because it has no cards to report cannot switch motion off for
   *  the rest of the session. */
  const gaveUp = useRef(false);
  /** The edge-hold failsafe's timer, armed for the next line's deadline. */
  const edgeHold = useRef(0);
  /** When each line was first held, by edge key. */
  const heldSince = useRef(new Map<string, number>());
  /** When both of a held line's cards were first seen shown, by edge key. */
  const shownSince = useRef(new Map<string, number>());
  /** Due lines waiting for their measure and draw frames. */
  const queued = useRef(new Set<string>());
  /** Bumped by every reset, so a draw already scheduled does nothing. */
  const drawGen = useRef(0);
  /** The latest `evaluate`, for the reveal's settle timer: it lives in the
   *  observer effect, which must not rebuild when `evaluate` changes. */
  const evaluateRef = useRef<() => void>(() => {});
  /** Whether motion was on at the last commit; null before the first. */
  const motionWas = useRef<boolean | null>(null);

  /*
   * Stop everything in flight and hand every element back to the stylesheet.
   *
   * Settled twice: now, and again on the next frame. `stop()` can write the
   * animation's sampled value back to inline style on a later tick than the
   * call itself, so a synchronous clear runs first and the commit lands on
   * top of it — which is how the layer push once stranded the whole content
   * box. A card caught by that would keep an inline opacity and transform
   * that beat the hiding rule, leaving a ghost at partial opacity, offset,
   * with nothing left to clean it up.
   *
   * The late pass skips any key a newer tween has claimed since, so
   * re-revealing a card immediately (which is what a view change and an
   * ascent both do) is never interrupted by the previous one's cleanup.
   */
  const stopAll = () => {
    drawGen.current += 1;
    queued.current.clear();
    const late: Array<[string, Running]> = [];
    for (const [key, r] of running.current) {
      r.stop();
      window.clearTimeout(r.timer);
      r.settle();
      late.push([key, r]);
    }
    running.current.clear();
    if (late.length === 0 || typeof requestAnimationFrame === "undefined") return;
    requestAnimationFrame(() => {
      for (const [key, r] of late) if (!running.current.has(key)) r.settle();
    });
  };
  useEffect(() => stopAll, []);

  /* ---- 1. reveal ------------------------------------------------------ */

  /*
   * Draw one line now, if its cards are still landed.
   *
   * Looks the path up by key: React reuses a `<path>` across edge keys. Checks
   * the cards again, since one can start revealing between falling due and
   * drawing. The hold, not the dash, hides a waiting line — MapEdges clears
   * the dash whenever `d` moves — so the hold comes off only here.
   */
  const drawLine = useCallback(
    (key: string) => {
      const inner = innerElement();
      if (!inner || !inner.classList.contains("wm-motion") || drawn.current.has(key)) return;
      const path = inner.querySelector<SVGPathElement>(
        `path[data-edge="${CSS.escape(key)}"]:not([data-hit])`,
      );
      const landed = (id: string) => {
        const el = inner.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
        return hasLanded(el && boxOf(el));
      };
      if (!path || !endpointsOf(path).every(landed)) return;
      drawn.current.add(key);
      heldSince.current.delete(key);
      shownSince.current.delete(key);
      const hold = holderFor(path);
      const len = path.getTotalLength();
      if (len && Number.isFinite(len)) {
        /* Suspend the ambient dash drift for the draw, then hand it back.
           React sets only `animationPlayState` on these paths, never the
           shorthand, so writing it inline cannot collide. */
        path.style.animation = "none";
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        const controls = animate(
          path,
          { strokeDashoffset: [len, 0] },
          { duration: EDGE_DRAW_MS / 1000, ease: EASE_OUT },
        );
        const settle = () => {
          path.style.strokeDashoffset = "";
          path.style.strokeDasharray = "";
          path.style.animation = "";
          running.current.delete(`edge:${key}`);
        };
        const timer = window.setTimeout(settle, EDGE_DRAW_MS + 60);
        running.current.set(`edge:${key}`, {
          stop: () => controls.stop(),
          settle,
          timer,
        });
      }
      hold.removeAttribute("data-wm-undrawn");
    },
    [innerElement],
  );

  /*
   * The edge-hold failsafe, per line: every hold expires.
   *
   * Releases a held line EDGE_HOLD_FAILSAFE_MS after it was first held or both
   * of its cards were first seen shown, whichever is later, and marks it
   * drawn, so it is never held again. Its holder is marked `data-wm-failsafe`,
   * so the geometry checker fails on the release rather than the failsafe
   * hiding it. A line to a card not shown is exempt: it is waiting for a pan.
   * Re-arms for the next deadline.
   */
  const armHoldFailsafe = useCallback(() => {
    if (edgeHold.current) return;
    const tick = () => {
      edgeHold.current = 0;
      const inner = innerElement();
      if (!inner || !inner.classList.contains("wm-motion")) return;
      const boxes = boxesIn(inner);
      const now = performance.now();
      let next = Infinity;
      for (const path of inner.querySelectorAll<SVGPathElement>("path[data-edge]")) {
        const key = path.dataset.edge;
        if (!key || path.hasAttribute("data-hit") || drawn.current.has(key)) continue;
        if (!endpointsOf(path).every((id) => isShown(boxes.get(id)))) {
          shownSince.current.delete(key);
          continue;
        }
        const shownAt = shownSince.current.get(key) ?? now;
        shownSince.current.set(key, shownAt);
        const left =
          Math.max(heldSince.current.get(key) ?? shownAt, shownAt) + EDGE_HOLD_FAILSAFE_MS - now;
        if (left > 0) {
          next = Math.min(next, left);
          continue;
        }
        const hold = holderFor(path);
        hold.removeAttribute("data-wm-undrawn");
        hold.setAttribute("data-wm-failsafe", "");
        drawn.current.add(key);
        heldSince.current.delete(key);
        shownSince.current.delete(key);
      }
      if (next !== Infinity) edgeHold.current = window.setTimeout(tick, next);
    };
    edgeHold.current = window.setTimeout(tick, EDGE_HOLD_FAILSAFE_MS);
  }, [innerElement]);

  /*
   * Draw every held line whose cards have landed.
   *
   * Run when a card lands and on every commit that holds lines, so a line is
   * due however its cards came to be shown. A due line waits one measure so
   * it draws against its final shape: request a measure, draw two frames
   * later. Frames and timers only, never `.finished`. Reads `.wm-motion`
   * rather than closing over `enabled`.
   */
  const evaluate = useCallback(() => {
    const inner = innerElement();
    if (!inner || !inner.classList.contains("wm-motion")) return;
    const boxes = boxesIn(inner);
    const now = performance.now();
    const batch: string[] = [];
    let watched = false;
    for (const path of inner.querySelectorAll<SVGPathElement>("path[data-edge]")) {
      const key = path.dataset.edge;
      if (!key || path.hasAttribute("data-hit") || drawn.current.has(key)) continue;
      const ends = endpointsOf(path).map((id) => boxes.get(id));
      /* Starts the failsafe's clock; see `armHoldFailsafe`. */
      if (!ends.every(isShown)) {
        shownSince.current.delete(key);
        continue;
      }
      if (!shownSince.current.has(key)) shownSince.current.set(key, now);
      watched = true;
      if (queued.current.has(key) || !ends.every(hasLanded)) continue;
      queued.current.add(key);
      batch.push(key);
    }
    if (watched) armHoldFailsafe();
    if (batch.length === 0) return;
    requestMeasure();
    const gen = drawGen.current;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (gen !== drawGen.current) return;
        for (const key of batch) {
          queued.current.delete(key);
          drawLine(key);
        }
      }),
    );
  }, [innerElement, requestMeasure, drawLine, armHoldFailsafe]);

  useEffect(() => {
    evaluateRef.current = evaluate;
  }, [evaluate]);

  /*
   * Motion switching off: LITE, reduced motion, or the reveal giving up.
   *
   * No rule hides a held line any more, so every hold is cleared, once, along
   * with everything queued or due and its timers. A line never keeps a hold
   * that no rule enforces.
   */
  const motionOff = useCallback((inner: HTMLElement) => {
    stopAll();
    window.clearTimeout(edgeHold.current);
    edgeHold.current = 0;
    heldSince.current = new Map();
    shownSince.current = new Map();
    for (const el of inner.querySelectorAll("[data-wm-undrawn]")) el.removeAttribute("data-wm-undrawn");
  }, []);

  /*
   * Motion switching back on. Nothing already on the page is hidden or
   * animated again: every rendered card counts as shown and every rendered
   * line as drawn, in the refs as well as the attributes.
   *
   * That leaves the observer nothing to report, which the reveal failsafe
   * would read as a broken observer and switch motion off again.
   */
  const motionOn = useCallback((inner: HTMLElement) => {
    reported.current = true;
    for (const el of inner.querySelectorAll<HTMLElement>("[data-node-id]")) {
      if (el.dataset.nodeId) shown.current.add(el.dataset.nodeId);
      boxOf(el).dataset.wmShown = "";
    }
    for (const path of inner.querySelectorAll<SVGPathElement>("path[data-edge]"))
      if (path.dataset.edge && !path.hasAttribute("data-hit")) drawn.current.add(path.dataset.edge);
  }, []);

  /* Before paint, on every render: mark each card's wrapper, re-apply
     `data-wm-shown` to anything already revealed, and hold every line not
     yet drawn. Re-applying is what makes a far-mode flip free — the tile
     that just replaced a card is marked in the same commit that created it,
     so the hiding rule never gets a frame in which to apply to it. */
  useLayoutEffect(() => {
    const inner = innerElement();
    if (!inner) return;
    /* Re-asserted here rather than set once: React owns `className` on this
       element, and a class added behind its back survives only as long as
       that prop never changes. Cheap and idempotent. */
    const on = enabled && !gaveUp.current;
    inner.classList.toggle("wm-motion", on);
    /* See `motionOff` and `motionOn`. */
    if (on !== motionWas.current) {
      if (!on) motionOff(inner);
      else if (motionWas.current === false) motionOn(inner);
      motionWas.current = on;
    }
    const seen = shown.current;
    const liveIds = new Set<string>();
    for (const el of inner.querySelectorAll<HTMLElement>("[data-node-id]")) {
      const id = el.dataset.nodeId ?? "";
      liveIds.add(id);
      const box = boxOf(el);
      box.dataset.wmBox = "";
      if (seen.has(id)) box.dataset.wmShown = "";
    }
    /*
     * Forget any card that is no longer on the page.
     *
     * A reveal is monotonic in one sense only: a card that is still present
     * is never hidden again. It was never meant to mean that a card which
     * left and came back must not animate — GOTCHAS #2 is a card re-hidden
     * mid-reveal while on screen. Kept forever, the record made a re-opened
     * branch pop in with no arrival, and since opening a scenario in one
     * branch now closes its copy in another, re-opening is routine.
     *
     * Safe against the cases that made the record key by id in the first
     * place: a far-mode flip replaces the element but keeps the id in the
     * same commit, so the id is never absent; windowed rows only engage
     * above ROOT_WINDOW_AT, which is always LITE, where motion is off; and
     * panning never unmounts anything. A node id is tied to one position, so
     * there is no same-id remount elsewhere left to guard against.
     */
    for (const id of seen) if (!liveIds.has(id)) seen.delete(id);

    if (!on) return;
    const now = performance.now();
    const liveKeys = new Set<string>();
    let held = false;
    for (const path of inner.querySelectorAll<SVGPathElement>("path[data-edge]")) {
      const key = path.dataset.edge;
      if (!key || path.hasAttribute("data-hit")) continue;
      liveKeys.add(key);
      /* Recomputed from `drawn` every commit rather than only ever added.
         React reuses `<path>` elements across edge keys — a group's members
         change and the same node comes back as a different edge — so an
         attribute that is only ever set can end up on an element that now
         represents a line which has already been drawn, and hold it
         invisible for good. The hold is a pure function of what has been
         drawn and what this element currently is. */
      const hold = holderFor(path);
      if (drawn.current.has(key)) {
        hold.removeAttribute("data-wm-undrawn");
        continue;
      }
      hold.setAttribute("data-wm-undrawn", "");
      if (!heldSince.current.has(key)) heldSince.current.set(key, now);
      held = true;
    }
    /* Same rule for lines: one that left and came back is drawn again, and is
       judged against its new cards, not the wait it had. */
    for (const key of drawn.current) if (!liveKeys.has(key)) drawn.current.delete(key);
    for (const key of heldSince.current.keys()) if (!liveKeys.has(key)) heldSince.current.delete(key);
    for (const key of shownSince.current.keys()) if (!liveKeys.has(key)) shownSince.current.delete(key);
    for (const key of queued.current) if (!liveKeys.has(key)) queued.current.delete(key);
    /* A line whose cards had already landed when it appeared draws from here. */
    if (held) evaluate();
  });

  /*
   * Forget every reveal, so the next thing rendered arrives rather than
   * appearing. Called on a view change, and on an *ascent* — see
   * `changeLayer`, which is the only other place a whole screen's worth of
   * content should re-announce itself.
   *
   * Everything is reset together on purpose: the shown set, the observer's
   * record of what it has already handed out, and the attributes the
   * stylesheet reads. Clearing only the set would leave every card marked
   * shown and unobserved — visible, and never animating again.
   */
  const resetReveal = useCallback(() => {
    stopAll();
    shown.current = new Set();
    drawn.current = new Set();
    heldSince.current = new Map();
    shownSince.current = new Map();
    reported.current = false;
    gaveUp.current = false;
    observed.current = new WeakSet();
    window.clearTimeout(edgeHold.current);
    edgeHold.current = 0;
    const inner = innerElement();
    if (!inner) return;
    for (const el of inner.querySelectorAll<HTMLElement>("[data-node-id]"))
      delete boxOf(el).dataset.wmShown;
  }, [innerElement]);

  /* A new workflow. Keyed on nothing a fit, settle or resize can touch —
     re-running an entrance from a function that fires often re-applies its
     start keyframe mid-tween and leaves cards at opacity 0 for good.
     Deliberately NOT keyed on the layer: node identity is meaningful across
     rungs, and a card that stands for the same node on two rungs should
     stay put while its new siblings arrive around it. */
  useEffect(() => {
    resetReveal();
  }, [viewKey, resetReveal]);

  /* The observer itself. Built once per view / per enabled-flip, never per
     render: rebuilding it would restart its asynchronous first callback, and
     during a zoom glide that is ten times in 160 ms. */
  useEffect(() => {
    const inner = innerElement();
    if (!inner) return;

    /* Motion off (reduced motion, LITE, no IntersectionObserver): reveal
       everything and drop the hiding rule. The map has to be completely
       usable with this hook doing nothing at all. */
    if (!enabled || typeof IntersectionObserver === "undefined") {
      for (const el of inner.querySelectorAll<HTMLElement>("[data-node-id]")) {
        const box = boxOf(el);
        box.dataset.wmShown = "";
        box.style.opacity = "";
        box.style.transform = "";
      }
      return;
    }

    /* The failsafe. If the observer never reports — a detached root, a
       browser quirk, an exception upstream — the reveal gives up and the map
       renders plainly. Nothing in a motion layer may be able to leave a card
       invisible, so this does not merely mark the cards present right now:
       it latches, and the layout effect above then stops applying the hiding
       class at all, which also covers every card that appears afterwards. */
    window.clearTimeout(failsafe.current);
    failsafe.current = window.setTimeout(() => {
      if (reported.current) return;
      gaveUp.current = true;
      inner.classList.remove("wm-motion");
      motionOff(inner);
      motionWas.current = false;
    }, REVEAL_FAILSAFE_MS);

    /* Where a card starts. Inside the window after a layer change it starts
       displaced toward the point that was clicked, so the new layer visibly
       comes out of that element; a card near the origin barely moves and one
       at the far edge sweeps, which is the radial parting the handoff
       describes, taken from the geometry rather than from per-sibling
       bookkeeping. Outside that window it is the plain rise. */
    const startFor = (box: HTMLElement): string => {
      const a = arrival.current;
      if (!a || performance.now() > a.until) return REVEAL_FROM;
      const r = box.getBoundingClientRect();
      return arriveFrom(
        (a.x - (r.left + r.width / 2)) * ARRIVE_PULL,
        (a.y - (r.top + r.height / 2)) * ARRIVE_PULL,
      );
    };

    const reveal = (el: HTMLElement, id: string, delayMs: number) => {
      shown.current.add(id);
      const box = boxOf(el);
      /* Settled first: its settle takes `data-wm-revealing` off, which must
         not happen to the reveal starting here. */
      const prev = running.current.get(id);
      if (prev) {
        prev.stop();
        window.clearTimeout(prev.timer);
        prev.settle();
        /* No late pass here: the new tween below claims this element in the
           same tick and writes both properties every frame, so it overwrites
           anything the stopped one commits afterwards. */
      }
      /* Order matters. Put the box at opacity 0 inline *before* dropping the
         hiding rule, so there is no frame in which neither is holding it
         down — Motion applies its first keyframe on the next frame, and
         that gap would read as a card flashing in and then out again. */
      box.style.opacity = "0";
      /* Rule one, at the element level: a per-frame update carries no
         transition. `[data-wm-box]` has a 340 ms opacity/transform
         transition for the selection dim, and leaving it on while Motion
         writes both properties every frame makes each frame chase the last
         — which reads as smearing, not smoothness. Dropped for the length
         of the tween and restored by `settle`. */
      box.dataset.wmRevealing = "";
      box.dataset.wmShown = "";
      const controls = animate(
        box,
        /* Explicit identity as the end state, never `'none'`: Motion parses
           `'none'` to scale 0 and the card renders 0×0 — present in the DOM,
           correct text, invisible and unclickable. */
        { opacity: [0, 1], transform: [startFor(box), IDENTITY] },
        { duration: REVEAL_MS / 1000, ease: EASE_OUT, delay: delayMs / 1000 },
      );
      /* Invariant 2: give the element back. A timer, never `.finished`. Taking
         `data-wm-revealing` off is the card landing, so the lines waiting on
         it are checked on the same tick. */
      const settle = () => {
        box.style.opacity = "";
        box.style.transform = "";
        delete box.dataset.wmRevealing;
        running.current.delete(id);
      };
      const timer = window.setTimeout(() => {
        settle();
        evaluateRef.current();
      }, delayMs + REVEAL_MS + 40);
      running.current.set(id, { stop: () => controls.stop(), settle, timer });
    };

    /* One observer, rooted at the scroll viewport. Its first callback
       carries everything already on screen — that batch, staggered in DOM
       order, *is* the entrance. Every later callback carries whatever the
       pan just brought into view, usually one card, which therefore gets no
       delay at all. Entrance and reveal-on-pan are one code path; only the
       batch size differs. A fit, which brings the whole map into view at
       once, is the same path again and cascades. */
    const io = new IntersectionObserver(
      (entries) => {
        reported.current = true;
        const arriving = entries
          .filter((e) => e.isIntersecting)
          .map((e) => e.target as HTMLElement)
          .filter((el) => {
            const id = el.dataset.nodeId;
            return !!id && !shown.current.has(id);
          });
        if (arriving.length === 0) return;
        /* DOM order, so a batch reads top-to-bottom rather than in whatever
           order the observer happened to collect it. */
        arriving.sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1,
        );
        arriving.forEach((el, i) => {
          io.unobserve(el);
          reveal(
            el,
            el.dataset.nodeId as string,
            staggerAt(i, arriving.length, REVEAL_STAGGER_MS, REVEAL_STAGGER_CAP_MS),
          );
        });
      },
      { root: scrollElement(), rootMargin: REVEAL_MARGIN, threshold: 0 },
    );
    observer.current = io;
    observed.current = new WeakSet();

    return () => {
      io.disconnect();
      if (observer.current === io) observer.current = null;
      window.clearTimeout(failsafe.current);
    };
  }, [viewKey, enabled, innerElement, scrollElement, motionOff]);

  /* Hand the observer anything that has appeared since — an unfold, a
     far-mode flip, a windowed row scrolling into the window. Every render,
     because there is no single signal for "the node set changed"; the body
     is a querySelectorAll and a Set check, and renders here are occasional,
     never per-frame. */
  useEffect(() => {
    const io = observer.current;
    const inner = innerElement();
    if (!io || !inner) return;
    for (const el of inner.querySelectorAll<HTMLElement>("[data-node-id]")) {
      const id = el.dataset.nodeId;
      if (!id || shown.current.has(id) || observed.current.has(el)) continue;
      observed.current.add(el);
      io.observe(el);
    }
  });

  /* ---- 2. edges drawing themselves -----------------------------------

     Lines are drawn by `evaluate`, above, as their cards land. */

  /* ---- 3. the selected step comes forward ---------------------------- */

  /*
   * "Super easy to look into the details of a step" is the part of this that
   * is not garnish. The selected card lifts toward the viewer and everything
   * unrelated recedes — declaratively, through two data attributes and the
   * `.wm-motion` block in globals.css, so nothing here can strand an inline
   * style on a card React is about to reuse.
   *
   * The neighbour set is read off the edge paths' own `data-from` /
   * `data-to`, which `MapEdges` already writes. No model coupling: whatever
   * the tree draws as connected is what stays lit.
   */
  useEffect(() => {
    const inner = innerElement();
    if (!inner) return;
    const cards = inner.querySelectorAll<HTMLElement>("[data-node-id]");
    if (!enabled || !selectedId) {
      for (const el of cards) {
        const box = boxOf(el);
        delete box.dataset.wmSel;
        delete box.dataset.wmNear;
      }
      return;
    }
    const near = new Set<string>([selectedId]);
    for (const p of inner.querySelectorAll<SVGPathElement>("path[data-edge]")) {
      const { from, to } = p.dataset;
      if (from === selectedId && to) near.add(to);
      if (to === selectedId && from) near.add(from);
    }
    for (const el of cards) {
      const id = el.dataset.nodeId;
      const box = boxOf(el);
      if (id === selectedId) box.dataset.wmSel = "";
      else delete box.dataset.wmSel;
      if (id && near.has(id)) box.dataset.wmNear = "";
      else delete box.dataset.wmNear;
    }
  }, [selectedId, enabled, innerElement]);

  /* ---- 4. the layer change — the map's primary animation ------------- */

  /*
   * A ladder is descended on purpose, so the transition has one job: make it
   * obvious that you moved *into* something, and where you came from.
   *
   * Two phases with a timer between them. Phase 1 scales the content up
   * about the clicked element's own screen position and dims it; the state
   * change lands just inside that movement; phase 2 is the new layer's cards
   * arriving out of the same point, which the reveal pipeline above already
   * does once `arrival` is set.
   *
   * Aiming at the clicked point rather than the viewport centre is the whole
   * trick — it is what reads as falling toward the thing you clicked instead
   * of a generic zoom, and it is the same thing the handoff's camera maths
   * does, expressed as a transform-origin instead of a scroll offset.
   *
   * Three things it deliberately does not do:
   *
   *  - **It never touches the camera.** Zoom and pan are free roam and belong
   *    to the user; a descent that moved them would mean the map changed
   *    what it was showing because of where someone had dragged. The push is
   *    a transform on the content, cleared before the swap, so the camera is
   *    exactly where it was left.
   *  - **It never animates a departure.** The outgoing layer is dimmed as a
   *    whole and then removed; its cards are not tweened out. An exit tween
   *    owns an element's inline style right up to the moment React reuses
   *    that node.
   *  - **It never runs while anything is measuring.** The push lasts 190 ms
   *    and no model change has happened yet, so no measure loop is running —
   *    which matters, because a scale on the content box would otherwise be
   *    read as real geometry and every edge would be drawn to it.
   */
  const changeLayer = useCallback(
    ({ origin, direction, apply, reannounce }: ChangeLayerOptions) => {
      const inner = innerElement();
      const sb = scrollElement();
      const up = direction === "up";
      /* Motion off, or nothing to animate on: navigate immediately. The
         ladder has to work identically with no animation at all. */
      if (!enabled || !inner) {
        apply();
        return;
      }

      /* A swap already waiting must land, not be forgotten. Two rung
         changes inside 175 ms — a double click, or a click landing on a
         programmatic one — would otherwise cancel the first timer and drop
         its `apply()` entirely, silently losing a state change and leaving
         the ladder on a rung nobody asked for. Flush it, in order, then
         start this one. */
      flushSwap.current?.();
      window.clearTimeout(layerTimer.current);
      window.clearTimeout(pushGuard.current);

      /* Where the movement is aimed. Viewport coordinates, because that is
         what the arriving cards will be measured in. */
      const vr = sb?.getBoundingClientRect();
      const or_ = origin?.getBoundingClientRect();
      const ax = or_ ? or_.left + or_.width / 2 : (vr?.left ?? 0) + (vr?.width ?? 0) / 2;
      const ay = or_ ? or_.top + or_.height / 2 : (vr?.top ?? 0) + (vr?.height ?? 0) / 2;

      const swapMs = up ? PULL_SWAP_MS : PUSH_SWAP_MS;
      const pushMs = up ? PULL_MS : PUSH_MS;

      /*
       * The push is a CSS state change, not a tween — see motion.ts. Its
       * numbers are handed to the stylesheet as custom properties so they
       * keep one home; `transform-origin` is per-click, so it stays inline.
       *
       * transform-origin is in the content box's own coordinates, so the
       * scale happens about the clicked element wherever it sits — divided
       * by the camera's zoom, because client rects come back in visual
       * pixels while `transform-origin` px are local and the box carries CSS
       * `zoom`. Without that the dive aims correctly only at 100% and drifts
       * further off the further you are from it.
       *
       * Reading the rect first also flushes layout, which is what guarantees
       * the transition has a resolved starting value to run from.
       */
      const ir = inner.getBoundingClientRect();
      const z = Number(inner.dataset.zoom) || 1;
      inner.style.transformOrigin = `${(ax - ir.left) / z}px ${(ay - ir.top) / z}px`;
      inner.style.setProperty("--wm-push-ms", `${pushMs}ms`);
      inner.style.setProperty("--wm-push-scale", String(up ? PULL_SCALE : PUSH_SCALE));
      inner.style.setProperty("--wm-push-fade", String(PUSH_FADE));
      inner.dataset.wmPush = direction;

      const swap = () => {
        if (flushSwap.current !== swap) return; // already run
        flushSwap.current = null;
        window.clearTimeout(layerTimer.current);
        layerTimer.current = 0;
        /*
         * ORDERING CONTRACT — the content box is handed back *before*
         * `apply()` is called, and nothing may be inserted between them.
         *
         * Two separate things depend on it. A container still holding a
         * scale would make every card land in the wrong place and every edge
         * be measured against it. And `canvas-build`'s scroll anchoring
         * records the clicked card's viewport rect inside `apply` and
         * corrects the scroll by the delta once the rung commits — if the
         * push were still applied, that rect would be inflated about the
         * transform origin and the correction would put the reader
         * somewhere they did not ask to be, on every single descent.
         *
         * This ordering is what makes a descent feel anchored: the card the
         * reader clicked is left pixel-identical and the new rung
         * materialises around it, with no camera move at all. Do not
         * reorder the swap without telling `canvas-build` first.
         */
        releaseBox(inner);
        /*
         * Descending keeps the reveal record, so a card that exists on both
         * rungs stays exactly where it is while its new siblings fly in
         * around it. That continuity is the whole reason a descent is
         * legible rather than a screen swap, and it is free: the reveal is
         * keyed by node id, and the model guarantees the id survives.
         *
         * Ascending has the opposite problem — going back out usually adds
         * no cards at all, only removes them, so with the record kept
         * nothing would animate and the pull would end in a snap. So an
         * ascent forgets, and the rung you return to arrives properly. Same
         * thing the handoff's pull-out does when it re-reveals the whole
         * district grid.
         */
        const announce = reannounce ?? up;
        if (announce) resetReveal();
        /* The thread to the next layer: cards revealed from here until the
           window expires fly out of the point that was clicked. */
        arrival.current = { x: ax, y: ay, until: performance.now() + ARRIVE_WINDOW_MS };
        apply();
        /*
         * No resolve tween. Taking `data-wm-push` off removes the transition
         * along with the transformed state, so the box is back at identity
         * in the same tick — which is what the ordering contract above needs
         * and what a collapse should read as anyway: something receded and
         * went away. An imperative fade back was tried here and removed; it
         * was the second animation on this element able to strand it, for a
         * 200 ms brightness change nobody asked for.
         */
      };
      flushSwap.current = swap;
      layerTimer.current = window.setTimeout(swap, swapMs);
      /* And unconditionally, whatever happened to the timer. */
      pushGuard.current = window.setTimeout(() => releaseBox(inner), pushMs + 400);
    },
    [enabled, innerElement, scrollElement, resetReveal],
  );

  /* A push must never outlive the component, and must never be the reason a
     content box is left holding a transform. */
  useEffect(
    () => () => {
      window.clearTimeout(layerTimer.current);
      window.clearTimeout(pushGuard.current);
      flushSwap.current = null;
      const inner = innerElement();
      if (inner) releaseBox(inner);
    },
    [innerElement],
  );

  /* ---- 4. the camera, when it moves on its own ----------------------- */

  /*
   * Programmatic moves are eased; direct manipulation is not.
   *
   * `useMapCamera` already holds both halves for zoom. This is the pan half:
   * centring on what you just clicked is the map's most frequent move, and
   * until now it was the browser's own `behavior: "smooth"` — a duration and
   * a curve chosen by the user agent, different in every browser and the one
   * move on the screen not using the design system's ease.
   *
   * Motion drives it, over a single 0 → 1 value, so the curve is exactly the
   * `--ease-out` every other transition uses.
   */
  const panning = useRef<{ stop: () => void } | null>(null);

  const stopPan = () => {
    panning.current?.stop();
    panning.current = null;
  };

  /* Touching the canvas ends an eased move immediately — a camera that keeps
     flying while you drag is the definition of fighting the user. `pointerdown`
     on the document rather than the viewport so the toolbar's zoom and Fit
     buttons cancel it too; `wheel` for trackpad pans and pinch-zoom, which
     produce no pointer event at all. */
  useEffect(() => {
    const sb = scrollElement();
    const onWheel = () => stopPan();
    document.addEventListener("pointerdown", stopPan, true);
    sb?.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", stopPan, true);
      sb?.removeEventListener("wheel", onWheel);
      stopPan();
    };
  }, [scrollElement]);

  const panTo = useCallback(
    (el: HTMLElement | null): boolean => {
      const sb = scrollElement();
      if (!sb || !el || !enabled) return false;
      const sr = sb.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const dx = er.left + er.width / 2 - (sr.left + sr.width / 2);
      const dy = er.top + er.height / 2 - (sr.top + sr.height / 2);
      /* Already centred. Moving two pixels reads as a twitch, not a camera. */
      if (Math.abs(dx) < PAN_MIN_PX && Math.abs(dy) < PAN_MIN_PX) return true;
      stopPan();
      const x0 = sb.scrollLeft;
      const y0 = sb.scrollTop;
      const controls = animate(0, 1, {
        duration: panMs(Math.hypot(dx, dy)) / 1000,
        ease: EASE_OUT,
        onUpdate: (p) => {
          sb.scrollLeft = x0 + dx * p;
          sb.scrollTop = y0 + dy * p;
        },
      });
      panning.current = { stop: () => controls.stop() };
      return true;
    },
    /* `enabled` in the deps rather than in a ref: it only changes when the
       map crosses LITE_AT or the reduced-motion query flips, so the one
       extra tree render that costs is worth not writing a ref during
       render. */
    [scrollElement, enabled],
  );

  /* Stable across renders. `focusLater` depends on this, and through it so do
     `onClick` and `onToggle` — a fresh object here would give every card a
     new handler on every render and defeat `StepNode`'s memo on a 150-node
     tree. */
  return useMemo(() => ({ panTo, changeLayer }), [panTo, changeLayer]);
}
