#!/usr/bin/env python3
"""
check-map-geometry — does every line on the workflow map touch the two cards
it claims to join?

Edge geometry on this map is applied imperatively, outside React, from
measurements taken across several animation frames. That is the right design
— committing edges must never change layout — but it means nothing about the
type system or the component tree can tell you a line is attached. Twice now
the answer has been "no", and twice a human found it by eye. This is the
check that should have found it instead.

    python3 scripts/check-map-geometry.py            # against a dev server
    python3 scripts/check-map-geometry.py --url http://localhost:3111
    python3 scripts/check-map-geometry.py --quick    # one fixture, one zoom

Run it with a browser that has Playwright's Chromium. In this workspace:

    /Users/stevens34/Desktop/Rippit/repositories/orrit-workers/venv/bin/python \\
        scripts/check-map-geometry.py

Exit code is 0 only if every sample was clean, so it can gate a change.

── The axis that matters: fold state ──────────────────────────────────────

An earlier version of this checker swept zoom, filters and the sidebar, and
never touched folding. Folding is where it breaks, because folding is the one
action that *removes nodes from the model* — and a path whose node is gone is
a dashed line hanging in empty space.

So the sweep is, per rung: the rung change itself; every foldable card
pressed, and counted as whatever the press did — a card standing for a packed
run or a whole fan-out descends a rung and the sweep climbs back, while an arm
opens in place and the sweep folds it, reopens it and folds it again, which
covers each sibling arm that borrows its group representative's tree and the
reopen path back through the motion layer's hold; then expand-all and
collapse-all. At Structure it also opens every arm at once — the founder's
view, with a pill beside every calling step — checks that folding and
reopening a sibling arm leaves the other arms' pills where they are, and
reopens a scenario pill after opening the same scenario at another branch has
withdrawn it. Then, where the motion layer is on, it soaks: the line-holding
transitions repeated enough times that an intermittent hold cannot pass by
luck. All of it at several zooms, over fixtures that between them cover a fold
worth collapsing (`?shapes=1`), an estate past LITE_AT where the map switches
its measure loop off (`?big=1`), and real captured workflows including the one
in the founder's screenshot (`?snapshot=…`, which need
RIPPIT_MAP_SNAPSHOT_DIR set **on the dev server**, and are skipped with a
notice when it is not).

It also runs twice over: once normally and once with reduced motion emulated,
which is how the map is told to switch its motion layer off. That second pass
is the only clean baseline — with motion on, a line that has not been drawn
yet is held at opacity 0, so some fraction of any floating fragment is masked
rather than absent — and it is where the sweep found offsets of 101px that the
first pass could not see.

Every run prints the sweep definition before it starts. Cases are discovered
as it goes (a rung with nothing left to open contributes none), so two runs
are only comparable when those lines match.

Each case is sampled across its whole transition, for a reason:

  in-flight  three samples across the 650 ms unfold measure loop, while cards
             are still arriving and the loop is following them frame by frame.
             This is the half a human sees and reports, and it is the half no
             end-state assertion can reach. An orphaned path is a failure here
             outright; an offset is judged against one card reveal's own
             displacement (TOL_INFLIGHT), and only on what is actually on screen
             at that instant — the parts of a line its draw has reached, on
             things not held at opacity 0. A dash off its path's length gets the
             same limit, because mid-draw the motion layer accepts a few pixels
             of it by design.
  settled    once no line is held back and none is still drawing — never
             earlier than the measure hook's own settle (SETTLE_MS), and a
             failure if lines are unfinished at SETTLE_CAP_MS. It used to be a
             fixed 2100ms, and measured on real workflows the last line of a
             rung change landed at a 2091ms median, so about half of those
             "settled" samples were taken mid-draw. Nothing is moving now, so
             the contract is exact: 1.5 px, the same number the in-app dev
             self-check uses, on every line whatever its state. And the cards
             a line joins sit on the layout's grid: a column link's two cards
             share a left edge and a chain link's two steps a top, within
             ALIGN_PX, measured where the layout put each card — a hover lift
             or a selected card's growth does not move it off the grid.
  draw       from inside the page: at the frame a press's lines start drawing
             and at fixed frames on, out to where the first lines finish. That
             is where a line released too early would show beside a card still
             arriving — the motion layer releases each line only once both of
             its cards have landed, and this is where that is checked — and no
             wall-clock sample reaches it: the draw starts after the last of
             them. Same probe, same in-flight
             rules, judging a line's start from its first drawn frame and its
             far end once the dash reaches it — and one more: a line on screen
             while either of its cards is still arriving fails, because that is
             the moment a line and its card come apart. Every first arm open and
             pill expand is probed; rung changes and reopens only on odd soak
             cycles, so the quoted timings come from clicks no probe touched,
             and probed minus unprobed is what probing costs.

A line held for a card that has never been shown — off screen, waiting for a
pan to reveal it — is waiting, not stuck: it neither holds up a settled sample
nor fails one, and is counted apart.

A sample that fails says what was happening when it did: the gap before its
frame, whether the failing line's cards were still arriving, the long frames
between the click and it with the scripts that ran in them, and — in flight —
what the line did in the next frames. `--stall` adds a diagnostic with no
verdict: the main thread held busy on purpose, early in the cards' arrival and
as lines start drawing, on dedicated soak cycles, reporting what every visible
line did after it.

Every sample is taken inside a `requestAnimationFrame` callback, so what is
measured is what the browser is about to paint. It matters more than it
sounds: a fold on a large workflow is a long task — frames 435 ms apart with
nothing painted between them — and reading the DOM at an arbitrary moment
lands in that gap, on an intermediate state no frame ever showed. Reporting
that is reporting a bug nobody can see, and it crowds out the ones they can.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import Error as PWError, sync_playwright

# The verdict lives in its own stdlib-only module so it can be checked with no
# browser and no Playwright — see mapGeometryVerdict.py. Imported after
# switching off bytecode writing, so `scripts/` does not grow a __pycache__
# on every run.
sys.dont_write_bytecode = True
from mapGeometryVerdict import (  # noqa: E402
    ALIGN_PX,
    DRIFT_PX,
    analytics_pattern,
    classify,
    follow_verdict,
    run_outcome,
    second_look_verdict,
    median_of,
    settle_decision,
    unfinished_problem,
    pass_verdict,
    probe_cost,
    quote_line,
    reached_fixtures,
    skips_summary,
    sweep_stamp,
    timing_line,
)

PROBE = Path(__file__).with_name("mapGeometryProbe.js").read_text()

# Next calls `__NEXT_HMR_LATENCY_CB` only when a hot update was actually applied
# to this page — Turbopack's `onBuilt()` reports `hasUpdates: false` for a
# no-op and the callback is suppressed. "[Fast Refresh] rebuilding", by
# contrast, is logged for every build the dev server starts, including one
# triggered by another browser loading a route, which changes nothing here.
# Only the callback means this page's code changed.
HMR_HOOK = "self.__NEXT_HMR_LATENCY_CB = () => console.log('[wm-checker] hot update applied');"


# Matches `useMapMeasure`'s own dev self-check: a fractional zoom snaps boxes
# to device pixels, which reads as up to 1/zoom px in inner space.
TOL_SETTLED = 1.5
# In flight, derived rather than picked: a card arriving is mid-rise, and
# `REVEAL_RISE_PX` is 16, so up to one rise of disagreement between a line and
# the card it joins is the animation itself and not a defect — most of it while
# the card is still fading up from opacity 0 and nobody can see it. The margin
# on top covers one frame of the measure loop and sub-pixel rounding. Anything
# past this is not lag; it is a line drawn to somewhere the card never was.
TOL_INFLIGHT = 20.0

# The settled sample waits until no line is held or drawing — see
# `settle_decision` — and never earlier than this floor, which is not the draw.
# It is the measure hook's own settle after a commit: its trailing measure
# (720) and the edge tween that follows (260), after a commit that lands ~460ms
# after the click on a large rung, rounded up. A transition that holds no lines
# still needs that, and nothing in the page announces when it is done.
SETTLE_MS = 2100
# The most the settled sample waits for drawing to finish. Reaching it with
# lines still held or drawing is a failure (UNFINISHED), never a sample taken
# anyway: lines that never finish drawing are the stuck-line defect.
SETTLE_CAP_MS = 4000
SETTLE_POLL_MS = 40
# Long enough for a zoom glide (ZOOM_TWEEN_MS) and the measure it triggers.
ZOOM_SETTLE_MS = 600
IN_FLIGHT_MS = (140, 340, 560)
# Frames after a timed transition's lines start drawing at which the geometry is
# sampled from inside the page. A line is released to draw only once both of its
# cards have landed (`data-wm-shown` without `data-wm-revealing`) and a measure
# has run since, so lines start as their own cards land, not together: from the
# first line's draw start, the rest follow for as long as the cards' reveal
# stagger runs, up to `REVEAL_STAGGER_CAP_MS` (250) behind the first card. That
# cascade is where a line released a frame too early would show beside a card
# still arriving — what the EARLY check looks for — and 16 frames (~267ms at
# 60Hz) covers it, denser early where the first lines appear. 32 frames (~530ms)
# is where the first lines finish their 520ms draw (`EDGE_DRAW_MS`) and their
# far ends can be judged at all. The wall-clock samples above never reach any of
# it: a rung change starts drawing at ~1.3s, after the last of them.
DRAW_PROBE_FRAMES = (0, 2, 4, 8, 16, 32)

RUNGS = ("Overview", "Structure", "Steps")

# How long a toolbar control may take to become pressable. Generous on purpose:
# on the 300-caller estate an expand or collapse is a long task, and a press
# queued behind one waited out a 3s timeout and was silently skipped six times
# in a single sweep.
CONTROL_TIMEOUT_MS = 15_000

# Every kind of transition the sweep sets out to perform. A kind the whole run
# never performed is named in the verdict's first line — see `pass_verdict`.
TRANSITIONS = (
    "rung",
    "descend",
    "ascend",
    "open arm",
    "close arm",
    "reopen arm",
    "all arms open",
    "pills stay put",
    "expand pill",
    "reopen pill",
    "expand all",
    "collapse all",
)

# Repeats of each line-holding transition. A defect seen one time in three gets
# past a single attempt two times in three; past eight, about 4% of the time.
SOAK_CYCLES = 8

# A failing sample this soon after a hot reload may be the reload — it
# remounts the map and re-holds every line — rather than the map.
RELOAD_SHADOW_S = 15.0

# A settled line found off its card is read again at these times after the
# failing sample, to tell one that catches up from one left behind. The first is
# past the measure hook's convergence loop (CONVERGE_MAX_MS, 400ms), so a lag the
# hook corrects on its own has been corrected; the second is past a whole card
# reveal starting at the failing moment (REVEAL_STAGGER_CAP_MS 250 + REVEAL_MS
# 460). Diagnostic only — see `second_look`.
SECOND_LOOK_MS = (450, 1000)
# Lines per failing sample given a second look: enough to name the kind of
# failure without a badly broken sweep spending a second on every line.
SECOND_LOOK_LINES = 4
# Frames after a failing in-flight sample at which its lines are looked at
# again: the next paint, ~50ms and ~133ms. A re-measurement tweened in between
# unfolds takes `EDGE_TWEEN_MS` (260ms), so a line catching up is still moving at
# every one of these, and a line nothing will move is visibly not.
FOLLOW_FRAMES = (1, 3, 8)

# The injected stall: as long as the one that exposed lines left behind their
# arriving cards (259ms, measured), at two points — early in the arrival, 100ms
# into the hold, and as lines start drawing while cards still arrive, one frame
# into the draw. Diagnostic only; see `stall_transition`.
STALL_MS = 260
STALL_POINTS = ("hold+100ms", "draw+1f")

# Where `next dev` reads its env from, in the order it reads them: the first
# file that sets a key wins, and the process environment beats every file.
ENV_FILES = (".env.development.local", ".env.local", ".env.development", ".env")



@dataclass
class Sample:
    scenario: str
    zoom: float
    when: str
    paths: int
    drawn: int
    motion: bool
    plan: str
    late_ms: float
    widest_fan_out: int
    pills: list[str]
    at: float
    nodes: int
    skipped: int
    unconnected: int
    problems: list[dict]
    fatal: list[dict] = field(default_factory=list)
    # For a settled sample: how long after the action it was taken, and whether
    # it had to wait past the floor for lines to finish drawing.
    settled_after_ms: float = 0.0
    waited_for_draw: bool = False
    # The largest offset on any visible line, pass or fail, and which line.
    max_visible_off: float = 0.0
    max_visible_key: str | None = None
    # For a settled sample with lines off their cards: what those turned out to be.
    second_look: list[str] = field(default_factory=list)
    # For a sample taken inside a draw: how long after the draw started it ran,
    # and which kind of timed transition it was inside.
    since_draw_ms: float | None = None
    group: str | None = None
    # Lines whose far end the draw had not reached, judged at their start only.
    not_drawn_yet: int = 0
    # The largest gap between a drawing line's dash and its own length, and where.
    max_dash_delta: float = 0.0
    max_dash_key: str | None = None
    # Line ends actually compared with their cards.
    ends_judged: int = 0
    # Lines held for a card never yet shown: waiting for a pan, not stuck.
    held_unrevealed: int = 0
    # Settled samples only: pairs judged for alignment, and pairs a card
    # transform the probe could not take out kept from being judged, each by
    # anchor ("v", "h").
    align_judged: dict[str, int] | None = None
    align_unjudged: dict[str, int] | None = None
    # Which kind of transition the sample was taken in, where known.
    kind: str | None = None
    # How long before this sample's frame the previous frame ran, and — on a
    # failing sample — the long frames between its click and it.
    frame_gap: int | None = None
    long_frames: list[dict] = field(default_factory=list)


class Run:
    def __init__(self, page, url: str, quiet: bool) -> None:
        self.page = page
        self.url = url
        self.quiet = quiet
        self.samples: list[Sample] = []
        self.plans: set[str] = set()
        # Transitions actually performed, by kind. A sweep step whose locator
        # stops matching the map returns without sampling anything, and the
        # run still passes — so what was done is counted, not assumed from what
        # was planned.
        self.transitions: dict[str, int] = {kind: 0 for kind in TRANSITIONS}
        # This page's code changing under the run: hot updates actually applied
        # and full reloads, with wall time. Only these mean the samples describe
        # more than one version of the map. See `watch_reloads`.
        self.reloads: list[tuple[float, str]] = []
        # Every "[Fast Refresh] rebuilding" notice, including no-op builds
        # another browser's compile caused. Logged, never a qualifier.
        self.rebuild_notices: list[tuple[float, str]] = []
        # The content box found replaced since it was marked: the map remounted.
        self.remounts: list[tuple[float, str]] = []
        # Planned presses of controls that always exist, which could not be made.
        self.unperformed: list[str] = []
        # Steps whose locator found nothing, by step, with where. See `skips_summary`.
        self.skips: dict[str, list[str]] = {}
        # Pill edges drawn with every arm of a fixture open, by fixture/mode.
        self.pill_counts: dict[str, int] = {}
        self.soak_cycles_done = 0
        # Fixtures abandoned because the page navigated or the browser errored
        # mid-way: (wall time, fixture, first line of the error).
        self.interruptions: list[tuple[float, str, str]] = []
        # Hold-and-draw timelines, by group ("rung change", "reopen arm",
        # "reopen pill"), recorded in motion mode only — see `timed`.
        self.timings: dict[str, list[dict]] = {}
        self.no_hold: dict[str, int] = {}
        # Whether the page in front of the run has its motion layer on. Set on
        # every load, and followed sample by sample after that: a press that
        # takes the map past LITE_AT switches motion off in the same commit, and
        # one that brings it back under switches it on again.
        self.motion_now = False
        # Every such switch, with the press that caused it: (wall time, press, on).
        self.motion_changes: list[tuple[float, str, bool]] = []
        # Whether timed clicks right now sample inside their draws, and whether
        # they are part of the soak — set by `soak`, cycle by cycle.
        self.probe_draw = False
        self.in_soak = False
        # Injected-stall cycles: whether to run them, and what each recorded.
        self.stall_enabled = False
        self.stalls: list[dict] = []
        # The last timed click's recording and the draw samples taken inside it,
        # for a caller that learns what the click was only afterwards.
        self.last_timeline: dict | None = None
        self.last_draw_samples: list[Sample] = []
        self.last_transition_samples: list[Sample] = []

    def note_skip(self, step: str, where: str) -> None:
        self.skips.setdefault(step, []).append(where)

    def watch_reloads(self, page) -> None:
        """Count the dev server hot-reloading the page under the run.

        Next's dev client logs `[Fast Refresh] rebuilding` when a saved file is
        swapped in, and `performing full reload` when it gives up and reloads.
        Either means the map's code changed mid-measurement — and a swap
        remounts the map, which on its own re-holds every line the motion layer
        had drawn. A run that spans one has measured two versions of the map,
        and a failure beside one may be the reload rather than the map; neither
        is visible in any sample, so it is counted here and carried into the
        verdict.
        """

        def on_console(msg) -> None:
            text = msg.text
            if "[wm-checker] hot update applied" in text or "[Fast Refresh] performing full reload" in text:
                self.reloads.append((time.time(), text))
            elif "[Fast Refresh] rebuilding" in text:
                self.rebuild_notices.append((time.time(), text))

        page.on("console", on_console)

    # ---- probing -------------------------------------------------------

    def probe(self, scenario: str, when: str, tol: float, late_ms: float = 0.0, kind: str | None = None) -> Sample:
        """Sample inside an animation frame, so what is measured is what gets painted.

        Reading the DOM at an arbitrary moment is not the same question. A fold
        on a large workflow is a long task — measured here, frames 435ms apart
        with nothing painted between them — and a plain `evaluate` runs in that
        gap, on an intermediate state that no frame ever showed. Reporting that
        as a break is reporting a bug nobody can see, and it crowds out the
        ones they can.

        A `requestAnimationFrame` callback runs immediately before the browser
        paints, and the rects read inside it are the ones about to be painted.
        Registering after the page's own callbacks also means the map's measure
        loop gets its frame first, which is the fair comparison.

        Alignment is asked for at settled samples only: mid-transition a card
        is on its way to its place by design.
        """
        raw = self.page.evaluate(
            """([t, opts]) => new Promise((done) => requestAnimationFrame((ts) => done({
                 ...globalThis.__wmProbe(t, undefined, opts),
                 frameGap: globalThis.__wmFrameGap ? globalThis.__wmFrameGap(ts) : null,
               })))""",
            [tol, {"align": ALIGN_PX} if when == "settled" else {}],
        )
        if "error" in raw:
            raise RuntimeError(f"{scenario}: {raw['error']}")
        if not raw.get("marked", True):
            self.remounts.append((time.time(), scenario))
            self.mark_content_box()
        s = self.record(raw, scenario, when, tol, late_ms=late_ms, at=time.time(), kind=kind)
        if s.fatal:
            # What held the main thread between the click and this sample.
            s.long_frames = self.page.evaluate(
                "() => globalThis.__wmLastClick == null ? [] : "
                "globalThis.__wmLongFramesBetween(globalThis.__wmLastClick, performance.now())"
            )
            self.report_stalls(s)
        if when.startswith("+") and any(p["kind"] == "OFFSET" for p in s.fatal):
            self.follow_up(s)
        return s

    def report_stalls(self, s: Sample) -> None:
        if self.quiet:
            return
        for line in fmt_long_frames(s.long_frames):
            print(f"         {line}")

    def follow_up(self, s: Sample, looks: list[dict] | None = None) -> None:
        """Name what an in-flight line off its card did in the next frames.

        One failing frame cannot tell a line catching up to a card at rest from
        one that is not following its card at all, or from one nothing will
        move again — and on a certifying run, the difference decides where the
        fix goes. A wall-clock sample looks straight away from here; a sample
        inside a draw was followed by the page itself at the moment it failed,
        and hands its `looks` in. The sample's verdict is untouched.
        """
        lines = [p for p in s.fatal if p["kind"] == "OFFSET"][:SECOND_LOOK_LINES]
        if not lines:
            return
        if looks is None:
            looks = self.page.evaluate(
                "([lines, frames, tol]) => globalThis.__wmFollow(lines, frames, tol)",
                [lines, list(FOLLOW_FRAMES), TOL_INFLIGHT],
            )
        for p in lines:
            key = p["key"]
            steps = []
            for look in looks:
                for line in look.get("lines", []):
                    if line.get("key") != key:
                        continue
                    step = f"+{look['frame']}f " + ("not measured" if line.get("off") is None else f"{line['off']}px")
                    if line.get("lineMoved"):
                        step += " line moved"
                    if (line.get("cardMoved") or 0.0) > DRIFT_PX:
                        step += f" card moved {line['cardMoved']}px"
                    steps.append(step)
            s.second_look.append(f"next frames at {short_key(key)}: {follow_verdict(looks, key, TOL_INFLIGHT)}")
            s.second_look.append("  " + (", ".join(steps) if steps else "no looks taken"))
        if not self.quiet:
            for line in s.second_look:
                print(f"         {line}")

    def record(
        self,
        raw: dict,
        scenario: str,
        when: str,
        tol: float,
        *,
        late_ms: float,
        at: float,
        since_draw_ms: float | None = None,
        group: str | None = None,
        kind: str | None = None,
    ) -> Sample:
        """Turn one probe result into a classified sample, and report it."""
        s = Sample(
            scenario=scenario,
            zoom=round(raw["zoom"], 2),
            when=when,
            paths=raw["paths"],
            drawn=raw["drawn"],
            motion=raw.get("motion", True),
            plan=raw.get("plan", "unknown"),
            late_ms=late_ms,
            widest_fan_out=raw.get("widestFanOut", 0),
            pills=raw.get("pills", []),
            at=at,
            nodes=raw["nodes"],
            skipped=raw["skipped"],
            unconnected=raw["unconnected"],
            problems=raw["problems"],
            since_draw_ms=since_draw_ms,
            group=group,
            not_drawn_yet=raw.get("notDrawnYet", 0),
            max_dash_delta=raw.get("maxDashDelta", 0.0),
            max_dash_key=raw.get("maxDashKey"),
            ends_judged=raw.get("endsJudged", 0),
            held_unrevealed=raw.get("heldUnrevealed", 0),
            align_judged=raw.get("alignJudged"),
            align_unjudged=raw.get("alignUnjudged"),
            kind=kind,
            frame_gap=raw.get("frameGap"),
        )
        s.max_visible_off = raw.get("maxVisibleOff", 0.0)
        s.max_visible_key = raw.get("maxVisibleKey")
        s.fatal = classify(s.problems, when, tol)
        self.samples.append(s)
        # Draw-window samples are recorded after their press has settled, out of
        # order, and only exist with motion on; every other sample is in order.
        if not when.startswith("draw+") and s.motion != self.motion_now:
            self.motion_changes.append((time.time(), scenario, s.motion))
            self.motion_now = s.motion
            if not self.quiet:
                print(f"         motion layer {'on again' if s.motion else 'off'} after: {scenario}")
        self.last_transition_samples.append(s)
        self.plans.add(f"{scenario.split(' · ')[0]}={s.plan}")
        if not self.quiet:
            mark = "FAIL" if s.fatal else "ok  "
            print(
                f"  {mark} {when:<9} {s.drawn:>4} lines  {s.nodes:>4} cards"
                f"  {len(s.fatal):>3} bad   {scenario}"
            )
            for p in s.fatal[:6]:
                print(f"         {fmt_problem(p)}")
                if p.get("arriving") and p["kind"] == "OFFSET":
                    print(f"           {fmt_arriving(p)}")
            if s.fatal and s.frame_gap is not None:
                print(f"         taken {s.frame_gap}ms after the frame before it")
        if when == "settled" and any(p["kind"] == "OFFSET" for p in s.fatal):
            self.second_look(s)
        return s

    def second_look(self, s: Sample) -> None:
        """Name what a settled line found off its card turned out to be.

        A failing settled sample says a line and its card disagreed at one
        instant, and three defects with different fixes look exactly like that:
        a card still moving when the sample was taken, a measure that missed a
        layout change and caught it later, and a line nothing moves back at
        all. One sample cannot tell them apart, and a certifying run that fails
        on one should not need a second run to say which it was. So the failing
        moment is described straight away — what was animating on either card
        or anything it sits in, and whether a card drifted between frames — and
        the line's offset is read twice more.

        The sample's verdict is untouched: it failed, and it stays failed.
        """
        lines = [p for p in s.fatal if p["kind"] == "OFFSET"][:SECOND_LOOK_LINES]
        # The transition's recording has already seen every line finish drawing;
        # stop it here so this pause does not stretch its span.
        self.page.evaluate("() => { const r = globalThis.__wmTimelineState; if (r) r.stop = true; }")
        looks = {look["key"]: look for look in self.page.evaluate("(ps) => globalThis.__wmExplain(ps)", lines)}
        keys = [p["key"] for p in lines]
        later: dict[str, list[float | None]] = {key: [] for key in keys}
        for ms in SECOND_LOOK_MS:
            remaining = ms - (time.time() - s.at) * 1000
            if remaining > 0:
                self.page.wait_for_timeout(remaining)
            raw = self.page.evaluate(
                "([t, keys]) => new Promise((done) => requestAnimationFrame(() => done(globalThis.__wmProbe(t, keys))))",
                [TOL_SETTLED, keys],
            )
            for key in keys:
                off = raw.get("watched", {}).get(key)
                later[key].append(float(off) if isinstance(off, (int, float)) else None)
        for key in keys:
            look = looks.get(key, {})
            s.second_look.append(f"second look at {short_key(key)}: {second_look_verdict(look, later[key], TOL_SETTLED)}")
            s.second_look.append(f"  when it failed: {fmt_look(look)}")
            s.second_look.append(
                "  afterwards: "
                + ", ".join(f"+{ms}ms " + ("not measured" if off is None else f"{off}px") for ms, off in zip(SECOND_LOOK_MS, later[key]))
            )
        if not self.quiet:
            for line in s.second_look:
                print(f"         {line}")

    def sample_transition(self, scenario: str, kind: str | None) -> None:
        """One action, watched through the whole unfold window and after it.

        Each sample records how far past its nominal offset it actually landed.
        The in-flight offsets exist to catch a window that opens when the model
        commits and closes when the geometry catches up, and they are wall
        clock: a probe fires when the browser gets round to it. So anything
        that slows the page down — a second checker driving the same dev
        server, a build running alongside it — slides the samples *past* the
        window rather than into it.

        That direction matters. Contention adding noise would show up as
        failures and be investigated; contention moving a sample past the
        defect it was aimed at shows up as a clean run, which is the one
        outcome nobody questions. Measuring the drift is what stops "it was
        green" and "it was green because it looked too late" from being the
        same report.
        """
        # None when the caller can only say what the action was once it has
        # happened — see `press_fold`, which counts it afterwards.
        if kind is not None:
            self.transitions[kind] += 1
        self.last_transition_samples = []
        t0 = time.monotonic()
        for i, ms in enumerate(IN_FLIGHT_MS):
            prev = IN_FLIGHT_MS[i - 1] if i else 0
            self.page.wait_for_timeout(ms - prev)
            landed = (time.monotonic() - t0) * 1000
            self.probe(scenario, f"+{ms}ms", TOL_INFLIGHT, late_ms=landed - ms, kind=kind)
        waited_for_draw = False
        while True:
            elapsed = (time.monotonic() - t0) * 1000
            if elapsed < SETTLE_MS:
                self.page.wait_for_timeout(SETTLE_MS - elapsed)
                continue
            # A line held for a card never shown is waiting for a pan: it does
            # not hold the sample up (`__wmDrawState` leaves it out of `held`).
            held, drawing, _unrevealed = self.page.evaluate("() => globalThis.__wmDrawState()")
            decision = settle_decision(elapsed, held, drawing, SETTLE_MS, SETTLE_CAP_MS)
            if decision != "wait":
                break
            waited_for_draw = True
            self.page.wait_for_timeout(SETTLE_POLL_MS)
        settled = self.probe(scenario, "settled", TOL_SETTLED, kind=kind)
        settled.settled_after_ms = elapsed
        settled.waited_for_draw = waited_for_draw
        if decision == "capped":
            self.flag(settled, unfinished_problem(held, drawing, SETTLE_CAP_MS))

    def timed(self, act, scenario: str, kind: str | None, group: str, *, always_probe: bool = False) -> bool:
        """Run one transition with the hold-and-draw timeline recording from its click.

        Only where the motion layer is on: with it off nothing is held or drawn,
        so there is nothing to time. `act` performs the click and may return
        False if it could not, in which case nothing is sampled.

        Probed inside its draw on the soak cycles chosen for it, or always where
        `always_probe` says so — the presses nothing is quoted from. Every other
        timed click records exactly what it always did.
        """
        record = self.motion_now
        probing = record and (always_probe or self.probe_draw)
        self.last_timeline = None
        self.last_draw_samples = []
        if record:
            self.page.evaluate(
                "([tol, frames, follow]) => globalThis.__wmTimeline.arm(tol, frames, follow)",
                [TOL_INFLIGHT, list(DRAW_PROBE_FRAMES), {"frames": list(FOLLOW_FRAMES), "lines": SECOND_LOOK_LINES}]
                if probing
                else [None, [], None],
            )
        if act() is False:
            return False
        self.sample_transition(scenario, kind)
        if record:
            # No wait: the settled sample only happens once drawing has
            # finished, so the recording already holds the whole draw — and
            # every draw-window probe, the last of which runs well inside it.
            timeline = self.page.evaluate("() => globalThis.__wmTimeline.read()")
            now = time.time()
            # Which transition this was and when it was clicked, so the slowest
            # one can be named and laid against the reload stamps.
            timeline["scenario"] = scenario
            timeline["clicked_at"] = now - timeline.get("clickedAgo", 0.0) / 1000
            timeline["probed"] = probing
            timeline["soak"] = self.in_soak
            self.last_timeline = timeline
            if timeline.get("clicked") and timeline.get("held"):
                self.timings.setdefault(group, []).append(timeline)
            elif timeline.get("clicked"):
                self.no_hold[group] = self.no_hold.get(group, 0) + 1
            # In the order they were taken; `at` back-dated from the page's clock,
            # so a draw sample's wall time lines up with reload and remount stamps.
            for d in timeline.get("drawProbes", []):
                s = self.record(
                    d["probe"], scenario, f"draw+{d['frame']}f", TOL_INFLIGHT,
                    late_ms=0.0, at=now - (timeline["now"] - d["at"]) / 1000, since_draw_ms=d["sinceDraw"],
                    group=group, kind=kind,
                )
                s.frame_gap = d.get("frameGap")
                self.last_draw_samples.append(s)
                if s.fatal:
                    # Long frames from the click up to this sample, from the recording.
                    until = timeline.get("clickedAgo", 0.0) - (timeline["now"] - d["at"])
                    s.long_frames = [f for f in timeline.get("longFrames", []) if f["at"] <= until]
                    if not self.quiet:
                        print(f"         taken {s.frame_gap}ms after the frame before it")
                    self.report_stalls(s)
                if d.get("follow") and any(p["kind"] == "OFFSET" for p in s.fatal):
                    self.follow_up(s, d["follow"])
        return True

    def regroup(self, group: str, kind: str) -> None:
        """File the last timed click under what it turned out to be."""
        timeline = self.last_timeline
        if timeline is not None:
            for name, lines in self.timings.items():
                if timeline in lines and name != group:
                    lines.remove(timeline)
                    self.timings.setdefault(group, []).append(timeline)
                    break
        for s in self.last_draw_samples:
            s.group = group
        for s in self.last_transition_samples + self.last_draw_samples:
            s.kind = kind

    def wait_settled(self) -> None:
        """Wait as a settled sample would — nothing held, nothing drawing — and take none."""
        t0 = time.monotonic()
        while True:
            elapsed = (time.monotonic() - t0) * 1000
            if elapsed < SETTLE_MS:
                self.page.wait_for_timeout(SETTLE_MS - elapsed)
                continue
            held, drawing, _unrevealed = self.page.evaluate("() => globalThis.__wmDrawState()")
            if settle_decision(elapsed, held, drawing, SETTLE_MS, SETTLE_CAP_MS) != "wait":
                return
            self.page.wait_for_timeout(SETTLE_POLL_MS)

    def stall_transition(self, act, scenario: str, kind: str, point: str) -> bool:
        """Press, stall the main thread on purpose at `point`, and record what the lines did.

        Diagnostic only, and kept apart from everything the verdict reads: no
        sample is taken, no transition counted, no timing quoted. The page
        records every visible line in the first frame after the stall and
        follows each of them; the report is `stall_report`.
        """
        self.page.evaluate(
            "([stall]) => globalThis.__wmTimeline.arm(null, [], null, stall)",
            [{"at": point, "ms": STALL_MS, "looks": list(FOLLOW_FRAMES), "tol": TOL_INFLIGHT}],
        )
        if act() is False:
            return False
        self.wait_settled()
        timeline = self.page.evaluate("() => globalThis.__wmTimeline.read()")
        self.stalls.append({"kind": kind, "point": point, "scenario": scenario, "timeline": timeline})
        if not self.quiet:
            stall = (timeline.get("stall") or {})
            fired = stall.get("firedAt")
            first = stall.get("first") or {}
            worst = max(
                (line for line in first.get("lines", []) if isinstance(line.get("off"), (int, float))),
                key=lambda line: line["off"],
                default=None,
            )
            print(
                f"  stall {point:<11} {kind:<14} "
                + (
                    f"stalled at +{fired}ms; first frame after it +{first.get('sinceClick')}ms, "
                    + (f"worst line {worst['off']:.1f}px ({short_key(worst['key'])})" if worst else "no line measured")
                    if fired is not None
                    else "never stalled — no hold or no draw to stall at"
                )
                + f"   {scenario}"
            )
        return True

    # ---- driving the map ------------------------------------------------

    def open_fixture(self, query: str) -> None:
        resp = self.page.goto(f"{self.url}/dev/workflow-map{query}", wait_until="domcontentloaded")
        # A snapshot the dev server cannot read is a 404, and waiting 45s for a
        # selector that will never appear is a bad way to learn that.
        if resp is not None and resp.status >= 400:
            raise PWError(f"{query or '(default)'} returned HTTP {resp.status}")
        self.page.wait_for_selector("[data-node-id]", timeout=45_000)
        self.page.wait_for_timeout(SETTLE_MS)
        self.normalise_camera()
        self.mark_content_box()
        self.motion_now = self.motion_on()
        # The entrance draws lines too. The first transition should not be
        # clicked while they are still drawing, or its timeline starts inside
        # someone else's draw.
        waited = SETTLE_MS
        while waited < SETTLE_CAP_MS and any(self.page.evaluate("() => globalThis.__wmDrawState()")[:2]):
            self.page.wait_for_timeout(SETTLE_POLL_MS)
            waited += SETTLE_POLL_MS

    def normalise_camera(self) -> None:
        """Start every fixture from the same view: 100 %, content origin top-left.

        The map frames itself on first load — the whole map centred when it
        fits at a readable zoom, otherwise the start of the flow at up to
        100 % — so where a fixture opens depends on its size and the viewport.
        The sweep's zooms are stated in the stamp, and its reveals depend on
        what is on screen, so both are pinned: wait for the framing to finish
        (`data-wm-framed` on the content box), then put the camera back where
        every earlier run began.
        """
        try:
            self.page.wait_for_selector("[data-zoom][data-wm-framed]", state="attached", timeout=10_000)
        except PWError:
            return  # a build without first-load framing: the view is already the default
        if self.page.evaluate("() => Number(document.querySelector('[data-zoom]')?.dataset.zoom) || 1") != 1:
            self.page.get_by_role("button", name=re.compile(r"reset to 100 percent")).click()
            self.page.wait_for_timeout(ZOOM_SETTLE_MS)
        self.page.evaluate(
            """() => { const sb = document.querySelector('[role="group"][aria-label^="Map canvas"]');
                     if (sb) sb.scrollTo({ left: sb.clientWidth, top: sb.clientHeight, behavior: 'instant' }); }"""
        )
        self.page.wait_for_timeout(SETTLE_POLL_MS * 5)

    def set_rung(self, rung: str) -> None:
        btn = self.page.get_by_role("radio", name=rung, exact=True)
        if btn.count() == 0:
            btn = self.page.get_by_role("button", name=rung, exact=True)
        btn.first.click()

    def set_zoom(self, z: float) -> None:
        """The toolbar's percentage button resets to 100%; ± steps by 1.12."""
        self.page.get_by_role("button", name=re.compile(r"reset to 100 percent")).click()
        self.page.wait_for_timeout(300)
        steps = 0
        cur = 1.0
        target_in = z > 1
        while abs(cur - z) > 0.02 and steps < 12:
            self.page.get_by_role("button", name="Zoom in (+)" if target_in else "Zoom out (−)").click()
            cur = cur * 1.12 if target_in else cur / 1.12
            steps += 1
        self.page.wait_for_timeout(SETTLE_MS)

    def click_chip(self, locator) -> bool:
        try:
            locator.scroll_into_view_if_needed(timeout=3_000)
            locator.click(timeout=3_000)
            return True
        except PWError:
            return False

    # ---- the sweep -------------------------------------------------------

    def current_rung(self) -> str:
        checked = self.page.locator('[role="radio"][aria-checked="true"]')
        return (checked.first.text_content(timeout=3_000) or "").strip()

    def closed_chip(self, name: str):
        return self.page.locator(f'[data-node-id="{css_escape(name)}"][data-fold="closed"] .wm-fold-open')

    def open_chip(self, name: str):
        return self.page.locator(f'[data-node-id="{css_escape(name)}"][data-fold="open"] .wm-fold-open')

    def fold_arm(self, label: str, name: str) -> bool:
        chip = self.open_chip(name)
        if chip.count() == 0 or not self.click_chip(chip.first):
            return False
        self.sample_transition(f"{label} · fold {short(name)}", "close arm")
        return True

    def press_card(self, label: str, name: str) -> str:
        """Press one card's chip and say what it did: "descend", "open" or "gone".

        The same "+ N steps" chip does two different things depending on what
        the card stands for: an arm opens in place, while a packed run or a
        whole fan-out *is* the coarse rung, so pressing it descends to the next
        one. Nothing in the page says which a card is before it is pressed, and
        guessing from how node ids happen to be spelled would tie the checker to
        the model's internals. So the rung is read before the press and after
        the transition has settled: if it changed, that was a descent, and the
        sweep climbs back.

        The samples are labelled "press", which is true either way. Labelling
        them in advance is how this checker once spent a whole "Structure" arm
        sweep on the Steps rung, having descended through the first card and
        called it opening an arm.
        """
        chip = self.closed_chip(name)
        if chip.count() == 0:
            return "gone"
        before = self.current_rung()
        # Probed inside its draw every time: a first open's new lines are held
        # and drawn exactly like a reopen's, and nothing is quoted from it.
        if not self.timed(lambda: self.click_chip(chip.first), f"{label} · press {short(name)}", None, "press", always_probe=True):
            return "gone"
        after = self.current_rung()
        if after != before:
            self.transitions["descend"] += 1
            self.regroup("descend", "descend")
            if not self.quiet:
                print(f"         pressing {short(name)} descended {before} → {after}; climbing back")
            self.set_rung(before)
            self.sample_transition(f"{label} · ascend {after} → {before}", "ascend")
            return "descend"
        self.transitions["open arm"] += 1
        self.regroup("first open", "open arm")
        return "open"

    def press_fold(self, label: str, name: str, reopen: bool) -> bool:
        """Press a card; if it opened an arm, fold it — and if asked, reopen and fold again.

        The reopen is not a repeat of the open. A branch that was shown before
        and is opened again goes back through the motion layer's hold and draw
        rather than popping in — the path its HELD bug lives on — so it is its
        own transition, timed and counted separately. Returns whether it reopened.
        """
        if self.press_card(label, name) != "open":
            return False
        if not self.fold_arm(label, name):
            self.note_skip("fold an opened arm", f"{label} · {short(name)}")
            return False
        if not reopen:
            return False
        if not self.reopen_arm(label, name):
            self.note_skip("reopen an arm", f"{label} · {short(name)}")
            return False
        self.fold_arm(label, name)
        return True

    def reopen_arm(self, label: str, name: str) -> bool:
        def press() -> bool:
            chip = self.closed_chip(name)
            return chip.count() > 0 and self.click_chip(chip.first)
        return self.timed(press, f"{label} · reopen {short(name)}", "reopen arm", "reopen arm")

    def closed_card_ids(self) -> list[str]:
        return self.page.locator('[data-fold="closed"]').evaluate_all(
            "(els) => els.map((e) => e.dataset.nodeId).filter(Boolean)"
        )

    def sweep_folds(self, label: str, limit: int | None) -> None:
        """Press every foldable card on this rung — or the first `limit`.

        Distinct cards, by id, collected before the first press. Taking the
        first closed card each round instead presses the same card every time,
        because folding an arm away makes it the first closed card again.

        Every card rather than a chosen one, because the page does not say
        which arm is its group's representative and which borrows the
        representative's tree by position — and the borrowing path, whose
        nested branches fold one level down under the sibling, is worth
        sweeping. Pressing all of them covers every sibling without guessing
        which card is which. `limit` of None means all of them.
        """
        ids = self.closed_card_ids()
        if not ids:
            self.note_skip("press foldable cards", label)
            return
        reopened = False
        for name in ids if limit is None else ids[:limit]:
            # One reopen per rung and zoom keeps the path covered everywhere;
            # the soak repeats it where it matters, in motion mode.
            reopened = self.press_fold(label, name, reopen=not reopened) or reopened

    def open_all_arms(self, label: str) -> list[str]:
        """Open every arm on the rung and leave them open; return which opened.

        The state the founder looks at, and the one with the most pills: every
        branch drawn, each calling step inside it carrying its own pill. A card
        that descends instead is climbed back from and left closed.
        """
        ids = self.closed_card_ids()
        if not ids:
            self.note_skip("open every arm", label)
            return []
        opened = []
        for name in ids:
            if self.press_card(f"{label} · all arms", name) == "open":
                opened.append(name)
        if not opened:
            self.note_skip("open every arm (no card opened in place)", label)
            return []
        self.transitions["all arms open"] += 1
        state = self.probe(f"{label} · every arm open", "settled", TOL_SETTLED)
        key = label.split(" · ")[0]
        self.pill_counts[key] = max(self.pill_counts.get(key, 0), len(state.pills))
        return opened

    def flag(self, sample: Sample, problem: dict) -> None:
        """A failure found by comparing samples rather than inside one."""
        sample.problems.append(problem)
        sample.fatal.append(problem)
        if not self.quiet:
            print(f"  FAIL {'':<9} {'':>4}        {'':>4}          1 bad   {sample.scenario}")
            print(f"         {fmt_problem(problem)}")

    def check_pills_stay_put(self, label: str, opened: list[str]) -> None:
        """Fold and reopen a sibling arm, and check another arm's pills never move.

        The founder's bug: a pill belonged to whichever caller happened to render
        first, so opening or closing one branch moved pills in another. Every
        sample already checks that each drawn pill hangs off the step that makes
        its call; this checks the other half, that the set of pills under an arm
        is untouched by what its sibling does. Siblings are arms with the same
        parent, which is what a path-based id's prefix says.
        """
        parent = lambda node: node.rsplit("/", 1)[0]  # noqa: E731
        under = lambda pills, arm: sorted(p for p in pills if p.startswith(arm + "/"))  # noqa: E731
        base = self.probe(f"{label} · pills before a sibling folds", "settled", TOL_SETTLED)
        arm = next((a for a in opened if under(base.pills, a)), None)
        sibling = next((b for b in opened if arm and b != arm and parent(b) == parent(arm)), None)
        if arm is None or sibling is None:
            self.note_skip("pills stay put (no arm with a pill beside an open sibling)", label)
            return
        before = under(base.pills, arm)
        if not self.fold_arm(label, sibling):
            self.note_skip("pills stay put (sibling would not fold)", label)
            return
        if not self.reopen_arm(label, sibling):
            self.note_skip("pills stay put (sibling would not reopen)", label)
            return
        after_state = self.probe(f"{label} · pills after {short(sibling)} folded and reopened", "settled", TOL_SETTLED)
        self.transitions["pills stay put"] += 1
        after = under(after_state.pills, arm)
        if after != before:
            self.flag(after_state, {
                "kind": "PILL",
                "key": arm,
                "moved": f"{len(before)} pills under {short(arm)} became {len(after)} after its sibling "
                         f"{short(sibling)} was folded and reopened",
                "gone": [short(p) for p in before if p not in after][:4],
                "new": [short(p) for p in after if p not in before][:4],
            })

    def pill_button(self, pill: str):
        # The pill's own hook for its expand control, not its label, role or
        # look, so the control can be redesigned without the checker noticing.
        # Its state is still read from `aria-expanded`.
        return self.page.locator(f'[data-node-id="{css_escape(pill)}"] [data-wm-pill-toggle]')

    def pill_toggle(self, pill: str) -> bool:
        button = self.pill_button(pill)
        return button.count() > 0 and self.click_chip(button.first)

    def pill_expanded(self, pill: str) -> bool:
        button = self.pill_button(pill)
        return button.count() > 0 and button.first.get_attribute("aria-expanded") == "true"

    def closed_pill_pair(self, avoid: str | None = None) -> tuple[str, str] | None:
        """Two closed pills calling the same scenario, neither inside `avoid`."""
        pills = self.page.evaluate(
            """() => [...document.querySelectorAll('[data-node-id]')].flatMap((e) => {
                 const id = e.dataset.nodeId, cut = id.lastIndexOf('/');
                 const button = e.querySelector('[data-wm-pill-toggle]');
                 if (cut <= 0 || !id.slice(cut + 1).startsWith('wf:') || !button) return [];
                 return [{ id, target: id.slice(cut + 1), open: button.getAttribute('aria-expanded') === 'true' }];
               })"""
        )
        by_target: dict[str, list[str]] = {}
        for pill in pills:
            if not pill["open"] and not (avoid and pill["id"].startswith(avoid + "/")):
                by_target.setdefault(pill["target"], []).append(pill["id"])
        return next(((ids[0], ids[1]) for ids in by_target.values() if len(ids) >= 2), None)

    def check_withdrawal(self, opened: str, withdrawn: str, what: str) -> None:
        """One expanded copy per scenario: `opened` is expanded and `withdrawn` no longer is."""
        if self.pill_expanded(withdrawn) or not self.pill_expanded(opened):
            self.flag(self.samples[-1], {"kind": "PILL", "key": opened, "moved": what})

    def check_pill_reopen(self, label: str) -> None:
        """Reopen a scenario pill after opening the same scenario elsewhere withdrew it.

        One expanded copy per scenario: a scenario called from five branches is
        five pills, but its steps are drawn at one of them, so opening a second
        closes the first — removing a subtree somewhere else on the canvas, far
        from the click. Opening the first again is the reverse, and it sends the
        first copy's lines back through the hold, so it is timed.
        """
        pair = self.closed_pill_pair()
        if pair is None:
            self.note_skip("reopen a scenario pill (no scenario with two closed pills)", label)
            return
        first, second = pair
        if not self.timed(lambda: self.pill_toggle(first), f"{label} · expand {short(first)} at {short(parent_of(first))}",
                          "expand pill", "pill expand", always_probe=True):
            self.note_skip("reopen a scenario pill (first pill would not expand)", label)
            return
        if not self.timed(lambda: self.pill_toggle(second), f"{label} · expand {short(second)} at {short(parent_of(second))}",
                          "expand pill", "pill expand", always_probe=True):
            self.note_skip("reopen a scenario pill (second pill would not expand)", label)
            return
        self.check_withdrawal(second, first, "opening a scenario's second pill did not withdraw its first copy")
        if not self.timed(lambda: self.pill_toggle(first), f"{label} · reopen {short(first)} at {short(parent_of(first))}",
                          "reopen pill", "reopen pill"):
            self.note_skip("reopen a scenario pill (first pill would not reopen)", label)
            return
        self.check_withdrawal(first, second, "reopening a withdrawn scenario pill did not withdraw the copy that replaced it")

    def mark_content_box(self) -> None:
        self.page.evaluate("() => { const box = document.querySelector('[data-zoom]'); if (box) box.__wmMark = true; }")

    def motion_on(self) -> bool:
        return bool(self.page.evaluate("() => !!document.querySelector('[data-zoom]')?.classList.contains('wm-motion')"))

    def soak(self, label: str, cycles: int) -> None:
        """Repeat the transitions that hold lines, so an intermittent hold cannot pass by luck.

        Motion mode, z1.0, and only what can hold a line until its draw: a rung
        change each way, an arm reopened, and a scenario pill reopened after
        another branch's copy withdrew it. Each is timed from its click. A single
        attempt at a defect seen one time in three passes two times in three by
        luck; the cycle count is in the stamp.

        Set up once: every arm open, so the calling steps inside them render
        their pills; one arm to fold and reopen; and a pair of pills calling the
        same scenario, outside that arm, with the first one expanded — so each
        cycle's second pill withdraws it and reopening the first withdraws the
        second, leaving the state as each cycle found it.
        """
        opened = self.open_all_arms(f"{label} · soak setup")
        arm = opened[0] if opened else None
        if arm is None:
            self.note_skip("soak an arm (no arm opens in place)", label)
        pair = self.closed_pill_pair(avoid=arm)
        if pair is None:
            self.note_skip("soak a scenario pill (no scenario with two closed pills)", label)
        elif not self.timed(lambda: self.pill_toggle(pair[0]), f"{label} · soak setup · expand {short(pair[0])}",
                            "expand pill", "pill expand", always_probe=True):
            pair = None
        self.in_soak = True
        for i in range(1, cycles + 1):
            # Odd cycles carry the draw-window probes and even ones do not: the
            # quoted timings come from clicks no probe touched, and the same
            # transitions, probed and not, give the probes' own cost.
            self.probe_draw = i % 2 == 1
            tag = f"{label} · soak {i}/{cycles}" + (" · draw probed" if self.probe_draw else "")
            self.timed(lambda: self.set_rung("Steps"), f"{tag} · to Steps", "rung", "rung change")
            self.timed(lambda: self.set_rung("Structure"), f"{tag} · back to Structure", "rung", "rung change")
            if arm is not None and self.fold_arm(tag, arm) and not self.reopen_arm(tag, arm):
                self.note_skip("soak an arm (would not reopen)", tag)
            if pair is not None:
                first, second = pair
                if self.timed(lambda: self.pill_toggle(second), f"{tag} · expand {short(second)}", "expand pill", "pill expand",
                              always_probe=True):
                    self.check_withdrawal(second, first, "opening a scenario's second pill did not withdraw its first copy")
                    if self.timed(lambda: self.pill_toggle(first), f"{tag} · reopen {short(first)}", "reopen pill", "reopen pill"):
                        self.check_withdrawal(first, second, "reopening a withdrawn scenario pill did not withdraw the copy that replaced it")
                else:
                    self.note_skip("soak a scenario pill (second pill would not expand)", tag)
            self.soak_cycles_done += 1
        self.probe_draw = False
        self.in_soak = False
        if self.stall_enabled:
            self.stall_cycles(label, arm, pair)
        self.sweep_all(f"{label} · soak done")

    def stall_cycles(self, label: str, arm: str | None, pair: tuple[str, str] | None) -> None:
        """One dedicated cycle per stall point, stalling every kind of press that holds lines.

        After the normal soak, so no quoted or probed click shares a cycle with
        an injected stall. Presses that only restore the map's state between
        stalled ones are made without samples, and each cycle leaves the map as
        the soak left it: every arm open, the first pill of the pair expanded.
        """
        def press(locator) -> bool:
            return locator.count() > 0 and self.click_chip(locator.first)

        for point in STALL_POINTS:
            tag = f"{label} · stall {point}"
            self.stall_transition(lambda: self.set_rung("Steps"), f"{tag} · to Steps", "rung change down", point)
            self.stall_transition(lambda: self.set_rung("Structure"), f"{tag} · back to Structure", "rung change up", point)
            if arm is not None and press(self.open_chip(arm)):
                # The climb back cleared what was drawn, so opening the arm now
                # draws its lines for the first time since; the second open is a
                # reopen of lines drawn a moment ago.
                self.wait_settled()
                if self.stall_transition(lambda: press(self.closed_chip(arm)), f"{tag} · first open {short(arm)}", "first open", point):
                    if press(self.open_chip(arm)):
                        self.wait_settled()
                        self.stall_transition(lambda: press(self.closed_chip(arm)), f"{tag} · reopen {short(arm)}", "reopen arm", point)
            if pair is not None:
                first, second = pair
                if self.stall_transition(lambda: self.pill_toggle(second), f"{tag} · expand {short(second)}", "pill expand", point):
                    if self.pill_toggle(first):
                        self.wait_settled()

    def press_control(self, name: str, label: str) -> bool:
        """Press a toolbar control, and record it if that cannot be done.

        Unlike a card's chip, a toolbar control is always on the page, so
        failing to press one never means there was nothing to do: it means the
        page was too busy, or the control has gone. `click_chip`'s silent
        `False` is right for a card and wrong here — it let a busy estate map
        drop six planned expands out of a sweep without a word. A press that
        cannot be made is recorded, and the run fails as a harness error.
        """
        try:
            self.page.get_by_role("button", name=name).click(timeout=CONTROL_TIMEOUT_MS)
            return True
        except PWError as err:
            self.unperformed.append(f"{label} · {name.lower()}: {str(err).splitlines()[0][:70]}")
            return False

    def sweep_all(self, label: str) -> None:
        if self.press_control("Expand all", label):
            self.sample_transition(f"{label} · expand all", "expand all")
        if self.press_control("Collapse all", label):
            self.sample_transition(f"{label} · collapse all", "collapse all")

def parent_of(node_id: str) -> str:
    return node_id.rsplit("/", 1)[0]


def short(node_id: str) -> str:
    tail = node_id.rsplit("/", 1)[-1]
    return tail[:28]


def fmt_arriving(p: dict) -> str:
    """Which of a failing line's cards were still arriving when it failed."""
    return "still arriving: " + ", ".join(f"card {short(card)}" for card in p.get("arriving", []))


def fmt_long_frames(frames: list[dict]) -> list[str]:
    """Long frames between a click and a sample, each with its longest scripts."""
    if not frames:
        return []
    out = []
    for f in frames:
        scripts = "; ".join(
            f"{s.get('invoker') or '?'}"
            + (f" {s['fn']}" if s.get("fn") else "")
            + (f" ({s['source']})" if s.get("source") else " (no URL: evaluated code)")
            + f" {s.get('duration', 0)}ms"
            + (f", forced layout {s['forcedLayout']}ms" if s.get("forcedLayout") else "")
            for s in f.get("scripts", [])
        )
        out.append(
            f"long frame at {f['at']:+d}ms: {f['duration']}ms, blocking {f['blocking']}ms"
            + (f" — {scripts}" if scripts else " — no script attributed")
        )
    return out


def stall_report(stalls: list[dict], tol: float) -> str:
    """What an injected stall did to the lines, by stall point and kind of press.

    For every line visible in the first frame after the stall: its offset then,
    what it did in the frames after (`follow_verdict`), whether this press's
    draw released it, whether a move cleared its dash, and whether its cards
    were still arriving. Reported for the lines past the in-flight limit, with
    the largest offset and the count — the numbers any fix is scored against.
    """
    out = [f"injected stalls — diagnostic, no verdict ({STALL_MS}ms of main thread held busy):"]
    order: list[tuple[str, str]] = []
    for entry in stalls:
        if (entry["point"], entry["kind"]) not in order:
            order.append((entry["point"], entry["kind"]))
    for point, kind in order:
        group = [e for e in stalls if e["point"] == point and e["kind"] == kind]
        fired = [e for e in group if ((e["timeline"] or {}).get("stall") or {}).get("firedAt") is not None]
        head = f"  {point} · {kind}: stalled {len(fired)} of {len(group)}"
        if not fired:
            out.append(head + " — nothing held or drawn to stall at")
            continue
        visible = 0
        worst: tuple[float, str, str] | None = None
        over: list[tuple[dict, dict, list[dict]]] = []
        gaps: list[int] = []
        cleared_all = 0
        for e in fired:
            stall = e["timeline"]["stall"]
            first = stall.get("first") or {}
            looks = stall.get("looks") or []
            cleared_all += len(stall.get("clearedByMove") or {})
            if first.get("frameGap") is not None:
                gaps.append(first["frameGap"])
            for line in first.get("lines", []):
                visible += 1
                off = line.get("off")
                if not isinstance(off, (int, float)):
                    continue
                if worst is None or off > worst[0]:
                    worst = (off, line["key"], e["scenario"])
                if off > tol:
                    over.append((stall, line, looks))
        out.append(
            head
            + f"; {visible} visible lines in the first frame after it"
            + (f", taken {min(gaps)}–{max(gaps)}ms after the frame before" if gaps else "")
        )
        if worst:
            out.append(f"    largest offset: {worst[0]:.1f}px at {short_key(worst[1])} — {worst[2]}")
        out.append(f"    over {tol:.0f}px: {len(over)} · dashes cleared by a move, any line: {cleared_all}")
        if over:
            verdicts = Counter(follow_verdict(looks, line["key"], tol) for _, line, looks in over)
            out.append("      then: " + ", ".join(f"{v} ×{n}" for v, n in verdicts.most_common()))
            released = Counter((stall.get("released") or {}).get(line["key"], "not released by this press") for stall, line, _ in over)
            out.append("      released: " + ", ".join(f"{v} ×{n}" for v, n in released.most_common()))
            cleared = sum(1 for stall, line, _ in over if line["key"] in (stall.get("clearedByMove") or {}))
            arriving = [c for _, line, _ in over for c in (line.get("cards") or []) if c and c.get("arriving")]
            out.append(f"      dash cleared by a move: {cleared} · card ends still arriving: {len(arriving)}")
    return "\n".join(out)


def short_key(key: str) -> str:
    return " → ".join(short(end) for end in key.split(">"))


def fmt_look(look: dict) -> str:
    """The failing moment in a line: cards that drifted, and what was animating or transformed where."""
    parts = []
    for end in look.get("ends", []):
        if not end.get("present"):
            parts.append(f"{end['end']} card not rendered")
        elif (end.get("drift") or 0.0) > DRIFT_PX:
            parts.append(f"{end['end']} card {end['id']} drifted {end['drift']}px over a few frames")
    for link in look.get("chain", []):
        # A finished animation holding its last frame moves nothing; if it holds
        # a transform, the transform is reported on its own below.
        for a in link.get("animations", []):
            if a.get("state") in ("finished", "idle"):
                continue
            progress = "" if a.get("progress") is None else f" at {a['progress']:.0%}"
            props = ", ".join(a.get("props") or []) or "?"
            parts.append(f"{link['end']}: {a['what']} ({props}) {a['state']}{progress} on {link['on']}")
        if link.get("transform"):
            parts.append(f"{link['end']}: transform {link['transform']} on {link['on']}")
    return "; ".join(parts) if parts else "nothing moving or transformed on either card or anything it sits in"


def css_escape(s: str) -> str:
    return re.sub(r'(["\\])', r"\\\1", s)


def fmt_problem(p: dict) -> str:
    kind = p["kind"]
    key = p.get("key", "?")
    if kind == "ORPHAN":
        return f"ORPHAN {key} → node {p.get('missing')} is not rendered  d={p.get('d','')[:70]}"
    if kind == "EARLY":
        cards = ", ".join(short(c) for c in p.get("arriving", []))
        return f"EARLY  {key} is on screen while its card {cards} is still arriving"
    if kind == "OFFSET":
        return (
            f"OFFSET {key} off by {p.get('off')}px"
            f"  want={p.get('want')} got={p.get('got')}"
        )
    if kind == "DASH":
        return (
            f"DASH   {key} dasharray {p.get('dashArray')} vs path length "
            f"{p.get('pathLength')} (Δ{p.get('delta')}px) — drawn against stale geometry"
        )
    if kind == "STALE-HOLD":
        return f"STALE-HOLD {key} still carries data-wm-undrawn with the motion layer off — the hold outlived its class"
    if kind == "FAILSAFE":
        return f"FAILSAFE {key} was released by the hold's failsafe — its own draw never came"
    if kind == "HELD":
        return f"HELD   {key} still has data-wm-undrawn after the settle — invisible"
    if kind == "UNFINISHED":
        return (
            f"UNFINISHED {p.get('held')} line(s) still held and {p.get('drawing')} still drawing at the "
            f"{p.get('cap'):.0f}ms settle cap — they never finished"
        )
    if kind == "ALIGN":
        link = "column link" if p.get("anchor") == "v" else "chain link"
        edge = p.get("edge")
        a, b = p.get("at") or ("?", "?")
        return (
            f"ALIGN  {key} {link} off the grid by {p.get('off')}px — {short(p.get('from', '?'))} {edge} {a}, "
            f"{short(p.get('to', '?'))} {edge} {b}"
        )
    if kind == "PILL":
        if "caller" in p:
            return f"PILL   {short(p['pill'])} hangs off {short(p['from'])}, not {short(p['caller'])}, the step that calls it"
        return f"PILL   {short(key)}: {p.get('moved')}"
    return f"{kind} {key} {p}"


def posthog_host() -> str | None:
    """`NEXT_PUBLIC_POSTHOG_HOST` as the dev server resolves it, or None.

    Only that one key is read. The env files hold secrets and nothing else in
    them is the checker's business; this value is public by construction, since
    Next inlines every `NEXT_PUBLIC_` value into the client bundle.
    """
    if os.environ.get("NEXT_PUBLIC_POSTHOG_HOST", "").strip():
        return os.environ["NEXT_PUBLIC_POSTHOG_HOST"].strip()
    root = Path(__file__).resolve().parent.parent
    for name in ENV_FILES:
        try:
            text = (root / name).read_text()
        except OSError:
            continue
        m = re.search(r"^\s*NEXT_PUBLIC_POSTHOG_HOST\s*=\s*(.*?)\s*$", text, re.M)
        if m and m.group(1).strip("\"'"):
            return m.group(1).strip("\"'")
    return None


def memory_free_percent() -> float | None:
    """Free memory at the start of a run, from macOS's `memory_pressure`; None elsewhere."""
    try:
        out = subprocess.run(["memory_pressure"], capture_output=True, text=True, timeout=15).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    found = re.search(r"free percentage:\s*(\d+)%", out)
    return float(found.group(1)) if found else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://localhost:3000", help="dev server base URL")
    ap.add_argument("--quick", action="store_true", help="one fixture, one zoom, fewer arms")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--fixture", default="", help="run only fixtures whose name contains this")
    ap.add_argument("--zooms", default="", help="comma-separated zooms (default 1.0,0.8,1.25)")
    ap.add_argument(
        "--modes",
        default="",
        help="comma-separated: motion, no-motion (default both; --quick does motion only)",
    )
    ap.add_argument(
        "--soak",
        type=int,
        default=None,
        help=f"hold soak cycles per fixture where motion is on (default {SOAK_CYCLES}; 1 under --quick; 0 to skip)",
    )
    ap.add_argument(
        "--stall",
        action="store_true",
        help=f"diagnostic: after the soak, stall the main thread {STALL_MS}ms at {' and at '.join(STALL_POINTS)} "
        "on one dedicated cycle each, and report what the lines did (no verdict)",
    )
    args = ap.parse_args()
    soak_cycles = args.soak if args.soak is not None else (1 if args.quick else SOAK_CYCLES)

    zooms = [float(z) for z in args.zooms.split(",") if z] or ([1.0] if args.quick else [1.0, 0.8, 1.25])
    modes = [m.strip() for m in args.modes.split(",") if m.strip()] or (["motion"] if args.quick else ["motion", "no-motion"])
    # `big` is the third fixture for a reason: 300 callers puts the map over
    # LITE_AT, where `animateUnfold` deliberately runs no measure loop at all
    # and far root rows render as placeholders. That is a different path
    # through the same code and nothing else here exercises it.
    #
    # The snapshot fixtures are real captured workflows, including the one in
    # the founder's screenshot. They carry things no synthetic fixture has:
    # cross-workflow pills whose calling steps sit inside router arms, so a
    # fold re-parents them, and a mix of branch and chain edges. They need
    # RIPPIT_MAP_SNAPSHOT_DIR set on the *dev server*, and are skipped with a
    # notice rather than failing the run when it is not.
    fixtures = (
        [("?shapes=1", "shapes")]
        if args.quick
        else [
            ("?shapes=1", "shapes"),
            ("", "prototype"),
            ("?big=1", "big/LITE"),
            ("?snapshot=ghl-pcf-live", "ghl-pcf-live"),
            ("?snapshot=ghl-119", "ghl-119"),
            ("?snapshot=make-102", "make-102"),
        ]
    )
    if args.fixture:
        fixtures = [f for f in fixtures if args.fixture in f[1]]
        if not fixtures:
            print(f"no fixture matching {args.fixture!r}")
            return 2
    # Every arm at 100%, where the arms' own geometry is what is being tested;
    # the first two elsewhere, where the zoom is. Two under --quick.
    def arms_at(z: float) -> int | None:
        return None if (not args.quick and z == 1.0) else 2

    api_host = posthog_host()

    # Every analytics request the pages try to send, counted by host and first
    # path segment — enough to see what PostHog attempted without ever printing
    # the token that sits further down some of its paths.
    blocked: Counter[str] = Counter()

    def block(route) -> None:
        parts = urlsplit(route.request.url)
        first = parts.path.strip("/").split("/", 1)[0]
        blocked[f"{parts.hostname}/{first}" if first else f"{parts.hostname}"] += 1
        try:
            route.abort("blockedbyclient")
        except PWError:
            pass  # the page went away mid-request; nothing is left to send

    missing: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        # Which long-frame record this browser keeps, asked of the browser
        # itself before the stamp states it.
        scratch = browser.new_page()
        long_frames = scratch.evaluate(
            """() => {
                 const types = globalThis.PerformanceObserver?.supportedEntryTypes ?? [];
                 return types.includes("long-animation-frame") ? "long-animation-frame"
                   : types.includes("longtask") ? "longtask" : null;
               }"""
        )
        scratch.close()
        print(
            sweep_stamp(
                fixtures=[f[1] for f in fixtures],
                rungs=RUNGS,
                zooms=zooms,
                modes=modes,
                quick=args.quick,
                soak_cycles=soak_cycles,
                memory_free=memory_free_percent(),
                in_flight_ms=IN_FLIGHT_MS,
                settle_floor_ms=SETTLE_MS,
                settle_cap_ms=SETTLE_CAP_MS,
                tol_inflight=TOL_INFLIGHT,
                tol_settled=TOL_SETTLED,
                draw_probe_frames=DRAW_PROBE_FRAMES,
                long_frames=long_frames,
                stall=(STALL_MS, STALL_POINTS) if args.stall else None,
                analytics_host=api_host,
            )
        )
        print()
        run: Run | None = None
        t0 = time.time()
        try:
            for mode in modes:
                # Reduced motion is how the map is told to switch its motion
                # layer off (`usePrefersReducedMotion` → `enabled: false`), and
                # it is the only clean baseline: with motion on, a line that has
                # not been drawn yet is held at opacity 0, so some fraction of
                # any floating fragment is masked rather than absent.
                context = browser.new_context(
                    viewport={"width": 1440, "height": 900},
                    reduced_motion="reduce" if mode == "no-motion" else "no-preference",
                )
                context.add_init_script(PROBE)
                context.add_init_script(HMR_HOOK)
                # A compiled pattern, not a predicate: Playwright hands a pattern
                # to the browser, which then intercepts only the requests it
                # matches, where a predicate intercepts every request the page
                # makes — the map's own chunks included — to ask this process.
                context.route(re.compile(analytics_pattern(api_host), re.IGNORECASE), block)
                page = context.new_page()
                if run is None:
                    run = Run(page, args.url.rstrip("/"), args.quiet)
                    run.stall_enabled = args.stall
                else:
                    run.page = page
                run.watch_reloads(page)
                for query, fixture in fixtures:
                    name = f"{fixture}/{mode}"
                    try:
                        run.open_fixture(query)
                    except PWError:
                        missing.append(name)
                        continue
                    # A navigation mid-fixture — a full reload the dev server forces
                    # when the tree changes under it — destroys the page the sweep
                    # is driving. The fixture is abandoned and recorded, the sweep
                    # moves on, and the run still reports; a 45-minute run is not
                    # lost to a traceback, and it cannot pass having done less
                    # than it claims.
                    try:
                        for z in zooms:
                            if z != 1.0:
                                run.set_zoom(z)
                            for rung in RUNGS:
                                label = f"{name} · {rung} · z{z}"
                                run.timed(lambda: run.set_rung(rung), label, "rung", "rung change")
                                run.sweep_folds(label, arms_at(z))
                                if rung == "Structure" and z == 1.0:
                                    opened = run.open_all_arms(label)
                                    if opened:
                                        run.check_pills_stay_put(label, opened)
                                        run.check_pill_reopen(label)
                                run.sweep_all(label)
                            if len(zooms) > 1:
                                run.open_fixture(query)  # back to 100% for the next zoom
                        if soak_cycles:
                            if run.motion_now:
                                run.timed(lambda: run.set_rung("Structure"), f"{name} · Structure · z1.0 · soak", "rung", "rung change")
                                run.soak(f"{name} · Structure · z1.0", soak_cycles)
                            else:
                                run.note_skip("hold soak (motion layer off: nothing is held)", name)
                                run.note_skip("draw window (motion layer off: nothing is drawn)", name)
                        elif run.motion_now:
                            run.note_skip("draw window (soak off: only odd soak cycles probe it)", name)
                        else:
                            run.note_skip("draw window (motion layer off: nothing is drawn)", name)
                    except PWError as err:
                        run.interruptions.append((time.time(), name, str(err).strip().splitlines()[0][:140]))
                        if not run.quiet:
                            print(f"  INTERRUPTED {name}: {run.interruptions[-1][2]}")
                context.close()
        finally:
            browser.close()

    assert run is not None
    bad = [s for s in run.samples if s.fatal]
    kinds: dict[str, int] = {}
    for s in run.samples:
        for p in s.fatal:
            kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    print()
    if missing:
        print(f"SKIPPED (the dev server 404'd these — is RIPPIT_MAP_SNAPSHOT_DIR set on it?): {', '.join(missing)}")
    print(f"fold plan measured: {', '.join(sorted(run.plans))}")
    # Stated, not assumed: trunk-and-stub routing only exists past ELBOW_AT
    # children, so this is the line that says whether the sweep ever drew the
    # shape a nine-outcome router takes.
    print("transitions measured: " + ", ".join(f"{kind} {n}" for kind, n in run.transitions.items()))
    def stamp_at(at: float) -> str:
        return f"{time.strftime('%H:%M:%S', time.localtime(at))}.{int(at % 1 * 1000):03d}"

    print(f"source changed during the run (hot updates applied, full reloads): {len(run.reloads)}")
    for at, text in run.reloads:
        print(f"  {stamp_at(at)}  {text}")
    # Said outright, so a run cannot measure motion-off geometry as if motion
    # were on without anyone noticing: a press past LITE_AT switches it off.
    print(f"motion layer switched by a press: {len(run.motion_changes)}")
    for at, where, on in run.motion_changes:
        print(f"  {stamp_at(at)}  motion layer {'on again' if on else 'off'} after: {where}")
    print(f"map remounts detected: {len(run.remounts)}")
    # A remount is only seen at the next probe, so it is paired with the last
    # thing the dev client said before it: a remount with no source change
    # behind it is otherwise a timestamp with no cause attached.
    said = sorted(run.reloads + run.rebuild_notices)
    for at, where in run.remounts:
        print(f"  {stamp_at(at)}  first seen at {where}")
        before = [(t, text) for t, text in said if 0 <= at - t <= RELOAD_SHADOW_S]
        if before:
            t, text = before[-1]
            print(f"    ↳ {at - t:.1f}s after the dev client logged: {text}")
        else:
            print(f"    ↳ the dev client logged no rebuild or reload in the {RELOAD_SHADOW_S:.0f}s before it")
    print(f"rebuild notices, including no-op builds from other pages: {len(run.rebuild_notices)}")
    for at, text in run.rebuild_notices:
        print(f"  {stamp_at(at)}  {text}")
    blocked_total = sum(blocked.values())
    print(
        f"analytics requests blocked: {blocked_total}"
        + (" — " + ", ".join(f"{where} ×{n}" for where, n in blocked.most_common(6)) if blocked else "")
    )
    if not blocked and api_host:
        print(
            "  PostHog is configured, yet nothing was blocked: either the app stopped sending, or it now sends\n"
            "  somewhere this does not match — and then this run sent it all."
        )
    print(f"hold soak cycles completed: {run.soak_cycles_done}")
    if run.pill_counts:
        print("pill edges with every arm open: " + ", ".join(f"{k} {n}" for k, n in sorted(run.pill_counts.items())))
    print(skips_summary(run.skips))
    widest = max((s.widest_fan_out for s in run.samples), default=0)
    print(f"widest fan-out measured: {widest} arms" + ("" if widest else " (no trunk-routed fan-out was drawn)"))
    print(f"{len(run.samples)} samples in {time.time() - t0:.0f}s · {len(bad)} with problems")

    # How late the in-flight samples ran. They are aimed at a window that opens
    # on the model commit and closes when the geometry catches up, so a sample
    # that lands well past its offset was not looking where it meant to. Stated
    # on every run, because a clean sweep whose samples all arrived late is a
    # weaker claim than a clean sweep, and the difference is invisible unless
    # it is printed.
    # The wall-clock ones only: a draw-window sample is locked to a frame, so it
    # cannot be late, and counting it would pull the median toward zero.
    flight = [s for s in run.samples if s.when.startswith("+")]
    median_late = 0.0
    if flight:
        drift = sorted(s.late_ms for s in flight)
        median_late = drift[len(drift) // 2]
        print(f"in-flight samples landed {median_late:+.0f}ms from their offset (median), {drift[-1]:+.0f}ms (worst)")

    # Beside the skew, because they are the same kind of claim: when things
    # happened, measured rather than assumed. A hold fix claims to move these.
    draw_starts: list[float | None] = []
    fully_drawn: list[float | None] = []
    def beside(at: float, until: float) -> str:
        """Whether a reload, rebuild or remount came near a transition — or that none did."""
        events = [(t, f"the dev client logged {text}") for t, text in run.reloads + run.rebuild_notices]
        events += [(t, f"a remount was first seen at {where}") for t, where in run.remounts]
        near = [(t, what) for t, what in events if at - RELOAD_SHADOW_S <= t <= until]
        if not near:
            return f"no reload, rebuild or remount from {RELOAD_SHADOW_S:.0f}s before its click until it finished"
        t, what = min(near, key=lambda e: abs(e[0] - at))
        return f"{what} {abs(t - at):.1f}s {'before' if t <= at else 'after'} its click"

    groups = ("rung change", "reopen arm", "reopen pill")
    print("timings from clicks no draw-window probe touched — the quoted figures:")
    for group in groups:
        lines = [t for t in run.timings.get(group, []) if not t.get("probed")]
        holds = [t.get("holdStart") for t in lines]
        starts = [t.get("drawStart") for t in lines]
        dones = [t.get("fullyDrawn") for t in lines]
        # How long each line was held: the part a hold bound governs, separated
        # from the click-to-commit time it does not.
        held_for = [d - h if d is not None and h is not None else None for h, d in zip(holds, starts)]
        if group == "rung change":
            draw_starts, fully_drawn = starts, dones
        held_nothing = run.no_hold.get(group, 0)
        suffix = f"; {held_nothing} held nothing" if held_nothing else ""
        print(timing_line(f"hold start after a {group}", holds))
        print(timing_line(f"draw start after a {group}", starts) + suffix)
        print(timing_line(f"lines held for, after a {group}", held_for))
        # A count, not only a worst: one slow transition cannot say whether a
        # timing change reaches the founder, and a count over enough clicks can.
        over = sum(1 for d in dones if d is None or d > SETTLE_MS)
        print(timing_line(f"every line drawn after a {group}", dones) + (f"; over {SETTLE_MS}ms: {over} of {len(dones)}" if dones else ""))
        # The worst named, not just its number: a slow outlier with a time and a
        # transition can be checked against the stamps above, and one without
        # them can only be argued about. Its hold and draw start say whether it
        # stalled before its draw or during it.
        stuck = [t for t in lines if t.get("fullyDrawn") is None]
        if stuck:
            t = stuck[0]
            print(
                f"  ↳ {len(stuck)} never finished drawing inside the recording; the first was clicked at "
                f"{stamp_at(t.get('clicked_at', 0.0))}, {t.get('scenario')} — {beside(t.get('clicked_at', 0.0), t.get('clicked_at', 0.0) + 4.2)}"
            )
        finished = [t for t in lines if t.get("fullyDrawn") is not None]
        if finished:
            t = max(finished, key=lambda x: x["fullyDrawn"])
            at = t.get("clicked_at", 0.0)
            phases = ", ".join(
                part
                for part in (
                    f"held from {t['holdStart']:.0f}" if t.get("holdStart") is not None else "",
                    f"drawing from {t['drawStart']:.0f}" if t.get("drawStart") is not None else "",
                )
                if part
            )
            print(
                f"  ↳ slowest: every line drawn at {t['fullyDrawn']:.0f}ms ({phases}), clicked at {stamp_at(at)}, "
                f"{t.get('scenario')} — {beside(at, at + t['fullyDrawn'] / 1000)}"
            )
            if t.get("maxFrameGap"):
                print(f"    longest gap between frames: {t['maxFrameGap']}ms, from +{t.get('maxFrameGapAt')}ms")
            for line in fmt_long_frames(t.get("longFrames", [])):
                print(f"    {line}")

    def ms(value: float | None) -> str:
        return "not measured" if value is None else f"{value:+.0f}ms"

    # What looking inside the draw cost: the same soak transitions, probed and
    # not, so the quoted figures can be trusted to be the unprobed map's. And
    # whether either kind of cycle stalled: a probe that causes stalls would
    # show here as longer frame gaps on the probed side only.
    for group in groups:
        soaked = [t for t in run.timings.get(group, []) if t.get("soak")]
        probed = [t for t in soaked if t.get("probed")]
        clean = [t for t in soaked if not t.get("probed")]
        if not probed:
            continue
        print(
            f"draw-window probes' cost after a {group} (probed minus unprobed soak cycles, medians): "
            f"draw start {ms(probe_cost([t.get('drawStart') for t in probed], [t.get('drawStart') for t in clean]))}, "
            f"every line drawn {ms(probe_cost([t.get('fullyDrawn') for t in probed], [t.get('fullyDrawn') for t in clean]))}"
            f" (n={len(probed)} probed, {len(clean)} not)"
        )
    for group in groups:
        every = run.timings.get(group, [])
        if not every:
            continue
        sides = []
        for name, side in (("unprobed", [t for t in every if not t.get("probed")]), ("probed", [t for t in every if t.get("probed")])):
            gaps = sorted(t["maxFrameGap"] for t in side if t.get("maxFrameGap") is not None)
            if gaps:
                sides.append(f"{name} median {gaps[len(gaps) // 2]}ms / worst {gaps[-1]}ms (n={len(gaps)})")
        if sides:
            print(f"longest gap between frames in a {group}: " + " · ".join(sides))

    in_flight = [s for s in run.samples if s.when.startswith("+")]
    if in_flight:
        closest = max(in_flight, key=lambda s: s.max_visible_off)
        print(
            f"largest offset on a visible line in flight: {closest.max_visible_off:.1f}px "
            f"(tolerance {TOL_INFLIGHT:.0f}px) at {closest.when}, {closest.scenario}"
            + (f", {short(closest.max_visible_key)}" if closest.max_visible_key else "")
        )

    # Inside the draws, by the kind of press that drew the lines: whether a line
    # was on screen while one of its cards was still arriving, and how far any
    # visible line was from its card.
    drawing = [s for s in run.samples if s.when.startswith("draw+")]
    for group in ("rung change", "first open", "reopen arm", "pill expand", "reopen pill", "descend"):
        probed = [t for t in run.timings.get(group, []) if t.get("probed")]
        if not probed:
            continue
        samples = [s for s in drawing if s.group == group]
        print(
            f"draw window after a {group}: {len(probed)} probed, {len(samples)} samples inside draws, "
            f"{sum(s.ends_judged for s in samples)} line ends judged"
        )
        if samples:
            closest = max(samples, key=lambda s: s.max_visible_off)
            print(
                f"  largest offset on a visible line while drawing: {closest.max_visible_off:.1f}px "
                f"(fails past {TOL_INFLIGHT:.0f}px) at {closest.when}, {closest.since_draw_ms:.0f}ms after the draw started, "
                f"{closest.scenario}" + (f", {short(closest.max_visible_key)}" if closest.max_visible_key else "")
            )
            dashy = max(samples, key=lambda s: s.max_dash_delta)
            print(
                f"  largest dash off its path's length while drawing: {dashy.max_dash_delta:.1f}px "
                f"(fails past {TOL_INFLIGHT:.0f}px mid-draw, 1px settled)"
                + (f" at {dashy.when}, {dashy.scenario}, {short(dashy.max_dash_key)}" if dashy.max_dash_key else "")
            )
            print(f"  far ends the draw had not reached yet, judged at their start only: {sum(s.not_drawn_yet for s in samples)}")
        at_draw = [(t.get("census") or {}).get("atDraw") for t in probed]
        arriving = sum(1 for c in at_draw if c and c.get("arriving", 0) > 0)
        print(f"  cards still arriving when the draw started: on {arriving} of {len(probed)}")
        early = [p for s in samples for p in s.fatal if p["kind"] == "EARLY"]
        print(
            f"  lines on screen while a card was still arriving (each fails its sample): {len(early)}"
            + (f", first {short_key(early[0]['key'])}" if early else "")
        )
    if not drawing and any(t.get("drawStart") is not None for lines in run.timings.values() for t in lines):
        print("draw window: not sampled — no probed press drew lines")

    # How far lines trail their cards with nothing failing: the largest offset
    # on a visible line in each kind of transition, passing samples included.
    transition_kinds = sorted({s.kind for s in run.samples if s.kind})
    if transition_kinds:
        print("largest offset on a visible line, by transition (in flight · inside draws · settled):")
        for kind in transition_kinds:
            cells = []
            for name, test in (
                ("in flight", lambda s: s.when.startswith("+")),
                ("inside draws", lambda s: s.when.startswith("draw+")),
                ("settled", lambda s: s.when == "settled"),
            ):
                among = [s for s in run.samples if s.kind == kind and test(s)]
                if among:
                    top = max(among, key=lambda s: s.max_visible_off)
                    cells.append(f"{top.max_visible_off:.1f}px of {len(among)}")
                else:
                    cells.append("—")
            print(f"  {kind:<14} " + " · ".join(cells))

    if run.stalls:
        print(stall_report(run.stalls, TOL_INFLIGHT))

    settled = [s for s in run.samples if s.when == "settled"]
    if settled:
        after = sorted(s.settled_after_ms for s in settled)
        waited = sum(1 for s in settled if s.waited_for_draw)
        capped = sum(1 for s in settled if any(p["kind"] == "UNFINISHED" for p in s.fatal))
        print(
            f"settled samples taken at: median {after[len(after) // 2]:.0f}ms, worst {after[-1]:.0f}ms after the action; "
            f"{waited} waited past {SETTLE_MS}ms for drawing to finish; {capped} reached the {SETTLE_CAP_MS}ms cap"
        )
        # A hold left behind with motion off is seen again at every sample until
        # something clears it; the distinct lines are the number that matters.
        stale: dict[str, Sample] = {}
        for s in run.samples:
            for p in s.fatal:
                if p["kind"] == "STALE-HOLD":
                    stale.setdefault(p["key"], s)
        if stale:
            key, first = next(iter(stale.items()))
            print(f"holds left on lines with the motion layer off: {len(stale)} distinct, first {short_key(key)} in {first.scenario}")
        # A failsafe release stays marked on its line, so every later settled
        # sample fails it again; the distinct lines are the number that matters.
        released = {}
        for s in settled:
            for p in s.fatal:
                if p["kind"] == "FAILSAFE":
                    released.setdefault(p["key"], s)
        if released:
            key, first = next(iter(released.items()))
            print(
                f"lines the hold's failsafe had to release: {len(released)} distinct, "
                f"first {short_key(key)} in {first.scenario}"
            )
        waiting = [s for s in settled if s.held_unrevealed]
        top = max(settled, key=lambda s: s.held_unrevealed)
        print(
            f"held for an unrevealed card: {top.held_unrevealed}"
            + (f" at most, in {top.scenario}; at {len(waiting)} settled samples" if waiting else "")
        )
        # Stated, not assumed: a PASS says nothing about pairs it never judged,
        # and pairs not judged are a blind spot even when the run passes. No
        # pair is a column link until the layout draws one.
        def align_count(s: Sample, anchor: str) -> tuple[int, int]:
            return (s.align_judged or {}).get(anchor, 0), (s.align_unjudged or {}).get(anchor, 0)

        align_cells = []
        for anchor, what in (("v", "column links"), ("h", "chain links between steps")):
            align_counts = [align_count(s, anchor) for s in settled]
            align_cells.append(
                f"{what} {sum(j for j, _ in align_counts)} judged, {sum(n for _, n in align_counts)} not judged"
            )
        align_blind = next((s for s in settled if any((s.align_unjudged or {}).values())), None)
        print(
            f"alignment, summed over {len(settled)} settled sample{'s' if len(settled) != 1 else ''}: "
            + "; ".join(align_cells)
            + (
                f" — first not judged in {align_blind.scenario}: a card transform the probe could not take out"
                if align_blind
                else ""
            )
        )
        # The same pair fails at every settled sample until the layout changes;
        # the distinct pairs are the number that matters.
        off_grid: dict[str, tuple[dict, Sample]] = {}
        for s in settled:
            for p in s.fatal:
                if p["kind"] == "ALIGN" and (p["key"] not in off_grid or p["off"] > off_grid[p["key"]][0]["off"]):
                    off_grid[p["key"]] = (p, s)
        if off_grid:
            worst, where = max(off_grid.values(), key=lambda found: found[0]["off"])
            print(
                f"cards off the grid past {ALIGN_PX:g}px: {len(off_grid)} distinct pair(s), worst in {where.scenario}:"
            )
            print(f"  {fmt_problem(worst)}")

    # A gate that can pass while measuring nothing is worse than no gate: it
    # launders confidence. Every fixture 404'ing once produced "PASS — 0
    # samples", which is indistinguishable at a glance from a clean sweep and
    # was nearly cited as one. Exit 2 rather than 1, so a broken harness and a
    # broken map are not the same signal.
    reload_count = len(run.reloads)
    code, head = run_outcome(
        len(run.samples), len(bad), len(run.interruptions), len(run.unperformed), remounts=len(run.remounts),
        # Lines drawn at all: a recorded press whose draw started.
        draw_expected=any(t.get("drawStart") is not None for lines in run.timings.values() for t in lines),
        draw_ends_judged=sum(s.ends_judged for s in drawing),
        # Column and step-to-step chain links drawn at a settled sample (the most
        # in one), and how many pairs alignment judged across the whole run.
        align_drawn=max(
            (sum((s.align_judged or {}).values()) + sum((s.align_unjudged or {}).values()) for s in settled),
            default=0,
        ),
        align_judged=sum(sum((s.align_judged or {}).values()) for s in settled),
    )

    def quote(head_line: str) -> str:
        return quote_line(
            head_line, draw_starts, fully_drawn, soak_cycles, run.soak_cycles_done, reload_count,
            analytics_blocked=blocked_total,
        )

    if run.interruptions:
        print(f"\nsweep interrupted {len(run.interruptions)} time(s) — each fixture below was abandoned part-way:")
        for at, name, message in run.interruptions:
            print(f"  {stamp_at(at)}  {name}: {message}")
    if run.remounts:
        print(f"\nthe map remounted {len(run.remounts)} time(s) mid-run — every step after each ran against a reset map:")
        for at, where in run.remounts:
            print(f"  {stamp_at(at)}  first seen at {where}")
    if run.unperformed:
        print(f"\n{len(run.unperformed)} planned control press(es) could not be made:")
        for u_ in run.unperformed[:8]:
            print(f"  {u_}")
    if code == 2 and not run.samples:
        print("\nFAIL — nothing was measured, so this proves nothing.")
        print("       Every fixture was skipped; see SKIPPED above." if missing else "       Is the dev server up at the --url given?")
        print(quote(head))
        return code
    if code == 1:
        print("  " + "  ".join(f"{k}×{v}" for k, v in sorted(kinds.items())))
        worst = sorted(bad, key=lambda s: -len(s.fatal))[:8]
        print("\nworst samples")
        for s in worst:
            print(f"  {len(s.fatal):>4} bad  {s.when:<9} z{s.zoom}  {s.scenario}")
            print(f"        {fmt_problem(s.fatal[0])}")
            if s.fatal[0].get("arriving") and s.fatal[0]["kind"] == "OFFSET":
                print(f"          {fmt_arriving(s.fatal[0])}")
            print(
                f"        ↳ taken at {stamp_at(s.at)}"
                + (f", {s.frame_gap}ms after the frame before it" if s.frame_gap is not None else "")
            )
            for line in fmt_long_frames(s.long_frames):
                print(f"        ↳ {line}")
            for line in s.second_look:
                print(f"          {line.strip()}" if line.startswith("  ") else f"        ↳ {line}")
            since = [s.at - t for t, _ in run.reloads + run.remounts if 0 <= s.at - t <= RELOAD_SHADOW_S]
            if since:
                print(f"        ↳ {min(since):.1f}s after the source changed or the map remounted — may be that, not the map")
        print("\nFAIL — the map has lines that are not attached to their cards.")
        if run.reloads or run.remounts or run.interruptions:
            print(
                f"  The source changed {len(run.reloads)} time(s), the map remounted {len(run.remounts)} time(s) and the\n"
                f"  sweep was interrupted {len(run.interruptions)} time(s) during this run. A remount re-holds every line, so\n"
                "  check a failure is not beside one before blaming the map."
            )
        print(quote(head))
        return code
    if code == 2:
        print(
            "\nFAIL — the sweep did not do everything it planned (see above), so it measured less than it\n"
            "       claims. That is the checker failing to do its job, not the map: exit 2."
        )
        print(quote(head))
        return code
    # A fixture counts as real coverage because it was loaded from a snapshot,
    # not because its name is missing from a list of synthetic ones.
    snapshots = {name for query, name in fixtures if query.startswith("?snapshot=")}
    reached = reached_fixtures(run.plans)
    unexercised = [kind for kind, n in run.transitions.items() if n == 0]
    verdict = pass_verdict(
        reached, snapshots, missing, len(fixtures) * len(modes), median_late, SETTLE_MS,
        unexercised=unexercised,
        reloads=reload_count,
        draw_start_median=median_of(draw_starts),
        fully_drawn_median=median_of(fully_drawn),
        # Motion mode ran with its layer on somewhere, so there were holds to time.
        timing_expected=any(s.motion for s in run.samples),
    )
    print(verdict)
    print(
        quote_line(
            verdict.splitlines()[0], draw_starts, fully_drawn, soak_cycles, run.soak_cycles_done, reload_count,
            analytics_blocked=blocked_total,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
