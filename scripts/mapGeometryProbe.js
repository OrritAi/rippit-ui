/*
 * The geometry probe — the half of `check-map-geometry.py` that runs in the
 * page. Kept as its own file so it is readable, lintable and diffable rather
 * than buried in a Python string literal.
 *
 * Its main export is `globalThis.__wmProbe`. It answers one question:
 * **is every line on the map attached to the two cards it claims to join?**
 *
 * It re-derives the answer from scratch — fresh `getBoundingClientRect()`
 * calls and the `d` attribute actually in the DOM — so it shares nothing with
 * `useMapMeasure`, which is the point: a bug in the measure hook cannot hide
 * from a checker that uses the measure hook's own numbers.
 *
 * The endpoint contract it checks is the one `useMapMeasure` documents:
 *
 *   plain edge   start = source right edge + EDGE_PAD, on its rail
 *                end   = target left edge  − EDGE_PAD, on its rail
 *                (a card's rail is CHAIN_RAIL_Y below its top; a pill's, and
 *                that of a card shorter than two rail heights, is its centre)
 *   chain link   start = source right edge + EDGE_PAD, on the target's rail
 *                end   = target left edge  − EDGE_PAD, CHAIN_RAIL_Y below its top
 *                (data-anchor="h"; the rail is the target's, and it must still
 *                cross the source card, or the line runs beside it)
 *   column link  start = source bottom + EDGE_PAD, at the target's left + DROP_X
 *                end   = target top    − EDGE_PAD, at its left + DROP_X
 *                (data-anchor="v"; the column is the target's, and it must still
 *                cross the source card)
 *   drop         start = source bottom + EDGE_PAD, DROP_X in from its left edge
 *                end   = target left-centre − EDGE_PAD   (data-anchor="drop")
 *   fan-out stub starts ON its trunk, so its start is the trunk's first point
 *                (which is the parent's right edge on its rail — the trunk is
 *                checked against the parent itself), whether it turns up or down: a
 *                fan centred on its branches has stubs on both sides, and a
 *                trunk with a leg each way starts every leg at the parent
 *   fan-in stub  ends ON its trunk, so its end is the trunk's last point
 *
 * The failure classes, in the order they cost a reader:
 *
 *   ORPHAN   a path claiming a node that is not rendered — a line in empty
 *            space, which is the bug this file exists for
 *   OFFSET   both nodes rendered, but an end point is off its card
 *   EARLY    a line on screen while one of its cards is still arriving — the
 *            moment a line and its card come apart. Checked inside draws
 *   PILL     a connection pill joined to a step that is not the one making the
 *            call — the founder's pill that jumped between branches
 *   DASH     an inline `stroke-dasharray` that no longer matches the path's
 *            own length: the draw tween's dash computed against an older `d`,
 *            which renders the line as floating fragments
 *   HELD     a line still carrying `data-wm-undrawn` after everything settled,
 *            though every card it joins has been shown — invisible, so the
 *            shape of the workflow is simply missing. A line held for a card
 *            never yet shown is waiting for a pan, and is counted apart
 *   FAILSAFE a line the hold's failsafe had to release (`data-wm-failsafe` on
 *            its holder): visible now, but only because its own draw never
 *            came — a defect the failsafe hid, not a pass
 *   STALE-HOLD  a line still carrying `data-wm-undrawn` with the motion layer
 *            off. The hiding rule is `.wm-motion [data-wm-undrawn]`, so the
 *            line is painted — but the hold outlived the class it belongs to,
 *            and hides the line again the moment motion comes back on
 *   ALIGN    two cards a line joins, off the grid the layout puts them on: a
 *            column link's (`"v"`) cards not sharing a left edge, or a chain
 *            link's (`"h"`) two steps not sharing a top. Settled samples only,
 *            and judged where the layout put each card: a hover lift or a
 *            selected card's growth is taken back out first, since neither
 *            moves a card off the grid. A chain link from a pill is not
 *            judged — a pill that starts a row is nudged onto the rail
 *
 * A hold means something only while the motion layer is on: under LITE and
 * reduced motion `.wm-motion` is off and nothing is hidden, whatever attribute
 * is left on a line. So holds are read against the class at every sample, never
 * once per page — a press that takes the map past LITE_AT switches motion off
 * in the same commit.
 */

/*
 * Instrumentation — when frames happened, what held them up, and the last click.
 *
 * This file is installed before any page script runs, so these see every frame
 * and every long frame from the first.
 *
 *   __wmFrameGap(ts)   how long before the frame with rAF timestamp `ts` the
 *                      previous frame ran. A sample taken in the first frame
 *                      after a main-thread stall says so by this alone.
 *   __wmLastClick      when the last click landed, on the page clock.
 *   __wmLongFrames     long animation frames with their script attribution —
 *                      or long tasks, where this browser has no LoAF;
 *                      `__wmLongFrameKind` says which, and the stamp prints it.
 */
(() => {
  /* Outside a page — the verdict checks load this file under node for its pure
     functions — there are no frames to watch. */
  if (typeof requestAnimationFrame !== "function") return;
  const beat = { prev: 0, last: 0 };
  const frame = (ts) => {
    beat.prev = beat.last;
    beat.last = ts;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  /* Every callback in one frame gets the same timestamp, so whether this
     frame's beat has run yet is readable from it. */
  globalThis.__wmFrameGap = (ts) => Math.round(ts - (beat.last === ts ? beat.prev : beat.last));

  globalThis.__wmLastClick = null;
  addEventListener(
    "click",
    () => {
      globalThis.__wmLastClick = performance.now();
    },
    { capture: true },
  );

  /* The last few hundred: a transition is read within seconds of its click. */
  const KEEP = 400;
  const long = [];
  const types = globalThis.PerformanceObserver?.supportedEntryTypes ?? [];
  const kind = types.includes("long-animation-frame") ? "long-animation-frame" : types.includes("longtask") ? "longtask" : null;
  globalThis.__wmLongFrameKind = kind;
  if (kind) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        long.push(entry);
        if (long.length > KEEP) long.shift();
      }
    }).observe({ type: kind, buffered: true });
  }
  const source = (url) => (url ? url.replace(/^.*\/_next\//, "").slice(-70) : "");
  /* Long frames overlapping [from, to], timed from `from`, each with its three
     longest scripts. A script without a URL is evaluated code — this file's own
     functions included, which is how a stall caused by the checker names it. */
  globalThis.__wmLongFramesBetween = (from, to) =>
    long
      .filter((e) => e.startTime + e.duration >= from && e.startTime <= to)
      .map((e) => ({
        at: Math.round(e.startTime - from),
        duration: Math.round(e.duration),
        blocking: Math.round(e.blockingDuration ?? 0),
        scripts: [...(e.scripts ?? [])]
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 3)
          .map((s) => ({
            invoker: s.invoker,
            source: source(s.sourceURL),
            fn: s.sourceFunctionName,
            duration: Math.round(s.duration),
            forcedLayout: Math.round(s.forcedStyleAndLayoutDuration ?? 0),
          })),
      }));
})();

(() => {
  /* The measure hook's own constants, from `tokens.ts`. Written out because
     this file runs in the page with nothing to import from; the verdict checks
     read both files and fail the moment the two disagree. */
  const EDGE_PAD = 5;
  const CHAIN_RAIL_Y = 27;
  const DROP_X = 27;
  globalThis.__wmTokens = { EDGE_PAD, CHAIN_RAIL_Y, DROP_X };

  /* A pill's id ends in its own `wf:<key>` segment, or is `wf:<key>` at the root. */
  const isPill = (id) => typeof id === "string" && id.slice(id.lastIndexOf("/") + 1).startsWith("wf:");
  /* Where a line with no anchor meets a card: on its rail, CHAIN_RAIL_Y below
     its top — or, for a pill (whose centre is what sits on a rail) or a card
     shorter than two rail heights (a far-mode tile), at its vertical centre. */
  const railY = (box, id) => (isPill(id) || box.bottom - box.top < 2 * CHAIN_RAIL_Y ? (box.top + box.bottom) / 2 : box.top + CHAIN_RAIL_Y);

  /*
   * Where a trunk is judged, from its card's box in user space and node id: a
   * fan-out trunk at its start, the parent's right edge + EDGE_PAD on the
   * parent's rail; a fan-in trunk at its end, the target's left edge −
   * EDGE_PAD on the target's rail — the viewed pill's centre.
   *
   * Pure, so the verdict checks can run it without a browser.
   */
  globalThis.__wmTrunkWant = (box, id, fanIn) => [fanIn ? box.left - EDGE_PAD : box.right + EDGE_PAD, railY(box, id)];

  /*
   * Where a line's two ends belong: its anchor, its cards' boxes in the edge
   * layer's user space (`{ left, top, right, bottom }`) and their ids, which
   * say whether a card is a pill. Offsets along a card — the rail, the drop
   * column — are in the card's own CSS pixels, which is that same space, so
   * they are added after the conversion and never to client pixels. An anchor
   * this does not know gets the plain rule: rail to rail.
   *
   * Pure, so the verdict checks can run it without a browser.
   */
  globalThis.__wmAnchorWant = (anchor, a, b, from, to) => {
    /* A chain link rides the target's rail — its source may be a pill nudged
       so its centre sits there — but at the source it must still meet the
       card: a rail outside the source's height is held to its nearest edge, so
       a line drawn beside the card is off it by exactly the miss. */
    if (anchor === "h") {
      const rail = b.top + CHAIN_RAIL_Y;
      return [a.right + EDGE_PAD, Math.min(Math.max(rail, a.top), a.bottom), b.left - EDGE_PAD, rail];
    }
    /* A column link runs down the target's puck column, which the layout
       keeps under the source's puck too; a column outside the source's width
       is held to its nearest edge, the same way a missed rail is. */
    if (anchor === "v") {
      const column = b.left + DROP_X;
      return [Math.min(Math.max(column, a.left), a.right), a.bottom + EDGE_PAD, column, b.top - EDGE_PAD];
    }
    if (anchor === "drop") return [a.left + DROP_X, a.bottom + EDGE_PAD, b.left - EDGE_PAD, (b.top + b.bottom) / 2];
    return [a.right + EDGE_PAD, railY(a, from), b.left - EDGE_PAD, railY(b, to)];
  };

  /*
   * Where the layout put a card: its box as drawn, with the transforms on it
   * taken back out, in the edge layer's user space.
   *
   * `layers` runs outermost first and ends with the card. Each is an element's
   * box as drawn (`rect`, user space) and its computed `transform`,
   * `translate`, `scale`, `rotate` and `transformOrigin`. A transform turns
   * about its own element's layout box, so each layer's box is found with the
   * layers above it already taken out. Returns null for what cannot be taken
   * out exactly — a rotation, a skew, a perspective, a flip, or a length that
   * is not in pixels.
   *
   * Pure, so the verdict checks can run it without a browser.
   */
  const NUMBER = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-z%]*)$/i;
  const numbers = (value, unit) => {
    if (!value || value === "none") return [];
    const out = [];
    for (const part of value.trim().split(/\s+/)) {
      const m = NUMBER.exec(part);
      if (!m || (m[2].toLowerCase() !== unit && !(m[2] === "" && Number(m[1]) === 0))) return null;
      out.push(Number(m[1]));
    }
    return out;
  };
  /* `rotate` may name an axis before its angle; only a zero angle turns nothing. */
  const unturned = (rotate) => {
    if (!rotate || rotate === "none") return true;
    const angle = NUMBER.exec(rotate.trim().split(/\s+/).pop() ?? "");
    return !!angle && Number(angle[1]) === 0;
  };
  /* A computed `transform` as [scale x, scale y, shift x, shift y], or null. */
  const scaleAndShift = (transform) => {
    if (!transform || transform === "none") return [1, 1, 0, 0];
    const m = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim());
    const v = m ? m[2].split(",").map(Number) : [];
    if (!m || !v.every(Number.isFinite)) return null;
    if (!m[1]) return v.length === 6 && v[1] === 0 && v[2] === 0 ? [v[0], v[3], v[4], v[5]] : null;
    return v.length === 16 && v[1] === 0 && v[4] === 0 && v[3] === 0 && v[7] === 0 && v[11] === 0 && v[15] === 1
      ? [v[0], v[5], v[12], v[13]]
      : null;
  };
  globalThis.__wmLayoutBox = (layers) => {
    const back = [];
    let box = null;
    for (const layer of layers) {
      const m = scaleAndShift(layer.transform);
      const t = numbers(layer.translate, "px");
      const s = numbers(layer.scale, "");
      const o = numbers(layer.origin, "px");
      if (!m || !t || !s || !o || !unturned(layer.rotate)) return null;
      /* CSS applies `translate`, then `scale`, then `transform`, all about the
         origin — together, one scale and one shift. */
      const [sx = 1, sy = sx] = s;
      const [tx = 0, ty = 0] = t;
      const [ox = 0, oy = 0] = o;
      const kx = sx * m[0];
      const ky = sy * m[1];
      const dx = tx + sx * m[2];
      const dy = ty + sy * m[3];
      if (!(kx > 0 && ky > 0)) return null;
      let { left, top, right, bottom } = layer.rect;
      for (const undo of back) {
        [left, top] = undo(left, top);
        [right, bottom] = undo(right, bottom);
      }
      /* Drawn edge = layout edge + origin × (1 − scale) + shift; drawn size = scale × size. */
      const x = left - ox * (1 - kx) - dx;
      const y = top - oy * (1 - ky) - dy;
      box = { left: x, top: y, right: x + (right - left) / kx, bottom: y + (bottom - top) / ky };
      const cx = x + ox;
      const cy = y + oy;
      back.push((px, py) => [cx + (px - dx - cx) / kx, cy + (py - dy - cy) / ky]);
    }
    return box;
  };

  /*
   * Whether an anchored pair's two cards sit on the grid the layout puts them
   * on, given where the layout put each (`layoutOf(id)`: a box, or null). A
   * column link's cards share a left edge, and a chain link's two steps share a
   * top: `{ edge, off, at }`, with `at` the two cards' edges. A chain link to or
   * from a pill has no such rule — a pill that starts a row is nudged so its
   * centre, not its top, sits on the rail — and nor does any other anchor:
   * null. A pair with a card whose layout could not be read is unjudged
   * (`off: null`), never passed.
   *
   * Pure, so the verdict checks can run it without a browser.
   */
  globalThis.__wmAlign = (anchor, from, to, layoutOf) => {
    const edge = anchor === "v" ? "left" : anchor === "h" && !isPill(from) && !isPill(to) ? "top" : null;
    if (!edge) return null;
    const a = layoutOf(from);
    const b = layoutOf(to);
    if (!a || !b) return { edge, off: null };
    return { edge, off: +Math.abs(a[edge] - b[edge]).toFixed(1), at: [+a[edge].toFixed(1), +b[edge].toFixed(1)] };
  };

  const NUM = /-?\d+(?:\.\d+)?/g;
  const nums = (d) => (d.match(NUM) ?? []).map(Number);
  globalThis.__wmNumbers = nums;

  /*
   * The two points a line is judged at, from the numbers in its own `d` and in
   * its trunk's: its own first and last point — except that a fan-out stub
   * starts where its trunk does, at the parent, and a fan-in stub ends where
   * its trunk does, at the target. Which side of the parent's row a stub turns
   * toward changes neither, so a fan centred on its branches is judged exactly
   * like one hanging below its parent. Null when an end has no point to read.
   *
   * Pure, so the verdict checks can run it without a browser.
   */
  globalThis.__wmJudgedEnds = (own, trunk, fanIn) => {
    const start = trunk && !fanIn ? trunk : own;
    const end = trunk && fanIn ? trunk : own;
    if (start.length < 2 || end.length < 2) return null;
    return [start[0], start[1], end[end.length - 2], end[end.length - 1]];
  };

  /*
   * Which ends of a line are on screen, from its dash.
   *
   * The motion layer draws a line by setting `stroke-dasharray` to the path's
   * length and tweening `stroke-dashoffset` from that length to 0, so the dash
   * covers the path from its start to `dasharray − dashoffset`. The start is on
   * screen from the first frame any of it is drawn; the far end only once the
   * dash reaches the path's length *now*, which differs from the length the
   * dash was set for when the path is re-measured mid-draw. A line with no dash
   * is not drawing, and both its ends are wherever its hold and opacity put
   * them — which `visible` decides.
   *
   * Pure, so it can be checked without a browser (`mapGeometryVerdict.check.py`).
   */
  const REACHED_PX = 1;
  globalThis.__wmOnScreen = (dashArray, dashOffset, length) => {
    const dash = parseFloat(dashArray);
    if (!Number.isFinite(dash)) return { start: true, end: true };
    const offset = parseFloat(dashOffset);
    const drawn = dash - (Number.isFinite(offset) ? offset : 0);
    return { start: drawn > 0, end: drawn >= length - REACHED_PX };
  };
  /*
   * A card's reveal state, from the attributes the motion layer keeps on the
   * box it animates (`[data-wm-box]`, the card's parent):
   *
   *   shown      `data-wm-shown` — its reveal has been called. A card that has
   *              never been on screen has not, and a line to it is held until a
   *              pan reveals it; that is waiting, not stuck.
   *   arriving   `data-wm-revealing` — its reveal is still running, on the same
   *              clock as its landing. Not `getAnimations()`: the selection and
   *              hover lifts are transitions on the same box, and a card lifting
   *              3px under the pointer is not a card arriving.
   */
  const boxOf = (card) => card?.closest("[data-wm-box]") ?? null;
  globalThis.__wmCardArriving = (id) => {
    for (const el of document.querySelectorAll("[data-node-id]"))
      if (el.dataset.nodeId === id) return !!boxOf(el)?.hasAttribute("data-wm-revealing");
    return false;
  };
  const onScreen = (path) =>
    path && path.style.strokeDasharray
      ? globalThis.__wmOnScreen(path.style.strokeDasharray, getComputedStyle(path).strokeDashoffset, path.getTotalLength())
      : { start: true, end: true };

  globalThis.__wmProbe = function probe(tol, watch, opts) {
    const inner = document.querySelector("[data-zoom]");
    if (!inner) return { error: "no inner content box ([data-zoom]) on the page" };
    const svg = inner.querySelector("svg[data-edge-layer]");
    if (!svg) return { error: "no edge layer (svg[data-edge-layer]) inside the content box" };
    const z = Number(inner.dataset.zoom) || 1;

    /*
     * The frame of reference, taken from the edge layer itself rather than
     * computed.
     *
     * Path coordinates are in the SVG's user space. Getting from a card's
     * client rect back to that space means undoing the CSS `zoom` on the
     * content box — and also whatever else is on it at this instant, which
     * during a layer change is a `scale()` push. `getScreenCTM()` is the
     * browser's own answer to that question, so a transient transform that
     * moves cards and lines together (as it should) reads as attached here
     * instead of as a false alarm.
     */
    const ctm = svg.getScreenCTM();
    if (!ctm) return { error: "the edge layer has no screen CTM (not rendered?)" };
    const inv = ctm.inverse();
    const toUser = (x, y) => {
      const p = new DOMPoint(x, y).matrixTransform(inv);
      return [p.x, p.y];
    };
    const userBox = (r) => {
      const [left, top] = toUser(r.left, r.top);
      const [right, bottom] = toUser(r.right, r.bottom);
      return { left, top, right, bottom };
    };

    const nodes = new Map();
    for (const el of document.querySelectorAll("[data-node-id]")) {
      const id = el.dataset.nodeId;
      if (id) nodes.set(id, el);
    }
    const rects = new Map();
    const rectOf = (id) => {
      if (rects.has(id)) return rects.get(id);
      const el = nodes.get(id);
      const r = el ? el.getBoundingClientRect() : null;
      rects.set(id, r);
      return r;
    };
    /** A row the browser skipped (`content-visibility`) has no layout yet. */
    const laidOut = (r) => !!r && !(r.width === 0 && r.height === 0);
    /*
     * Can a reader see this right now?
     *
     * Both of the map's motion holds resolve to `opacity: 0` — a card before
     * its reveal and a line before its draw — and `checkVisibility` accounts
     * for an ancestor's opacity, which is where the card's lives. It matters
     * because an offset is only a bug if someone can watch it: mid-entrance,
     * a card that has not arrived and a line that has not been drawn are both
     * invisible, and holding them to the settled contract would report motion
     * as breakage. Everything visible is held to it.
     */
    const visible = (el) =>
      typeof el.checkVisibility === "function"
        ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
        : true;

    const trunkNums = new Map();
    const trunkPaths = new Map();
    for (const p of inner.querySelectorAll("path[data-trunk]")) {
      trunkNums.set(p.dataset.trunk, nums(p.getAttribute("d") ?? ""));
      trunkPaths.set(p.dataset.trunk, p);
    }

    /* The widest fan-out drawn, in arms. Trunk-and-stub routing only switches
       on at ELBOW_AT children, so a sweep that never drew a wide fan-out never
       tested that path at all — and it is the path a nine-outcome router takes.
       Reported rather than assumed, like the fold plan: a run should say what
       it covered. Fan-in trunks (`trunkin:`) are a different shape and are not
       counted here. */
    const arms = new Map();
    for (const p of inner.querySelectorAll("path[data-stub]:not([data-hit])")) {
      const trunk = p.dataset.stub;
      if (trunk && trunk.startsWith("trunk:")) arms.set(trunk, (arms.get(trunk) ?? 0) + 1);
    }
    const widestFanOut = Math.max(0, ...arms.values());

    const problems = [];
    const touched = new Set();
    let checked = 0;
    let skipped = 0;
    let drawn = 0;
    const pills = [];
    /* The largest offset on a line a reader can see, whether or not it passes
       the tolerance. A failure count says whether something crossed the line;
       this says how close everything came, which is what a timing change that
       might release a line a few frames before its card lands needs watching
       by. Visibility is only checked past 2px, where it could matter. */
    let maxVisibleOff = 0;
    let maxVisibleKey = null;
    /* Lines whose far end the draw has not reached yet: judged at their start
       only, or not at all if nothing of them is drawn. Counted apart from
       `skipped`, which is a card with no layout. */
    let notDrawnYet = 0;
    /* The largest gap between a drawing line's dash and its own length, pass or
       fail — a dash computed against a `d` that has moved since. */
    let maxDashDelta = 0;
    let maxDashKey = null;
    /* Line ends actually compared with their cards — a drawn start, a reached
       far end. A run that samples inside draws and judges none has measured
       nothing there, however many samples it took. */
    let endsJudged = 0;
    /* Held lines waiting for a card that has never been shown: expected, and
       counted apart from HELD. */
    let heldUnrevealed = 0;
    /* Whether a hold hides anything right now. */
    const motionOn = inner.classList.contains("wm-motion");
    const shown = (id) => !!boxOf(nodes.get(id))?.hasAttribute("data-wm-shown");
    const arriving = (id) => !!boxOf(nodes.get(id))?.hasAttribute("data-wm-revealing");
    /* Where the layout put a card (`__wmLayoutBox`), read off the card and its
       motion box — the two elements that own a card's transforms: the hover
       lift on the card, the reveal and the selection's growth on the box. */
    const layouts = new Map();
    const layoutOf = (id) => {
      if (layouts.has(id)) return layouts.get(id);
      const el = nodes.get(id);
      const wrap = boxOf(el);
      const layers = (wrap && wrap !== el ? [wrap, el] : [el]).map((n) => {
        const cs = getComputedStyle(n);
        return {
          rect: userBox(n.getBoundingClientRect()),
          transform: cs.transform,
          translate: cs.translate,
          scale: cs.scale,
          rotate: cs.rotate,
          origin: cs.transformOrigin,
        };
      });
      const out = globalThis.__wmLayoutBox(layers);
      layouts.set(id, out);
      return out;
    };
    /* Alignment is judged only where asked: settled samples, with the limit in
       `opts.align`. Its problems are listed after every line's — a card off its
       column costs a reader less than a line off its card. */
    const alignLimit = opts?.align;
    const alignJudged = { v: 0, h: 0 };
    const alignUnjudged = { v: 0, h: 0 };
    const offGrid = [];

    const push = (kind, key, detail) => problems.push({ kind, key, ...detail });
    /* Lines asked about by key — the second look at ones that failed — with
       their offset whether it passes or not, or why it could not be taken. */
    const watching = new Set(watch ?? []);
    const watched = {};
    const note = (key, value) => {
      if (watching.has(key)) watched[key] = value;
    };

    for (const path of inner.querySelectorAll("path[data-edge]")) {
      if (path.hasAttribute("data-hit")) continue;
      drawn++;
      const key = path.dataset.edge ?? "";
      const d = path.getAttribute("d") ?? "";
      const n = nums(d);

      /* A dash the draw tween computed against a `d` that has since moved
         renders the line as fragments, wherever the path now runs. */
      const dash = path.style.strokeDasharray;
      if (dash) {
        const want = path.getTotalLength();
        const got = parseFloat(dash);
        if (Number.isFinite(want) && Number.isFinite(got)) {
          const delta = Math.abs(want - got);
          if (delta > maxDashDelta) {
            maxDashDelta = delta;
            maxDashKey = key;
          }
          if (delta > 1) push("DASH", key, { dashArray: +got.toFixed(1), pathLength: +want.toFixed(1), delta: +delta.toFixed(1) });
        }
      }
      /* A trunk carries no data-from/to; its endpoints come from its key. */
      const trunkKey = path.dataset.trunk;
      const ends = trunkKey ? [trunkKey.slice(trunkKey.indexOf(":") + 1)] : [path.dataset.from, path.dataset.to].filter(Boolean);
      /* `closest`, not the path's own dataset: the motion layer holds the
         whole `<g data-edge>` now that a group can carry an edge label as well
         as its line, so the attribute sits on the wrapper. A line counts as
         held only once every card it joins has been shown; before that it is
         waiting for a pan, and says so apart. */
      const marked = !!path.closest("[data-wm-undrawn]");
      const held = marked && motionOn;
      if (marked && !motionOn) push("STALE-HOLD", key, {});
      if (path.closest("[data-wm-failsafe]")) push("FAILSAFE", key, {});
      if (held) {
        if (ends.length > 0 && ends.every(shown)) push("HELD", key, {});
        else heldUnrevealed++;
      }
      /* The invariant the hold exists for: a line is never on screen while
         either of its cards is still arriving. Checked only where asked — the
         samples inside a draw — on every visible line that is not held, not
         only those still carrying a dash: a line whose card moves while it
         draws loses its dash to the move (`MapEdges`' `apply`) and shows solid,
         which is the same line on screen early, drawn all at once. */
      if (opts?.early && !held && visible(path)) {
        const early = ends.filter(arriving);
        if (early.length > 0) push("EARLY", key, { arriving: early });
      }

      if (trunkKey) {
        const fanIn = trunkKey.startsWith("trunkin:");
        const nodeId = trunkKey.slice(trunkKey.indexOf(":") + 1);
        const r = rectOf(nodeId);
        if (!nodes.has(nodeId)) {
          push("ORPHAN", key, { missing: nodeId, role: fanIn ? "fan-in target" : "fan-out parent", d: d.slice(0, 120) });
          note(key, "orphan");
          continue;
        }
        if (!laidOut(r)) {
          skipped++;
          note(key, "skipped");
          continue;
        }
        touched.add(nodeId);
        /* A fan-out trunk is checked at its start, a fan-in trunk at its end. */
        const shown = onScreen(path);
        if (!(fanIn ? shown.end : shown.start)) {
          notDrawnYet++;
          note(key, "not drawn yet");
          continue;
        }
        /* A fan-out trunk starts at its parent's right edge, on its rail; a
           fan-in trunk ends at its target's left edge, on its rail. */
        const want = globalThis.__wmTrunkWant(userBox(r), nodeId, fanIn);
        const got = fanIn ? [n[n.length - 2], n[n.length - 1]] : [n[0], n[1]];
        const off = Math.max(Math.abs(want[0] - got[0]), Math.abs(want[1] - got[1]));
        checked++;
        endsJudged++;
        note(key, +off.toFixed(1));
        if (off > 2 && off > maxVisibleOff && visible(path) && visible(nodes.get(nodeId))) {
          maxVisibleOff = off;
          maxVisibleKey = key;
        }
        if (off > tol)
          push("OFFSET", key, {
            off: +off.toFixed(1),
            hidden: !visible(path) || !visible(nodes.get(nodeId)),
            want: want.map((v) => +v.toFixed(1)),
            got: got.map((v) => +v.toFixed(1)),
            at: fanIn ? "end" : "start",
            node: nodeId,
            arriving: arriving(nodeId) ? [nodeId] : [],
          });
        continue;
      }

      const from = path.dataset.from;
      const to = path.dataset.to;
      if (!from || !to) continue;
      const missing = [];
      if (!nodes.has(from)) missing.push(from);
      if (!nodes.has(to)) missing.push(to);
      if (missing.length > 0) {
        push("ORPHAN", key, { missing: missing.join(", "), from, to, d: d.slice(0, 120) });
        note(key, "orphan");
        continue;
      }
      /* A connection pill's id is the id of the step that makes the call plus
         its own `wf:<target>` segment, so the only step a pill may hang off is
         the one its id names. A pill shown beside some other caller — the
         founder's jumping pill — is a line that lands squarely on two real
         cards and would pass every geometric check, which is why it is
         checked by identity here. Tree edges only: a join or jump into a pill
         is a different relationship. */
      if (path.dataset.kind === "tree") {
        const cut = to.lastIndexOf("/");
        if (cut > 0 && to.slice(cut + 1).startsWith("wf:")) {
          pills.push(to);
          const caller = to.slice(0, cut);
          if (from !== caller) push("PILL", key, { pill: to, from, caller });
        }
      }
      const a = rectOf(from);
      const b = rectOf(to);
      if (!laidOut(a) || !laidOut(b)) {
        skipped++;
        note(key, "skipped");
        continue;
      }
      touched.add(from);
      touched.add(to);
      const anchor = path.dataset.anchor;
      const aligned = alignLimit == null ? null : globalThis.__wmAlign(anchor, from, to, layoutOf);
      if (aligned && aligned.off == null) alignUnjudged[anchor]++;
      else if (aligned) {
        alignJudged[anchor]++;
        if (aligned.off > alignLimit) offGrid.push({ kind: "ALIGN", key, anchor, edge: aligned.edge, off: aligned.off, from, to, at: aligned.at });
      }

      const stub = path.dataset.stub;
      const fanInStub = !!stub && path.dataset.fanin === "true";
      const tn = stub ? trunkNums.get(stub) : null;
      if (stub && !tn) {
        push("ORPHAN", key, { missing: `trunk ${stub}`, from, to, d: d.slice(0, 120) });
        note(key, "orphan");
        continue;
      }
      const got = globalThis.__wmJudgedEnds(n, tn, fanInStub);
      if (!got) continue;

      /* The start a stub is checked at is its trunk's, and a fan-in stub's end
         is its trunk's too, so those ends are on screen when the trunk's are. */
      const startOn = onScreen(stub && !fanInStub ? trunkPaths.get(stub) : path).start;
      const endOn = onScreen(fanInStub ? trunkPaths.get(stub) : path).end;
      if (!endOn) notDrawnYet++;
      if (!startOn && !endOn) {
        note(key, "not drawn yet");
        continue;
      }

      const want = globalThis.__wmAnchorWant(anchor, userBox(a), userBox(b), from, to);
      const gap = want.map((w, i) => Math.abs(w - got[i]));
      const off = Math.max(startOn ? Math.max(gap[0], gap[1]) : 0, endOn ? Math.max(gap[2], gap[3]) : 0);
      checked++;
      endsJudged += (startOn ? 1 : 0) + (endOn ? 1 : 0);
      note(key, +off.toFixed(1));
      if (off > 2 && off > maxVisibleOff && visible(path) && visible(nodes.get(from)) && visible(nodes.get(to))) {
        maxVisibleOff = off;
        maxVisibleKey = key;
      }
      if (off > tol)
        push("OFFSET", key, {
          off: +off.toFixed(1),
          hidden: !visible(path) || !visible(nodes.get(from)) || !visible(nodes.get(to)),
          from,
          to,
          want: want.map((v) => +v.toFixed(1)),
          got: got.map((v) => +v.toFixed(1)),
          judged: startOn && endOn ? "both ends" : startOn ? "start only — far end not drawn yet" : "far end only",
          arriving: [from, to].filter(arriving),
        });
    }

    problems.push(...offGrid);

    /* A rendered card no line reaches. Informational: a lone root or a
       windowed row legitimately has none, so it is counted, never failed on. */
    const unconnected = [];
    for (const [id, el] of nodes) {
      if (touched.has(id)) continue;
      const r = el.getBoundingClientRect();
      if (!laidOut(r)) continue;
      unconnected.push(id);
    }

    return {
      zoom: z,
      /* Whether the content box is still the element the checker marked when
         the page loaded. A remount — a hot update Fast Refresh could not apply
         in place, a full reload — replaces it, and that resets every line's
         hold and draw along with it. */
      marked: inner.__wmMark === true,
      /* Which fold plan the canvas actually used. A snapshot whose shapes
         sidecar failed to load silently falls through to the graph fallback,
         which renders plausibly and is not the path production takes — so a
         run states this rather than leaving it inferable. */
      plan: document.querySelector("[data-plan]")?.getAttribute("data-plan") ?? "unknown",
      /* The map's own declaration that it is animating. Dropped under LITE and
         reduced motion, where `animateUnfold` deliberately runs no per-frame
         measure loop — so there, a line is contracted to land on the settled
         layout, not to follow a card across it. */
      motion: inner.classList.contains("wm-motion"),
      nodes: nodes.size,
      drawn,
      paths: checked,
      skipped,
      unconnected: unconnected.length,
      widestFanOut,
      pills,
      maxVisibleOff: +maxVisibleOff.toFixed(1),
      maxVisibleKey,
      notDrawnYet,
      endsJudged,
      heldUnrevealed,
      /* Pairs judged for alignment, and pairs a card transform the probe could
         not take out kept from being judged, each by anchor — null where the
         sample did not judge alignment. */
      alignJudged: alignLimit == null ? null : alignJudged,
      alignUnjudged: alignLimit == null ? null : alignUnjudged,
      maxDashDelta: +maxDashDelta.toFixed(1),
      maxDashKey,
      unconnectedIds: unconnected.slice(0, 8),
      problems: problems.slice(0, 40),
      problemCount: problems.length,
      watched,
    };
  };
})();

/*
 * The second look — what was moving when a settled line was found off its card.
 *
 * A failing settled sample says a line and its card disagreed at one instant.
 * Three different defects look exactly like that, and they have different
 * fixes:
 *
 *   still moving   a card, or something it sits in, was still animating: the
 *                  sample was taken before the layout settled, and the line
 *                  lands once the card does
 *   lagging        nothing was moving, and a later measure put the line back
 *                  on its own: the measure missed a layout change for a while
 *   left behind    nothing moves it back at all — the defect the checker
 *                  exists for
 *
 * `__wmExplain` reports the failing moment: every animation on either card or
 * on anything between it and the content box, every transform on that chain,
 * and how far each card drifted over a few frames — which catches a card moved
 * by script, where there is no Animation object to find. The checker tells the
 * other two apart by reading the line's offset again later (`__wmProbe`'s
 * `watch`).
 */
(() => {
  /* ~50ms at 60Hz: long enough for a card still animating to move measurably,
     short enough to describe the failing moment rather than what came after. */
  const DRIFT_FRAMES = 3;
  const frame = () => new Promise((done) => requestAnimationFrame(() => done()));
  const tail = (id) => id.slice(id.lastIndexOf("/") + 1).slice(0, 28);
  const describe = (el, inner) => {
    if (el === inner) return "content box";
    if (el.dataset.nodeId) return `card ${tail(el.dataset.nodeId)}`;
    const attr = Object.keys(el.dataset)[0];
    if (attr) return `${el.tagName.toLowerCase()}[data-${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
  };
  /* What an animation animates, whichever API started it. */
  const animated = (a) => {
    if (a.transitionProperty) return [a.transitionProperty];
    const skip = new Set(["offset", "computedOffset", "easing", "composite"]);
    const frames = a.effect?.getKeyframes?.() ?? [];
    return [...new Set(frames.flatMap((k) => Object.keys(k).filter((x) => !skip.has(x))))];
  };

  globalThis.__wmExplain = async function explain(problems) {
    const inner = document.querySelector("[data-zoom]");
    if (!inner) return [];
    const cards = new Map();
    for (const el of document.querySelectorAll("[data-node-id]")) if (el.dataset.nodeId) cards.set(el.dataset.nodeId, el);

    const looks = problems.map((p) => {
      const ends = (p.node ? [["card", p.node]] : [["from", p.from], ["to", p.to]]).map(([end, id]) => {
        const el = cards.get(id) ?? null;
        const chain = [];
        for (let n = el; n && n !== inner.parentElement; n = n.parentElement) chain.push(n);
        return { end, id, el, chain, before: el?.getBoundingClientRect() ?? null };
      });
      const shared = ends.length === 2 ? new Set(ends[0].chain.filter((n) => ends[1].chain.includes(n))) : new Set();
      const seen = new Set();
      const chain = [];
      for (const e of ends) {
        for (const n of e.chain) {
          if (seen.has(n)) continue;
          seen.add(n);
          const animations = n.getAnimations().map((a) => {
            const timing = a.effect?.getComputedTiming?.();
            return {
              what: a.animationName || (a.transitionProperty ? "transition" : a.id || "script"),
              props: animated(a),
              state: a.pending ? "pending" : a.playState,
              progress: timing?.progress == null ? null : +timing.progress.toFixed(2),
            };
          });
          const cs = getComputedStyle(n);
          const transform = [cs.transform, cs.translate, cs.scale, cs.rotate].filter((v) => v && v !== "none").join(" ");
          if (animations.length > 0 || transform)
            chain.push({ end: shared.has(n) ? "both" : e.end, on: describe(n, inner), animations, transform: transform || null });
        }
      }
      return { key: p.key, ends, chain };
    });

    for (let i = 0; i < DRIFT_FRAMES; i++) await frame();

    return looks.map(({ key, ends, chain }) => ({
      key,
      chain,
      ends: ends.map(({ end, id, el, before }) => {
        const after = el?.getBoundingClientRect() ?? null;
        const drift =
          before && after
            ? Math.max(
                Math.abs(after.left - before.left),
                Math.abs(after.top - before.top),
                Math.abs(after.width - before.width),
                Math.abs(after.height - before.height),
              )
            : null;
        return { end, id: id ? tail(id) : null, present: !!el, drift: drift == null ? null : +drift.toFixed(2) };
      }),
    }));
  };
})();

/*
 * The in-flight second look — what a line found off its card did next.
 *
 * In flight, a line off its card is one of three things, and one frame cannot
 * say which:
 *
 *   catching up    its card is at rest and the line is moving onto it. Between
 *                  unfolds a new measurement is tweened rather than applied
 *                  (`MapEdges`, `EDGE_TWEEN_MS`), so a card that moved after the
 *                  measure loop stopped is chased, not followed.
 *   card moving    the card is still moving; whether the line moves with it is
 *                  the question.
 *   left behind    neither moves: nothing will put the line back.
 *
 * `__wmFollow(lines, frames, tol)` looks again at the given frames after the
 * call, for each OFFSET problem in `lines`: the line's offset by the same rules
 * as every sample, whether its `d` changed since the previous look, and how far
 * its cards moved. The first reference is taken at the call, which a failing
 * sample makes straight away. The caller chooses which lines, and how many.
 */
(() => {

  globalThis.__wmFollow = (lines, frames, tol) =>
    new Promise((done) => {
      const keys = lines.map((p) => p.key);
      const snap = () => {
        const paths = new Map();
        for (const path of document.querySelectorAll("path[data-edge]:not([data-hit])")) paths.set(path.dataset.edge, path);
        const cards = new Map();
        for (const el of document.querySelectorAll("[data-node-id]")) cards.set(el.dataset.nodeId, el);
        return lines.map((p) => ({
          d: paths.get(p.key)?.getAttribute("d") ?? null,
          cards: (p.node ? [p.node] : [p.from, p.to]).map((id) => cards.get(id)?.getBoundingClientRect() ?? null),
        }));
      };
      let prev = snap();
      const t0 = performance.now();
      const looks = [];
      const last = Math.max(0, ...frames);
      let frame = 0;
      const tick = () => {
        frame++;
        if (frames.includes(frame)) {
          const now = snap();
          const watched = globalThis.__wmProbe(tol, keys).watched ?? {};
          looks.push({
            frame,
            sinceMs: Math.round(performance.now() - t0),
            lines: lines.map((p, i) => ({
              key: p.key,
              off: typeof watched[p.key] === "number" ? watched[p.key] : null,
              lineMoved: now[i].d !== prev[i].d,
              cardMoved: +Math.max(
                0,
                ...now[i].cards.map((r, j) => {
                  const b = prev[i].cards[j];
                  return r && b ? Math.max(Math.abs(r.left - b.left), Math.abs(r.top - b.top)) : 0;
                }),
              ).toFixed(2),
            })),
          });
          prev = now;
        }
        if (frame < last) requestAnimationFrame(tick);
        else done(looks);
      };
      requestAnimationFrame(tick);
    });
})();

/*
 * The timeline — when a transition's new lines are released and finish drawing.
 *
 * "No line held at the settled sample" is the absence of a rare event, and a
 * rare event's absence passes by luck. A hold fix claims something measurable
 * on every transition instead: that the new lines' draw starts sooner, and
 * that every line is drawn before the settled sample is taken. So this records
 * it, frame by frame, from the click.
 *
 * `arm()` before the click: it stamps the click itself from a capture-phase
 * listener, so the times are from the reader's press, not from when the
 * checker's call happened to return. Each frame records how many lines are
 * held (`data-wm-undrawn`, counting only lines whose cards have all been shown
 * — a line waiting for a card no pan has revealed yet is not held up by
 * anything), how many are mid-draw (an inline dash array, which the draw sets
 * and its settle clears) and how many there are. `read()` reduces that to:
 *
 *   holdStart   the first frame in which a line is held — when the new rung's
 *               commit reached the page, not when the checker clicked.
 *   drawStart   the first frame, after new lines were first held, in which
 *               more lines are mid-draw than at that moment — a new draw began.
 *               Measured against the count at the hold rather than against
 *               zero, because a previous transition's lines can still be
 *               drawing when this one is clicked, and they only ever decrease.
 *   fullyDrawn  the frame after the last one in which anything was held or
 *               drawing: every line on the page finished.
 *   maxFrameGap the longest gap between two frames after the click, and when:
 *               a main-thread stall, whether or not a sample landed after it.
 *   longFrames  the long animation frames between the click and the read, with
 *               the scripts that ran in them.
 *
 * Either timing is null when it did not happen inside the recording window,
 * and a transition that held nothing at all says so rather than reporting zero.
 *
 * The draw window. `arm(tol, frames, follow)` also samples inside the draw,
 * where lines and their arriving cards can come apart and no wall-clock sample
 * reaches — the draw starts after the last of them. At the draw start, and at
 * each count of frames after it in `frames`, the geometry is probed with the
 * same `__wmProbe` as every other sample, with the on-screen-while-arriving
 * check on; how many cards were still arriving (`data-wm-revealing`) at the
 * draw start is counted. A probe that finds a visible line off its card is
 * followed at `follow.frames` straight away (`__wmFollow`).
 *
 * The stall. `arm(tol, [], null, stall)` stalls the main thread on purpose, for
 * `stall.ms`, at `stall.at` — "hold+100ms", early in the cards' arrival, or
 * "draw+1f", as lines start drawing while cards still arrive — to put a failure
 * that otherwise needs a random long task under test. Card reveals run on the
 * compositor through a stall and lines are written by the main thread, so the
 * question is what a stall does to them. In the first frame after it, every
 * visible line's offset and whether its cards were still arriving are recorded,
 * and every one of those lines is followed at `stall.looks`. A mutation observer records, per
 * line, whether this transition's draw released it, and whether a move of its
 * `d` cleared its dash. Diagnostic only: the checker attaches no verdict to it.
 *
 * Called without `tol` or a stall, it records what it always did.
 */
(() => {
  /* Past the checker's 4000ms settle cap, so a draw that finishes before the cap
     is always seen finishing. The checker stops a recording as soon as it has
     read it, which is normally the moment the settle confirms drawing is done. */
  const RECORD_MS = 4200;
  /* Every line's state right now: held (with every card shown), held for a card
     not yet shown, mid-draw, and how many lines there are. A hold counts only
     while the motion layer is on: with `.wm-motion` off it hides nothing, and
     the probe reports it as a stale hold instead. */
  const lineState = (inner) => {
    let held = 0;
    let unrevealed = 0;
    let drawing = 0;
    let lines = 0;
    let shown = null;
    const motionOn = inner.classList.contains("wm-motion");
    for (const path of inner.querySelectorAll("path[data-edge]:not([data-hit])")) {
      lines++;
      if (path.style.strokeDasharray) drawing++;
      if (!motionOn || !path.closest("[data-wm-undrawn]")) continue;
      if (shown === null) {
        shown = new Set();
        for (const card of inner.querySelectorAll("[data-node-id]"))
          if (card.closest("[data-wm-box]")?.hasAttribute("data-wm-shown")) shown.add(card.dataset.nodeId);
      }
      const trunk = path.dataset.trunk;
      const ends = trunk ? [trunk.slice(trunk.indexOf(":") + 1)] : [path.dataset.from, path.dataset.to].filter(Boolean);
      if (ends.length > 0 && ends.every((id) => shown.has(id))) held++;
      else unrevealed++;
    }
    return { held, unrevealed, drawing, lines };
  };

  /* How many lines are held back, how many are mid-draw, and how many are held
     for a card not yet shown, right now. The checker's settled sample waits for
     the first two to reach zero; the third never holds it up. */
  globalThis.__wmDrawState = () => {
    const inner = document.querySelector("[data-zoom]");
    if (!inner) return [0, 0, 0];
    const s = lineState(inner);
    return [s.held, s.drawing, s.unrevealed];
  };

  /* Every line on the map, as `__wmFollow` takes them: its key and its cards. */
  const allLines = (inner) => {
    const out = [];
    for (const path of inner.querySelectorAll("path[data-edge]:not([data-hit])")) {
      const key = path.dataset.edge;
      const trunk = path.dataset.trunk;
      if (!key) continue;
      if (trunk) out.push({ kind: "OFFSET", key, node: trunk.slice(trunk.indexOf(":") + 1), path });
      else if (path.dataset.from && path.dataset.to) out.push({ kind: "OFFSET", key, from: path.dataset.from, to: path.dataset.to, path });
    }
    return out;
  };

  /* The main thread busy for `ms`, as a long task would keep it. */
  const busy = (ms) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      /* stalling on purpose */
    }
  };

  globalThis.__wmTimeline = {
    arm(tol, drawFrames, follow, stall) {
      const probing = tol != null && (drawFrames ?? []).length > 0;
      const probeAt = new Set(probing ? drawFrames : []);
      const state = {
        armedAt: performance.now(),
        clickAt: null,
        frames: [],
        done: false,
        stop: false,
        heldAt: -1,
        drawAt: -1,
        drawProbes: [],
        census: {},
        stall: stall ? { point: stall.at, ms: stall.ms, firedAt: null, first: null, looks: null, released: {}, clearedByMove: {} } : null,
        observer: null,
      };
      globalThis.__wmTimelineState = state;
      document.addEventListener(
        "click",
        () => {
          if (state.clickAt === null) state.clickAt = performance.now();
        },
        { capture: true, once: true },
      );
      const content = document.querySelector("[data-zoom]");
      if (stall && content) {
        state.observer = new MutationObserver((records) => {
          const released = new Set();
          const dashed = new Set();
          const undashed = new Set();
          const moved = new Set();
          for (const r of records) {
            const el = r.target;
            if (!(el instanceof Element) || el.hasAttribute("data-hit")) continue;
            const key = el.getAttribute("data-edge");
            if (!key) continue;
            if (r.attributeName === "data-wm-undrawn" && r.oldValue !== null && !el.hasAttribute("data-wm-undrawn")) released.add(key);
            else if (r.attributeName === "d") moved.add(key);
            else if (r.attributeName === "style") {
              const had = (r.oldValue ?? "").includes("stroke-dasharray");
              const has = !!el.style?.strokeDasharray;
              if (!had && has) dashed.add(key);
              if (had && !has) undashed.add(key);
            }
          }
          const t = Math.round(performance.now() - (state.clickAt ?? performance.now()));
          /* The draw releases a line and sets its dash in one synchronous pass,
             so both land in one batch; a failsafe release sets no dash. */
          for (const key of released) state.stall.released[key] = dashed.has(key) ? "by its draw" : "without a draw";
          /* A move clears a dash in the same pass as it writes the new `d`; the
             draw's own settle clears it with no `d` change. */
          for (const key of undashed) if (moved.has(key)) state.stall.clearedByMove[key] = t;
        });
        state.observer.observe(content, {
          subtree: true,
          attributes: true,
          attributeFilter: ["d", "style", "data-wm-undrawn"],
          attributeOldValue: true,
        });
      }
      const tick = () => {
        const inner = document.querySelector("[data-zoom]");
        const now = performance.now();
        const { held, drawing, lines } = inner ? lineState(inner) : { held: 0, drawing: 0, lines: 0 };
        state.frames.push([now, held, drawing, lines]);
        if ((probing || stall) && inner && state.clickAt !== null && now >= state.clickAt) {
          /* Draw start found as it happens, by the same rule `read()` applies
             afterwards, so probes and stalls line up with the reported figures. */
          const i = state.frames.length - 1;
          if (state.heldAt < 0) {
            if (held > 0) state.heldAt = i;
          } else if (state.drawAt < 0 && drawing > state.frames[state.heldAt][2]) {
            state.drawAt = i;
          }
          if (probing) {
            if (state.drawAt >= 0) {
              const frame = i - state.drawAt;
              if (frame === 0) state.census.atDraw = { arriving: inner.querySelectorAll("[data-wm-box][data-wm-revealing]").length };
              if (probeAt.has(frame)) {
                const drawTime = state.frames[state.drawAt][0];
                /* Not from inside this tick. The tick was registered before the
                   click, so it runs ahead of the map's own per-frame callbacks —
                   the measure loop, the draw tween — and would read cards that
                   have moved against lines not yet updated for this frame. A
                   callback registered from a task runs after the ones the map
                   has already queued for the next frame, so it reads what that
                   frame paints. */
                setTimeout(() =>
                  requestAnimationFrame((ts) => {
                    const at = performance.now();
                    const entry = {
                      frame,
                      sinceDraw: at - drawTime,
                      at,
                      frameGap: globalThis.__wmFrameGap(ts),
                      probe: globalThis.__wmProbe(tol, undefined, { early: true }),
                    };
                    state.drawProbes.push(entry);
                    /* A visible line past the limit fails this sample, so look
                       again straight away — by the time the checker reads the
                       recording, the moment is long gone. */
                    const failing = entry.probe.problems.filter((p) => p.kind === "OFFSET" && !p.hidden);
                    if (follow && failing.length > 0)
                      globalThis.__wmFollow(failing.slice(0, follow.lines), follow.frames, tol).then((looks) => {
                        entry.follow = looks;
                      });
                  }),
                );
              }
            }
          }
          if (stall && state.stall.firedAt === null) {
            const due =
              stall.at === "hold+100ms"
                ? state.heldAt >= 0 && now - state.frames[state.heldAt][0] >= 100
                : state.drawAt >= 0 && i - state.drawAt === 1;
            if (due) {
              busy(stall.ms);
              state.stall.firedAt = Math.round(now - state.clickAt);
              setTimeout(() =>
                requestAnimationFrame((ts) => {
                  const all = allLines(inner);
                  const shown = all.filter(
                    (l) =>
                      !l.path.closest("[data-wm-undrawn]") &&
                      (typeof l.path.checkVisibility !== "function" || l.path.checkVisibility({ opacityProperty: true, visibilityProperty: true })),
                  );
                  const probe = globalThis.__wmProbe(stall.tol ?? 20, shown.map((l) => l.key));
                  state.stall.first = {
                    sinceClick: Math.round(performance.now() - state.clickAt),
                    frameGap: globalThis.__wmFrameGap(ts),
                    lines: shown.map((l) => ({
                      key: l.key,
                      off: probe.watched[l.key] ?? null,
                      dashed: !!l.path.style.strokeDasharray,
                      cards: (l.node ? [l.node] : [l.from, l.to]).map((id) => ({ id, arriving: globalThis.__wmCardArriving(id) })),
                    })),
                  };
                  const followed = shown.map(({ kind, key, node, from, to }) => ({ kind, key, node, from, to }));
                  globalThis.__wmFollow(followed, stall.looks, stall.tol ?? 20).then((looks) => {
                    state.stall.looks = looks;
                  });
                }),
              );
            }
          }
        }
        const waited = state.clickAt === null ? now - state.armedAt : now - state.clickAt;
        if (!state.stop && waited < (state.clickAt === null ? 10_000 : RECORD_MS)) requestAnimationFrame(tick);
        else state.done = true;
      };
      requestAnimationFrame(tick);
    },
    read() {
      const state = globalThis.__wmTimelineState;
      if (state) {
        state.stop = true;
        state.observer?.disconnect();
      }
      if (!state || state.clickAt === null) return { clicked: false };
      const f = state.frames.filter((x) => x[0] >= state.clickAt).map(([t, h, d, l]) => [t - state.clickAt, h, d, l]);
      if (f.length === 0) return { clicked: true, frames: 0 };
      const span = f[f.length - 1][0];
      let maxFrameGap = 0;
      let maxFrameGapAt = null;
      for (let i = 1; i < f.length; i++) {
        if (f[i][0] - f[i - 1][0] > maxFrameGap) {
          maxFrameGap = f[i][0] - f[i - 1][0];
          maxFrameGapAt = f[i - 1][0];
        }
      }
      const now = performance.now();
      const common = {
        clicked: true,
        frames: f.length,
        span,
        maxFrameGap: Math.round(maxFrameGap),
        maxFrameGapAt: maxFrameGapAt == null ? null : Math.round(maxFrameGapAt),
        longFrames: globalThis.__wmLongFramesBetween(state.clickAt, now),
        stall: state.stall,
        now,
        clickedAgo: now - state.clickAt,
      };
      const holdAt = f.findIndex((x) => x[1] > 0);
      if (holdAt < 0) return { ...common, held: false };
      let drawStart = null;
      for (let i = holdAt; i < f.length; i++) {
        if (f[i][2] > f[holdAt][2]) {
          drawStart = f[i][0];
          break;
        }
      }
      let lastBusy = -1;
      for (let i = 0; i < f.length; i++) if (f[i][1] > 0 || f[i][2] > 0) lastBusy = i;
      const fullyDrawn = lastBusy < f.length - 1 ? f[lastBusy + 1][0] : null;
      /* When the new lines were first held, too: a hold bounded from its own
         start can only be judged against that start, and a big rung's commit
         can start it well after the click. */
      return {
        ...common,
        held: true,
        heldPeak: Math.max(...f.map((x) => x[1])),
        holdStart: f[holdAt][0],
        drawStart,
        fullyDrawn,
        drawProbes: state.drawProbes,
        census: state.census,
      };
    },
  };
})();
