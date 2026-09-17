"""
Verdict assertions — `npm run check:map` runs these, alongside the model checks.

Standard library only: no browser, no dev server, no Playwright. That is the
point of them. The geometry sweep itself needs a running dev server and ~25
minutes, so it cannot gate every change — but the logic that decides what its
PASS is allowed to claim can, and that logic has been wrong twice, silently
each time. These run in a fraction of a second whether the dev server is up,
down or mid-change.

Three properties matter above the rest:

  - the first line of a verdict carries every qualifier that applies, so it can
    be quoted on its own and still be true;
  - a run whose in-flight samples landed late never claims "in flight and
    settled", but keeps its settled claim at full strength;
  - a full, on-time sweep prints exactly the line every number quoted so far
    was taken from, so those numbers keep meaning what they meant.

Run directly with any python3:

    python3 scripts/mapGeometryVerdict.check.py
"""

from __future__ import annotations

import sys

# No __pycache__ appearing in `scripts/` just because a check imported a module.
sys.dont_write_bytecode = True

from pathlib import Path  # noqa: E402

from mapGeometryVerdict import (  # noqa: E402
    ALIGN_PX,
    LATE_MS_SUSPECT,
    MEMORY_LOW_PCT,
    analytics_pattern,
    classify,
    follow_verdict,
    is_analytics,
    pass_verdict,
    probe_cost,
    quote_line,
    reached_fixtures,
    run_outcome,
    second_look_verdict,
    settle_decision,
    skips_summary,
    sweep_stamp,
    timing_line,
    unfinished_problem,
)

checks = 0


def check(cond: object, msg: str, got: object = None) -> None:
    global checks
    checks += 1
    if not cond:
        print(f"✗ {msg}", file=sys.stderr)
        if got is not None:
            print(f"  got: {got!r}", file=sys.stderr)
        sys.exit(1)
    print(f"✓ {msg}")


# Written out, never derived from `pass_verdict`: a check that computes its
# expected value with the function under test can only ever agree with it.
# This is the line the 1796-sample figure was quoted from.
QUOTED = "PASS — every line is attached to both of its cards, in flight and settled."

SETTLE_MS = 2100
SNAPSHOTS = {"ghl-pcf-live", "ghl-119", "make-102"}
RUNS = 12  # six fixtures × two motion modes
ON_TIME = 23.0
LATE = 210.0

# ── Which fixtures a run reached ─────────────────────────────────────────────

check(
    reached_fixtures(["big/LITE/no-motion=graph"]) == {"big/LITE"},
    "a fixture name containing a slash is reached whole — 'big/LITE', never 'big'",
    got=reached_fixtures(["big/LITE/no-motion=graph"]),
)
check(
    reached_fixtures(["ghl-pcf-live/motion=served", "ghl-pcf-live/no-motion=served"]) == {"ghl-pcf-live"},
    "both motion modes of one fixture are one fixture reached",
)
check(reached_fixtures([]) == set(), "a run with no plan records reached no fixture")

full = reached_fixtures(["shapes/motion=served", "big/LITE/motion=graph", "ghl-pcf-live/motion=served"])
synthetic = reached_fixtures(["shapes/motion=served", "big/LITE/no-motion=graph"])
quick = reached_fixtures(["shapes/motion=served"])

# ── The line every quoted number came from ──────────────────────────────────

verdict = pass_verdict(full, SNAPSHOTS, [], RUNS, ON_TIME, SETTLE_MS)
check(
    verdict == QUOTED,
    "a full, on-time sweep with no motion layer to time prints exactly the line the 1796-sample figure was quoted from",
    got=verdict,
)

# ── Every coverage × timing combination ─────────────────────────────────────
#
# Expectations are stated per case, not inferred from the case's name.

cases = [
    # name, reached, snapshots, missing, runs, median skew, late, fixtures only, partial
    ("full, on time", full, SNAPSHOTS, [], RUNS, ON_TIME, False, False, False),
    ("full, late", full, SNAPSHOTS, [], RUNS, LATE, True, False, False),
    ("partial, on time", full, SNAPSHOTS, ["ghl-119/motion"], RUNS, ON_TIME, False, False, True),
    ("partial, late", full, SNAPSHOTS, ["ghl-119/motion"], RUNS, LATE, True, False, True),
    ("fixtures only, on time", synthetic, SNAPSHOTS, ["ghl-pcf-live/motion"], RUNS, ON_TIME, False, True, False),
    ("fixtures only, late", synthetic, SNAPSHOTS, ["ghl-pcf-live/motion"], RUNS, LATE, True, True, False),
    # `--quick` sweeps one synthetic fixture and has no snapshots in it at all.
    ("--quick, on time", quick, set(), [], 1, ON_TIME, False, True, False),
]

for name, reached, snapshots, missing, runs, median, late, fixtures_only, partial in cases:
    first = pass_verdict(reached, snapshots, missing, runs, median, SETTLE_MS).splitlines()[0]
    check(first.startswith("PASS"), f"[{name}] the verdict opens with PASS", got=first)
    check(
        ("in-flight samples late" in first) == late,
        f"[{name}] the first line says the in-flight samples were late exactly when they were",
        got=first,
    )
    check(
        not (late and "in flight and settled" in first),
        f"[{name}] a late run never claims in flight and settled",
        got=first,
    )
    check(
        not late or ("once settled" in first and f"{LATE:+.0f}ms" in first),
        f"[{name}] a late run keeps its settled claim and states the skew in the first line",
        got=first,
    )
    check(
        ("fixtures only" in first) == fixtures_only,
        f"[{name}] the first line says fixtures only exactly when no real workflow was reached",
        got=first,
    )
    check(
        ("1 of 12 fixture runs skipped" in first) == partial,
        f"[{name}] the first line counts skipped fixture runs exactly when real coverage is partial",
        got=first,
    )
    check(
        "never exercised" not in first,
        f"[{name}] a run that performed every transition kind claims none went unexercised",
        got=first,
    )
    check(
        "reloaded" not in first,
        f"[{name}] a run the page never reloaded during says nothing about reloads",
        got=first,
    )

# ── The threshold ───────────────────────────────────────────────────────────

at = pass_verdict(full, SNAPSHOTS, [], RUNS, LATE_MS_SUSPECT, SETTLE_MS).splitlines()[0]
past = pass_verdict(full, SNAPSHOTS, [], RUNS, LATE_MS_SUSPECT + 1, SETTLE_MS).splitlines()[0]
check("in-flight samples late" not in at, "a median skew exactly at the threshold is not late", got=at)
check("in-flight samples late" in past, "a median skew just past the threshold is late", got=past)

# ── Transitions the run never performed ─────────────────────────────────────
#
# A sweep step whose locator stops matching the map samples nothing and
# returns. Unless the verdict names it, the run goes on passing one transition
# kind short — which is exactly how a member split dropped out of the sweep.

skipped_kinds = pass_verdict(full, SNAPSHOTS, [], RUNS, ON_TIME, SETTLE_MS, unexercised=["descend", "ascend"])
first = skipped_kinds.splitlines()[0]
check(
    "never exercised: descend, ascend" in first,
    "a transition kind the whole run never performed is named in the first line",
    got=first,
)
check(
    "every line measured is" in first and "every line is attached" not in first,
    "a run missing a transition kind claims only what it measured",
    got=first,
)
check(
    "locator no longer matches" in skipped_kinds,
    "the verdict says why a transition kind can go unexercised",
    got=skipped_kinds,
)

everything = pass_verdict(
    full, SNAPSHOTS, ["ghl-119/motion"], RUNS, LATE, SETTLE_MS, unexercised=["descend", "ascend"]
).splitlines()[0]
check(
    everything.startswith(
        "PASS (1 of 12 fixture runs skipped; never exercised: descend, ascend; in-flight samples late)"
    ),
    "every qualifier that applies lands in the first line together, separated so a listed one stays readable",
    got=everything,
)

# ── The code changing under the run ─────────────────────────────────────────
#
# A hot reload mid-sweep means the samples describe two versions of the map,
# and it remounts the map, which re-holds lines on its own. Nothing in a sample
# shows that; only the count does, so the verdict must carry it.

reloaded = pass_verdict(full, SNAPSHOTS, [], RUNS, ON_TIME, SETTLE_MS, reloads=2)
first = reloaded.splitlines()[0]
check(
    "source reloaded mid-run ×2" in first,
    "a run the page hot-reloaded during says so in the first line, with the count",
    got=first,
)
check(
    "one version of the code" in reloaded,
    "the verdict says what a reload mid-run costs the result",
    got=reloaded,
)
all_four = pass_verdict(
    full, SNAPSHOTS, ["ghl-119/motion"], RUNS, LATE, SETTLE_MS, unexercised=["descend"], reloads=1
).splitlines()[0]
check(
    all_four.startswith(
        "PASS (1 of 12 fixture runs skipped; never exercised: descend; source reloaded mid-run ×1; in-flight samples late)"
    ),
    "coverage, transitions, reloads and timing qualifiers all land in the first line, in that order",
    got=all_four,
)

# ── What decides coverage ───────────────────────────────────────────────────

added = pass_verdict({"tall"}, SNAPSHOTS, [], RUNS, ON_TIME, SETTLE_MS).splitlines()[0]
check(
    "fixtures only" in added,
    "a synthetic fixture the sweep adds later is not mistaken for real coverage — no list to forget",
    got=added,
)
slow = pass_verdict(full, SNAPSHOTS, [], RUNS, LATE, 3000)
check(
    "3000ms" in slow,
    "the late explanation reports the settle wait it was given, not a copy of it",
    got=slow,
)

# ── The stamp: what a run set out to do ─────────────────────────────────────
#
# A defect that shows one time in three passes a single attempt two times in
# three by luck. The repeat count is what turns a PASS into evidence, so the
# stamp must carry it; and free memory, because a paging machine slides every
# in-flight sample late.


def stamp(**over: object) -> str:
    base: dict[str, object] = dict(
        fixtures=["shapes", "ghl-pcf-live"],
        rungs=["Overview", "Structure", "Steps"],
        zooms=[1.0, 0.8],
        modes=["motion", "no-motion"],
        quick=False,
        soak_cycles=8,
        memory_free=34.0,
        in_flight_ms=[140, 340, 560],
        settle_floor_ms=2100,
        settle_cap_ms=4000,
        tol_inflight=20.0,
        tol_settled=1.5,
        draw_probe_frames=(0, 2, 4, 8, 16, 32),
        long_frames="long-animation-frame",
        stall=None,
        analytics_host="https://us.i.posthog.com",
    )
    base.update(over)
    return sweep_stamp(**base)  # type: ignore[arg-type]


full_stamp = stamp()
check("hold soak 8 cycles per fixture" in full_stamp, "the stamp carries the hold soak's repeat count", got=full_stamp)
check("hold soak off" in stamp(soak_cycles=0), "a run with no soak says so rather than omitting the line")
check(
    "each fixture starts at 100 % with the content origin top-left" in full_stamp and "first-load framing" in full_stamp,
    "the stamp says every fixture starts from the same view, whatever the map's own framing chose",
    got=full_stamp,
)
check(
    "34% free at start" in full_stamp and "low" not in full_stamp.split("memory", 1)[1],
    "the stamp states free memory at the start, and does not call ample memory low",
    got=full_stamp,
)
low = stamp(memory_free=MEMORY_LOW_PCT - 8)
check("low: expect in-flight samples to land late" in low, "the stamp flags low memory next to what it will cost", got=low)
check("unknown" in stamp(memory_free=None), "the stamp says when free memory could not be read")
check(
    "every foldable card pressed at z1.0" in full_stamp and "2 foldable cards pressed" in stamp(quick=True),
    "the stamp states how many cards a run presses, full or quick",
)
check(
    "reopened" in full_stamp and "pill" in full_stamp,
    "the stamp names the reopen and pill transitions it sets out to perform",
    got=full_stamp,
)

check("draw starts" in full_stamp and "fully drawn" in full_stamp, "the stamp says what the timing measures", got=full_stamp)
check(
    "start drawing and 2, 4, 8, 16, 32 frames on" in full_stamp
    and "every first arm open and pill expand, and rung changes and reopens on odd soak cycles only" in full_stamp,
    "the stamp says the draw itself is sampled, where, and at which frames",
    got=full_stamp,
)
check(
    "probes' cost" in full_stamp and "fails past 20.0px mid-draw, past 1px settled" in full_stamp,
    "the stamp says unprobed clicks carry the quote, and states the dash limits in flight and settled",
    got=full_stamp,
)
check(
    "a line on screen while either of its cards is still arriving fails" in full_stamp,
    "the stamp states the invariant the draw samples enforce: no line on screen before its cards have landed",
    got=full_stamp,
)
check(
    "only once every card it joins has been shown" in full_stamp and "counted apart" in full_stamp
    and "one the hold's failsafe" in full_stamp and "had to release fails once settled" in full_stamp,
    "the stamp says a line held for a card not yet shown is waiting, and one the failsafe released fails",
    got=full_stamp,
)
check(
    "long animation frames, attributed to scripts" in full_stamp
    and "long tasks only" in stamp(long_frames="longtask")
    and "not observable" in stamp(long_frames=None),
    "the stamp says which long-frame record this browser gave, and says so when it fell back or had none",
)
check(
    "stall" not in full_stamp.split("memory", 1)[1].split("analytics", 1)[0]
    and "diagnostic, no verdict: the main thread held busy 260ms at hold+100ms and at draw+1f"
    in stamp(stall=(260, ("hold+100ms", "draw+1f"))),
    "a run with injected stalls says so in the stamp, and one without does not mention them",
)

# ── Timing the hold's release ───────────────────────────────────────────────
#
# "No HELD" passes by luck against a rare defect; a draw-start time is measured
# on every transition. These pin that the numbers are honest about what they
# did not see — and, below, that a settled sample is never taken mid-draw.

timed = timing_line("draw start after a rung change", [900.0, 610.0, None, 700.0])
check(
    "median 700ms" in timed and "worst 900ms" in timed and "n=4" in timed,
    "a timing is reported as median and worst over every transition measured",
    got=timed,
)
check(
    "1 did not complete" in timed,
    "a transition whose measurement never completed is counted, never dropped from the figures",
    got=timed,
)
check(timing_line("draw start", []) == "draw start: not measured", "no measurements says not measured, not zero")
# ── When the settled sample is taken ────────────────────────────────────────
#
# A settled sample is a claim about a map that has stopped moving. It waits for
# the drawing to finish rather than for a fixed time, and a draw that never
# finishes is a failure, not a sample quietly taken anyway.

FLOOR, CAP = 2100, 4000
never_mid_draw = all(
    settle_decision(elapsed, held, drawing, FLOOR, CAP) != "sample"
    for elapsed in (0, 560, 2099, 2100, 2600, 3999, 4000, 6000)
    for held in (0, 1, 40)
    for drawing in (0, 1, 119)
    if held or drawing
)
check(never_mid_draw, "a settled sample is never taken while any line is held or drawing, at any elapsed time")
check(
    settle_decision(2600, 0, 0, FLOOR, CAP) == "sample",
    "a settled sample is taken as soon as drawing has finished past the floor",
)
check(
    settle_decision(1200, 0, 0, FLOOR, CAP) == "wait",
    "a transition that holds nothing still waits out the measure hook's own settle before sampling",
)
check(
    settle_decision(2400, 0, 12, FLOOR, CAP) == "wait",
    "a draw still running past the old fixed settle time is waited for, not sampled through",
)
check(
    settle_decision(CAP, 3, 0, FLOOR, CAP) == "capped" and settle_decision(CAP + 500, 0, 7, FLOOR, CAP) == "capped",
    "reaching the cap with lines still held or drawing is reported as capped",
)
check(
    settle_decision(CAP, 0, 0, FLOOR, CAP) == "sample",
    "reaching the cap with the drawing finished is an ordinary settled sample, not a failure",
)
unfinished = unfinished_problem(3, 12, CAP)
check(
    classify([unfinished], "settled", 1.5) == [unfinished] and classify([unfinished], "+140ms", 20.0) == [unfinished],
    "lines unfinished at the cap are a named failure wherever they are recorded",
    got=unfinished,
)
check(
    unfinished["kind"] == "UNFINISHED" and unfinished["held"] == 3 and unfinished["drawing"] == 12,
    "the cap failure is named, and says how many lines were still held and still drawing",
    got=unfinished,
)

# ── How a run ends ─────────────────────────────────────────────────────────
#
# Exit 2 is always the checker failing to do its job and exit 1 always the map,
# so a gate can tell them apart without reading a word of output.

check(run_outcome(0, 0, 0, 0) == (2, "FAIL (nothing measured)"), "a run that measured nothing exits 2, whatever else happened")
check(run_outcome(0, 0, 3, 1)[0] == 2 and "nothing measured" in run_outcome(0, 0, 3, 1)[1],
      "nothing measured takes precedence over an interruption")
check(run_outcome(500, 4, 1, 0) == (1, "FAIL (4 samples with problems)"),
      "a failing sample exits 1 even when the run was also interrupted — a line off its card is the map")
check(run_outcome(500, 0, 2, 0) == (2, "FAIL (sweep interrupted ×2)"),
      "an interrupted sweep with no failures exits 2: it measured less than it claims")
check(run_outcome(500, 0, 0, 3)[0] == 2, "planned presses that could not be made exit 2")
check(run_outcome(500, 0, 0, 0, remounts=1) == (2, "FAIL (map remounted mid-run ×1)"),
      "a remount with nothing thrown still exits 2, and says it was a remount rather than an error")
check(run_outcome(500, 0, 1, 0, remounts=2) == (2, "FAIL (sweep interrupted ×1; map remounted mid-run ×2)"),
      "an interruption and a remount in one run are both named")
check(run_outcome(500, 3, 0, 0, remounts=1)[0] == 1, "failing samples still exit 1 when the map also remounted")
check(run_outcome(500, 0, 0, 2, remounts=1)[1] == "FAIL (map remounted mid-run ×1)",
      "a remount outranks unperformed presses, which it can itself cause")

# ── The second look at a settled line off its card ──────────────────────────
#
# Three defects share one symptom, and the second look names which one a failure
# was. Pinned because a misnamed failure sends the fix to the wrong file.

still = {"ends": [{"end": "from", "drift": 0.0}, {"end": "to", "drift": 0.0}], "chain": []}
drifting = {"ends": [{"end": "from", "drift": 0.0}, {"end": "to", "drift": 0.8}], "chain": []}
animating = {
    "ends": [{"end": "to", "drift": 0.0}],
    "chain": [{"end": "to", "on": "card x", "animations": [{"what": "reveal", "state": "running", "progress": 0.9}]}],
}
finished_fill = {
    "ends": [{"end": "to", "drift": 0.0}],
    "chain": [{"end": "to", "on": "card x", "animations": [{"what": "reveal", "state": "finished", "progress": None}]}],
}
check(second_look_verdict(still, [2.5, 2.5], 1.5) == "left behind",
      "a line still off its card at the last look, with nothing moving, was left behind")
check(second_look_verdict(drifting, [0.3, 0.0], 1.5) == "still moving",
      "a card that drifted between frames and a line back on it: the sample came before the layout settled")
check(second_look_verdict(animating, [0.3, 0.0], 1.5) == "still moving",
      "a running animation on a card's chain counts as moving even when this frame's drift is zero")
check(second_look_verdict(finished_fill, [0.3, 0.0], 1.5) == "lagging",
      "a finished animation holding its last frame is not motion")
check(second_look_verdict(still, [0.2, 0.1], 1.5) == "lagging",
      "nothing moving and the line back on its card later: a measure caught up")
check(second_look_verdict(drifting, [3.0, 2.0], 1.5).startswith("left behind"),
      "still off at the last look is left behind even if something was moving when it failed")
check(second_look_verdict(still, [0.1, 2.0], 1.5) == "left behind",
      "judged at the last look: back on its card and off again is left behind")
check(second_look_verdict(still, [1.5, 1.5], 1.5) == "lagging",
      "exactly at tolerance is on its card, as `classify` has it")
check(second_look_verdict(still, [2.0, None], 1.5).startswith("not measured again"),
      "a line that could not be measured at the last look is not guessed at")
check(second_look_verdict({}, [], 1.5).startswith("not measured again"), "no looks at all is not measured again")

# ── What an in-flight line off its card did next ────────────────────────────


def looks(*frames: tuple[float | None, bool, float]) -> list[dict]:
    return [
        {"frame": n, "lines": [{"key": "e", "off": off, "lineMoved": line, "cardMoved": card}]}
        for n, (off, line, card) in zip((1, 3, 8), frames)
    ]


check(follow_verdict(looks((18.0, True, 0.0), (9.0, True, 0.0), (1.0, True, 0.0)), "e", 20.0).startswith("catching up"),
      "cards at rest and the line closing on them is a line catching up")
check(follow_verdict(looks((25.0, True, 3.0), (24.0, True, 2.0), (22.0, True, 1.0)), "e", 20.0) == "card moving, line following",
      "cards moving with the line moving too is named as following")
check(follow_verdict(looks((25.0, False, 3.0), (28.0, False, 2.0), (30.0, False, 1.0)), "e", 20.0) == "card moving, line not following",
      "cards moving while the line stays put is named as not following")
check(follow_verdict(looks((26.0, False, 0.0), (26.0, False, 0.0), (26.0, False, 0.0)), "e", 20.0) == "left behind",
      "nothing moving and still past the limit is left behind")
check(follow_verdict(looks((5.0, False, 0.0), (5.0, False, 0.0), (5.0, False, 0.0)), "e", 20.0).startswith("back within the limit"),
      "nothing moving and within the limit says it came back before the first look")
check(follow_verdict(looks((18.0, True, 0.0), (9.0, True, 0.0), (None, False, 0.0)), "e", 20.0).startswith("not measured again"),
      "a line that could not be measured at the last look is not guessed at")
check(follow_verdict(looks((26.0, False, 0.0)), "other", 20.0).startswith("not measured again"),
      "a line the looks do not carry is not measured")

# ── Analytics kept off the network ──────────────────────────────────────────
#
# PostHog starts on every page, and a certifying run loads the map hundreds of
# times. Blocked too little, a run sends synthetic traffic to the real project;
# blocked too much, the map's own requests go through interception or fail. The
# pattern is handed to the browser, so these cases were also run through
# JavaScript's RegExp when it was written, and read the same there.

HOST = "https://us.i.posthog.com"
for url, host, want, why in (
    ("https://us.i.posthog.com/e/?ip=0&_=1", HOST, True, "the configured host's event endpoint"),
    ("https://us-assets.i.posthog.com/static/recorder.js?v=1", HOST, True,
     "PostHog's asset host, which no host setting names"),
    ("https://us.i.posthog.com/flags/?v=2", None, True, "PostHog's own domain even with no host configured"),
    ("https://posthog.com", None, True, "the bare domain"),
    ("https://US.I.POSTHOG.COM/e/", "us.i.posthog.com", True, "a host written without a scheme, in any case"),
    ("https://ph.example.org/e/", "https://ph.example.org/", True, "a self-hosted or custom analytics host"),
    ("http://localhost:3000/ingest/e/?x=1", "/ingest", True, "a proxy path on the app's own origin"),
    ("http://localhost:3000/_next/static/chunks/app.js", HOST, False, "the map's own chunks"),
    ("http://localhost:3000/dev/workflow-map?shapes=1", "/ingest", False, "the page itself, with a proxy configured"),
    ("http://localhost:3000/ingestion-report", "/ingest", False, "a path that only starts with the proxy's name"),
    ("https://notposthog.com/x", None, False, "a domain that only ends in the same letters"),
    ("https://posthog.com.evil.example/x", None, False, "a host that only starts with PostHog's domain"),
    ("http://localhost:3000/dev/workflow-map?next=https://us.i.posthog.com/", HOST, False,
     "the app's URL carrying PostHog's in a query string"),
):
    check(is_analytics(url, host) is want, f"{'blocks' if want else 'leaves alone'}: {why}", got=(url, host))
check(
    analytics_pattern(HOST).startswith("^https?://") and "(?<" not in analytics_pattern("/ingest"),
    "the pattern is anchored and uses nothing JavaScript's RegExp reads differently",
    got=analytics_pattern("/ingest"),
)
check(
    "us.i.posthog.com and any posthog.com host aborted" in full_stamp,
    "the stamp names the configured analytics host and PostHog's own domain",
    got=full_stamp,
)
check(
    "NEXT_PUBLIC_POSTHOG_HOST not found" in stamp(analytics_host=None),
    "the stamp says when no analytics host was configured, so only PostHog's domain is blocked",
)
blocked_quote = quote_line("PASS", [900.0], [1800.0], 3, 3, 0, analytics_blocked=412)
check(
    blocked_quote.endswith("· 0 hot reloads · 412 analytics requests blocked"),
    "the quotable line carries how many analytics requests were blocked",
    got=blocked_quote,
)
check(
    quote_line("PASS", [], [], 8, 8, 0, analytics_blocked=0).endswith("· 0 analytics requests blocked"),
    "a run that blocked nothing says 0, rather than dropping the figure",
)
check(run_outcome(500, 0, 0, 0) == (0, "PASS"), "only a run with samples, no failures, no interruptions and nothing unperformed passes")
check(run_outcome(500, 0, 0, 0, draw_expected=True, draw_ends_judged=0) == (2, "FAIL (no line judged inside a draw)"),
      "a motion run that drew lines but judged no line end inside a draw cannot pass — however many samples it took there")
check(run_outcome(500, 0, 0, 0, draw_expected=True, draw_ends_judged=812) == (0, "PASS"),
      "the same run with line ends judged inside draws passes")
check(run_outcome(500, 0, 0, 0, draw_expected=False, draw_ends_judged=0) == (0, "PASS"),
      "a run that drew no lines — reduced motion, LITE — expects nothing judged inside a draw")
check(run_outcome(500, 2, 0, 0, draw_expected=True, draw_ends_judged=0)[0] == 1,
      "failing samples still exit 1 when nothing was judged inside a draw")
check(
    run_outcome(500, 0, 0, 0, align_drawn=42, align_judged=0) == (2, "FAIL (ALIGN judged nothing: 42 lines of that kind were drawn)"),
    "a run that drew column or step-to-step chain links and judged the alignment of none cannot pass — a probe "
    "that could read no card's transforms would look exactly like this",
)
check(run_outcome(500, 0, 0, 0, align_drawn=42, align_judged=1) == (0, "PASS"),
      "one pair judged anywhere in the run is enough; the not-judged count is reported, not failed on")
check(run_outcome(500, 0, 0, 0, align_drawn=0, align_judged=0) == (0, "PASS"),
      "a run that drew no column links and no step-to-step chain links expects no alignment judged")
check(run_outcome(500, 3, 0, 0, align_drawn=42, align_judged=0)[0] == 1,
      "failing samples still exit 1 when alignment judged nothing")
check(
    run_outcome(500, 0, 0, 0, draw_expected=True, draw_ends_judged=0, align_drawn=42, align_judged=0)
    == (2, "FAIL (no line judged inside a draw; ALIGN judged nothing: 42 lines of that kind were drawn)"),
    "both blind spots are named when both apply, not only the first",
)

check(probe_cost([900.0, 940.0, 910.0], [880.0, 890.0, 870.0]) == 30.0, "the probes' cost is probed median minus unprobed median")
check(probe_cost([900.0], []) is None and probe_cost([], [880.0]) is None,
      "the probes' cost is not measured without both probed and unprobed transitions")

# ── Judging only what is drawn ──────────────────────────────────────────────
#
# The rule lives in the probe, where the DOM is, as one pure function; this runs
# that function itself under node, so the check cannot drift from the probe.

import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402

ON_SCREEN_CASES = [
    # dasharray, dashoffset, path length now → which ends a reader can see
    (["", "", 100], {"start": True, "end": True}, "a line with no dash is not drawing: both ends count"),
    (["100", "100", 100], {"start": False, "end": False}, "released but not begun: neither end is drawn"),
    (["100", "60", 100], {"start": True, "end": False}, "part drawn: the start counts, the far end does not yet"),
    (["100", "0", 100], {"start": True, "end": True}, "the dash has reached the far end: both count"),
    (["100", "0.5", 100], {"start": True, "end": True}, "within a pixel of the far end counts as reached"),
    (["100", "0", 104], {"start": True, "end": False},
     "a path re-measured longer mid-draw: the dash stops short, so its far end is not on screen"),
    (["100px", "30px", 100], {"start": True, "end": False}, "values with units read the same"),
]
node = shutil.which("node")
check(node is not None, "node is on the path, to run the probe's own drawn-ends rule")
probe_source = (Path(__file__).parent / "mapGeometryProbe.js").read_text()
script = (
    probe_source
    + "\nprocess.stdout.write(JSON.stringify("
    + json.dumps([args for args, _, _ in ON_SCREEN_CASES])
    + ".map((a) => globalThis.__wmOnScreen(...a))));"
)
ran = subprocess.run([node or "node", "-e", script], capture_output=True, text=True, timeout=60)
check(ran.returncode == 0, "the probe loads and runs outside a browser", got=ran.stderr[-400:])
results = json.loads(ran.stdout)
for (args, want, why), got in zip(ON_SCREEN_CASES, results):
    check(got == want, why, got=(args, got))

# ── Where an anchored line's ends belong ────────────────────────────────────
#
# The rule for each anchor lives in the probe as one pure function; this runs it
# under node. The expected points are computed here from the measure hook's own
# constants, read out of `tokens.ts` itself — so a probe whose written-out copy
# of them drifts fails, and so does one whose rule does.

tokens_ts = Path(__file__).resolve().parent.parent / "src" / "lib" / "workflowMap" / "tokens.ts"
read_tokens = subprocess.run(
    [node or "node", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
     f"import * as t from {json.dumps(str(tokens_ts))}; "
     "process.stdout.write(JSON.stringify({EDGE_PAD: t.EDGE_PAD, CHAIN_RAIL_Y: t.CHAIN_RAIL_Y, DROP_X: t.DROP_X}))"],
    capture_output=True, text=True, timeout=60,
)
check(read_tokens.returncode == 0, "tokens.ts loads under node", got=read_tokens.stderr[-400:])
tokens = json.loads(read_tokens.stdout)
check(all(isinstance(tokens.get(name), (int, float)) for name in ("EDGE_PAD", "CHAIN_RAIL_Y", "DROP_X")),
      "tokens.ts exports EDGE_PAD, CHAIN_RAIL_Y and DROP_X as numbers", got=tokens)
pad, rail, drop = tokens["EDGE_PAD"], tokens["CHAIN_RAIL_Y"], tokens["DROP_X"]

step = {"left": 0, "top": 100, "right": 200, "bottom": 160}
next_step = {"left": 260, "top": 100, "right": 460, "bottom": 180}
pill = {"left": 60, "top": 220, "right": 300, "bottom": 260}
# A pill starting a row, nudged so its centre sits on the next card's rail.
row_pill = {"left": 0, "top": 100 + rail - 20, "right": 180, "bottom": 100 + rail + 20}
# A connected workflow's column: the next step stacked below, left-aligned.
below_step = {"left": 0, "top": 220, "right": 200, "bottom": 280}
# A pill capsule at the head of a column, left-aligned with its first step.
step_capsule = {"left": 0, "top": 100, "right": 260, "bottom": 160}
# A card whose left edge sits past the column it claims to leave from.
offset_step = {"left": 100, "top": 100, "right": 300, "bottom": 160}
# A pill whose name wraps: tall enough to have a rail, centred on the row's.
tall_pill = {"left": 0, "top": 100 + rail - 32, "right": 180, "bottom": 100 + rail + 32}
# A card shorter than two rail heights: a far-mode tile.
far_tile = {"left": 260, "top": 100, "right": 304, "bottom": 144}
# A card that ends above the rail it claims to leave from.
short_step = {"left": 0, "top": 40, "right": 200, "bottom": 100 + rail - 7}
ANCHOR_CASES = [
    (["h", step, next_step], [200 + pad, 100 + rail, 260 - pad, 100 + rail],
     "a chain link runs right edge to left edge on the target's rail, the same height at both ends"),
    (["h", row_pill, next_step], [180 + pad, 100 + rail, 260 - pad, 100 + rail],
     "a chain link leaving a nudged pill rides the target's rail, which crosses the pill's centre"),
    (["h", short_step, next_step], [200 + pad, 100 + rail - 7, 260 - pad, 100 + rail],
     "a chain link whose rail misses its source card is held to the card's edge, so a line beside it is off by the miss"),
    (["drop", step, pill], [0 + drop, 160 + pad, 60 - pad, 240],
     "a drop starts under its step at DROP_X and ends in the pill's left-centre"),
    (["v", step, below_step], [0 + drop, 160 + pad, 0 + drop, 220 - pad],
     "a column link runs straight down the target's puck column, bottom to top"),
    (["v", step_capsule, below_step], [0 + drop, 160 + pad, 0 + drop, 220 - pad],
     "a column link leaving a pill capsule uses the same column, which crosses the capsule"),
    (["v", offset_step, below_step], [100, 160 + pad, 0 + drop, 220 - pad],
     "a column link whose column misses its source card is held to the card's edge, so a line beside it is off by the miss"),
    ([None, step, next_step], [200 + pad, 100 + rail, 260 - pad, 100 + rail],
     "a line with no anchor runs rail to rail: CHAIN_RAIL_Y below each card's top, whatever the cards' heights"),
    ([None, row_pill, next_step, "wf:ghl:a", "wf:ghl:a/m:1"], [180 + pad, 100 + rail, 260 - pad, 100 + rail],
     "a line with no anchor leaves a pill from its centre — what sits on the rail — and lands on the next card's rail"),
    ([None, tall_pill, next_step, "wf:ghl:a", "wf:ghl:a/m:1"], [180 + pad, 100 + rail, 260 - pad, 100 + rail],
     "a pill tall enough to have a rail — its name wraps — is still met at its centre, not CHAIN_RAIL_Y below its top"),
    ([None, step, pill, "wf:ghl:a/m:1", "wf:ghl:a/m:1/wf:make:9"], [200 + pad, 100 + rail, 60 - pad, 240],
     "a line with no anchor into a pill lands on the pill's centre"),
    ([None, step, far_tile, "wf:ghl:a/m:1", "wf:ghl:a/m:1/m:9"], [200 + pad, 100 + rail, 260 - pad, 122],
     "a card shorter than two rail heights — a far-mode tile — is met at its centre, not below its middle"),
    (["diagonal", step, next_step], [200 + pad, 100 + rail, 260 - pad, 100 + rail], "an anchor the probe does not know gets the plain rule"),
]
anchor_script = (
    probe_source
    + "\nprocess.stdout.write(JSON.stringify({ tokens: globalThis.__wmTokens, wants: "
    + json.dumps([args for args, _, _ in ANCHOR_CASES])
    + ".map((a) => globalThis.__wmAnchorWant(...a)) }));"
)
ran = subprocess.run([node or "node", "-e", anchor_script], capture_output=True, text=True, timeout=60)
check(ran.returncode == 0, "the probe's anchor rule runs outside a browser", got=ran.stderr[-400:])
anchors = json.loads(ran.stdout)
check(anchors["tokens"] == tokens, "the probe's copy of EDGE_PAD, CHAIN_RAIL_Y and DROP_X matches tokens.ts", got=anchors["tokens"])
for (args, want, why), got in zip(ANCHOR_CASES, anchors["wants"]):
    check(got == want, why, got=(args[0], got))

# ── Where the layout put a card, and whether a pair is aligned ──────────────
#
# Both rules live in the probe as pure functions, run here under node. The boxes
# are worked out by hand from the transforms the map really applies: the hover
# lift on a card (`translate: 0 -2px`) and a selected card's growth on its motion
# box (`scale(1.025)` about the box's centre).


def layer(rect: tuple[float, float, float, float], **computed: str) -> dict:
    style = {"transform": "none", "translate": "none", "scale": "none", "rotate": "none", "origin": "100px 35px"}
    style.update(computed)
    return {"rect": dict(zip(("left", "top", "right", "bottom"), rect)), **style}


laid_out = {"left": 0, "top": 100, "right": 200, "bottom": 170}
grown = (-2.5, 99.125, 202.5, 170.875)  # the 200×70 card's motion box at scale(1.025)
LAYOUT_CASES = [
    ([layer((0, 100, 200, 170))], laid_out, "a card with no transform is where it is drawn"),
    ([layer((0, 98, 200, 168), translate="0px -2px")], laid_out,
     "a card lifted 2px under the pointer is still on its row: the lift is taken out"),
    ([layer(grown, transform="matrix(1.025, 0, 0, 1.025, 0, 0)"), layer(grown)], laid_out,
     "a selected card grows about its motion box's centre; the growth is taken out, so its edges stay put"),
    ([layer(grown, transform="matrix(1.025, 0, 0, 1.025, 0, 0)"), layer((-2.5, 97.075, 202.5, 168.825), translate="0px -2px")],
     laid_out, "selected and hovered at once: each is taken out about its own element's box"),
    ([layer(grown, scale="1.025"), layer(grown)], laid_out, "the `scale` property is taken out like a scale in `transform`"),
    ([layer((-3.25, 98.875, 263.25, 191.125), transform="matrix(1.025, 0, 0, 1.025, 0, 0)", origin="130px 45px"),
      layer((-3.25, 98.875, 263.25, 139.875), origin="130px 20px")],
     {"left": 0, "top": 100, "right": 260, "bottom": 140},
     "a card shorter than its motion box: the growth is taken out about the box's centre, not the card's"),
    ([layer((0, 108, 200, 178), transform="matrix(1, 0, 0, 1, 0, 8)"), layer((0, 108, 200, 178))], laid_out,
     "a shift on the motion box moves the card inside it, and is taken out of both"),
    ([layer((0, 100, 200, 170), transform="matrix(1, 0, 0, 1, 0, 0)")], laid_out, "a reveal's identity end state moves nothing"),
    ([layer((0, 98, 200, 168), transform="matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -2, 0, 1)")], laid_out,
     "a 3D matrix that only shifts is taken out like a 2D one"),
    ([layer((0, 100, 200, 170), rotate="0deg")], laid_out, "a zero rotate turns nothing"),
    ([layer((0, 100, 200, 170), transform="matrix(0.996, 0.087, -0.087, 0.996, 0, 0)")], None,
     "a rotated card cannot be taken back to its layout exactly, so it is not judged"),
    ([layer((0, 100, 200, 170), rotate="5deg")], None, "nor can one turned by the `rotate` property"),
    ([layer((0, 100, 200, 170), transform="matrix(-1, 0, 0, 1, 0, 0)")], None, "nor a flipped card"),
    ([layer((20, 100, 220, 170), translate="10% 0px")], None, "a shift in a unit other than pixels is not guessed at"),
]

step_a = "wf:ghl:abc/m:1"
step_b = "wf:ghl:abc/m:2"
root_pill = "wf:ghl:abc"
called = "wf:ghl:abc/m:2/wf:make:912"
called_a = f"{called}/m:7"
called_b = f"{called}/m:8"
row = {"left": 0, "top": 100, "right": 200, "bottom": 170}
ALIGN_CASES = [
    (["v", called, called_a, {called: {"left": 0, "top": 100, "right": 260, "bottom": 140},
                               called_a: {"left": 0, "top": 160, "right": 200, "bottom": 230}}],
     {"edge": "left", "off": 0, "at": [0, 0]},
     "a column link's cards share a left edge, however wide each is — a pill heads its column"),
    (["v", called_a, called_b, {called_a: {"left": 0, "top": 160, "right": 200, "bottom": 230},
                                 called_b: {"left": 6, "top": 250, "right": 206, "bottom": 320}}],
     {"edge": "left", "off": 6.0, "at": [0, 6.0]},
     "a card 6px right of its column is off by 6"),
    (["h", step_a, step_b, {step_a: row, step_b: {"left": 260, "top": 100, "right": 460, "bottom": 230}}],
     {"edge": "top", "off": 0, "at": [100, 100]},
     "a chain link's two steps share a top, however tall each is"),
    (["h", step_a, step_b, {step_a: row, step_b: {"left": 260, "top": 103, "right": 460, "bottom": 173}}],
     {"edge": "top", "off": 3.0, "at": [100, 103.0]},
     "a step 3px below its row's top is off by 3"),
    (["h", root_pill, step_a, {root_pill: {"left": 0, "top": 87, "right": 180, "bottom": 127}, step_a: row}], None,
     "a chain link from the viewed workflow's pill is not judged: the pill is nudged so its centre sits on the rail"),
    (["h", called, called_a, {called: {"left": 0, "top": 87, "right": 180, "bottom": 127}, called_a: row}], None,
     "nor one from a called workflow's pill"),
    (["h", step_a, called, {step_a: row, called: {"left": 260, "top": 93, "right": 440, "bottom": 133}}], None,
     "a chain link into a pill is not between two steps either"),
    (["drop", step_b, called, {step_b: row, called: {"left": 40, "top": 200, "right": 220, "bottom": 240}}], None,
     "a drop has no alignment rule"),
    ([None, step_a, step_b, {step_a: row, step_b: {"left": 260, "top": 140, "right": 460, "bottom": 210}}], None,
     "nor does a line with no anchor"),
    (["v", called_a, called_b, {called_a: {"left": 0, "top": 160, "right": 200, "bottom": 230}}],
     {"edge": "left", "off": None},
     "a pair with a card whose layout could not be read is unjudged, never passed"),
]
layout_script = (
    probe_source
    + "\nconst rounded = (b) => b && Object.fromEntries(Object.entries(b).map(([k, v]) => [k, +v.toFixed(3)]));"
    + "\nprocess.stdout.write(JSON.stringify({ boxes: "
    + json.dumps([layers for layers, _, _ in LAYOUT_CASES])
    + ".map((l) => rounded(globalThis.__wmLayoutBox(l))), aligned: "
    + json.dumps([args for args, _, _ in ALIGN_CASES])
    + ".map(([anchor, from, to, boxes]) => globalThis.__wmAlign(anchor, from, to, (id) => boxes[id] ?? null)) }));"
)
ran = subprocess.run([node or "node", "-e", layout_script], capture_output=True, text=True, timeout=60)
check(ran.returncode == 0, "the probe's layout and alignment rules run outside a browser", got=ran.stderr[-400:])
laid = json.loads(ran.stdout)
for (layers, want, why), got in zip(LAYOUT_CASES, laid["boxes"]):
    check(got == want, why, got=got)
for (args, want, why), got in zip(ALIGN_CASES, laid["aligned"]):
    check(got == want, why, got=(args[:3], got))

# ── A fan-out centred on its branches ───────────────────────────────────────
#
# Every fan-out is centred against its stack of branch lanes, so it fans above
# its row as well as below it — a Condition inside a connected workflow and one
# on the main flow alike — and the trunk leaves from the rail they are centred
# on. The lines come from the map's own path shapes and rail (`edgePaths.ts`,
# run under node) with the end points the measure hook gives them, and the
# probe judges them with its own rules. Two scenes: a parent with two branches
# above its rail, one level with it and two below; and a Condition on a
# main-flow row, reached along its rail, whose five lanes are centred on that
# rail and laid out with the layout's own tokens — two above the rail, one on
# it, two below — each lane running on to its first step.

import re  # noqa: E402

workflow_map = Path(__file__).resolve().parent.parent / "src" / "lib" / "workflowMap"
fan_parent = {"left": 0, "top": 273, "right": 200, "bottom": 333}
fan_children = [{"left": 300, "top": y - 27, "right": 500, "bottom": y + 33} for y in (160, 230, 300, 370, 440)]
# A parent at x 205 with its children's left edges at 295, the trunk at 250:
# the shapes a trunk takes, each held to the same rules as a whole fan.
TRUNK_SHAPES = {
    "a fan centred on the parent's row": (300, [160, 230, 300, 370, 440]),
    "a group's chains: the first level with it, the rest below": (300, [300, 380, 460]),
    "every child below, clear of the parent's row": (300, [380, 460]),
    "every child above, clear of the parent's row": (300, [140, 220]),
    "children a few pixels either side of the parent's row": (300, [296, 304]),
    "an outermost child too close to the row to turn a corner": (300, [290, 300, 309]),
}
fan_script = (
    probe_source
    + f"\nconst TRUNK_SHAPES = {json.dumps(list(TRUNK_SHAPES.values()))};"
    + "\n(async () => {"
    + f"\n  const shapes = await import({json.dumps((workflow_map / 'edgePaths.ts').as_uri())});"
    + f"\n  const tokens = await import({json.dumps((workflow_map / 'tokens.ts').as_uri())});"
    + "\n  const r2 = (v) => Math.round(v * 2) / 2;"
    + "\n  const n = globalThis.__wmNumbers;"
    + "\n  const off = (want, got) => Math.max(...want.map((w, i) => Math.abs(w - got[i])));"
    + "\n  const judged = (anchor, a, b, d, trunk) =>"
    + "\n    off(globalThis.__wmAnchorWant(anchor, a, b), globalThis.__wmJudgedEnds(n(d), trunk == null ? null : n(trunk), false));"
    + "\n  const fanOf = (parent, children) => {"
    + "\n    const sx = r2(parent.right + tokens.EDGE_PAD);"
    + "\n    const sy = r2(shapes.railY(false, parent.top, parent.bottom));"
    + "\n    const rows = children.map((c) => r2(shapes.railY(false, c.top, c.bottom)));"
    + "\n    const tx = r2(children[0].left - tokens.EDGE_PAD);"
    + "\n    const x = r2(sx + (tx - sx) / 2);"
    + "\n    const trunk = shapes.trunkPath(sx, sy, x, Math.min(...rows), Math.max(...rows), tx);"
    + "\n    const stubs = children.map((c, i) => shapes.stubPath(x, sy, r2(c.left - tokens.EDGE_PAD), rows[i]));"
    + "\n    return {"
    + "\n      sx, sy, x, tx, rows, trunk, stubs, r: tokens.ELBOW_R,"
    + "\n      trunkWant: globalThis.__wmTrunkWant(parent, undefined, false),"
    + "\n      stubOffs: stubs.map((d, i) => judged(undefined, parent, children[i], d, trunk)),"
    + "\n    };"
    + "\n  };"
    + "\n  const railOf = (a, b, from, to, boxes) => {"
    + "\n    const d = shapes.railPath(r2(a.right + tokens.EDGE_PAD), r2(b.left - tokens.EDGE_PAD), r2(b.top + tokens.CHAIN_RAIL_Y));"
    + "\n    return { d, off: judged(\"h\", a, b, d), align: globalThis.__wmAlign(\"h\", from, to, (id) => boxes[id] ?? null) };"
    + "\n  };"
    + "\n  const W = tokens.STEP_COL_W, H = 70, h = 56, T = 400;"
    + "\n  const card = (left, top, height) => ({ left, top, right: left + W, bottom: top + height });"
    + "\n  const root = \"wf:ghl:main\", prevId = `${root}/m:2`, condId = `${root}/m:3`;"
    + "\n  const prev = card(0, T, H);"
    + "\n  const cond = card(W + tokens.CHAIN_GAP, T, H);"
    + "\n  const lanes = [-2, -1, 0, 1, 2].map((k, i) => {"
    + "\n    const branch = card(cond.right + tokens.DEEP_SPACER, T + k * (h + tokens.LANE_GAP), h);"
    + "\n    return { id: `${condId}/route:3:${i}`, stepId: `${condId}/route:3:${i}/m:${10 + i}`, branch, step: card(branch.right + tokens.CHAIN_GAP, branch.top, H) };"
    + "\n  });"
    + "\n  const boxes = { [prevId]: prev, [condId]: cond };"
    + "\n  for (const l of lanes) Object.assign(boxes, { [l.id]: l.branch, [l.stepId]: l.step });"
    + "\n  process.stdout.write(JSON.stringify({"
    + "\n    rails: [shapes.railY(false, 100, 170), shapes.railY(true, 100, 164), shapes.railY(false, 100, 144)],"
    + "\n    fanInWant: globalThis.__wmTrunkWant({ left: 400, top: 107, right: 640, bottom: 147 }, \"wf:ghl:viewed\", true),"
    + "\n    trunks: TRUNK_SHAPES.map(([sy, rows]) => {"
    + "\n      const x = 250, tx = 295;"
    + "\n      return { sy, rows, x, tx, r: tokens.ELBOW_R, trunk: shapes.trunkPath(205, sy, x, Math.min(...rows), Math.max(...rows), tx),"
    + "\n        stubs: rows.map((ty) => shapes.stubPath(x, sy, tx, ty)) };"
    + "\n    }),"
    + f"\n    centred: fanOf({json.dumps(fan_parent)}, {json.dumps(fan_children)}),"
    + "\n    row: {"
    + "\n      rail: cond.top + tokens.CHAIN_RAIL_Y,"
    + "\n      chainIn: railOf(prev, cond, prevId, condId, boxes),"
    + "\n      fan: fanOf(cond, lanes.map((l) => l.branch)),"
    + "\n      lanes: lanes.map((l) => railOf(l.branch, l.step, l.id, l.stepId, boxes)),"
    + "\n    },"
    + "\n  }));"
    + "\n})();"
)
ran = subprocess.run(
    [node or "node", "--experimental-strip-types", "--no-warnings", "-e", fan_script],
    capture_output=True, text=True, timeout=60,
)
check(ran.returncode == 0, "the map's path shapes and the probe's rules run together outside a browser", got=ran.stderr[-400:])
scenes = json.loads(ran.stdout)


def subpaths(d: str) -> list[list[tuple[float, float]]]:
    """The points each subpath of an absolute M/L/H/V/Q path reaches, in order."""
    tokens = re.findall(r"[MLHVQ]|-?\d+(?:\.\d+)?", d)
    out: list[list[tuple[float, float]]] = []
    x = y = 0.0
    i = 0
    while i < len(tokens):
        cmd = tokens[i]
        args = [float(v) for v in tokens[i + 1:i + 1 + {"M": 2, "L": 2, "H": 1, "V": 1, "Q": 4}[cmd]]]
        i += 1 + len(args)
        if cmd == "H":
            x = args[0]
        elif cmd == "V":
            y = args[0]
        else:
            x, y = args[-2], args[-1]
        if cmd == "M":
            out.append([])
        out[-1].append((x, y))
    return out


def on_path(point: tuple[float, float], d: str) -> bool:
    """Whether a point lies on one of a path's straight, axis-aligned segments."""
    (px, py) = point
    for sub in subpaths(d):
        for (ax, ay), (bx, by) in zip(sub, sub[1:]):
            if ax == bx == px and min(ay, by) <= py <= max(ay, by):
                return True
            if ay == by == py and min(ax, bx) <= px <= max(ax, bx):
                return True
    return False


def check_trunk(where: str, shape: dict) -> None:
    """A trunk and its stubs meet with nothing left over: every leg starts at the
    parent and moves away from it, every stub starts on the trunk, and each leg
    ends exactly where the outermost stub on its side starts — at its corner's
    start, or on its row when it runs straight — so no leg overshoots a curve."""
    sy = shape["sy"]
    legs = subpaths(shape["trunk"])
    starts = [subpaths(d)[0][0] for d in shape["stubs"]]
    check(all(leg[0] == legs[0][0] for leg in legs) and legs[0][0][1] == sy,
          f"{where}: every leg of the trunk starts at the parent, so each draws and drifts away from it", got=shape["trunk"])
    check(all(all(abs(b[1] - sy) >= abs(a[1] - sy) for a, b in zip(leg, leg[1:])) for leg in legs),
          f"{where}: each leg only ever moves away from the parent's row", got=shape["trunk"])
    check(all(on_path(start, shape["trunk"]) for start in starts),
          f"{where}: every stub starts on the trunk", got=(shape["trunk"], starts))
    outer = {}
    for side in (-1, 1):
        rows = [(row, start) for row, start in zip(shape["rows"], starts) if (row < sy if side < 0 else row > sy)]
        if rows:
            outer[side] = (min(rows) if side < 0 else max(rows))[1]
    ends = {(-1 if leg[-1][1] < sy else 1): leg[-1] for leg in legs if leg[-1][1] != sy}
    check(all(ends.get(side) == start for side, start in outer.items()) and all(side in outer for side in ends),
          f"{where}: each leg ends where the outermost stub on its side starts its corner, with no tail past it",
          got=(shape["trunk"], outer))


def check_fan(where: str, fan: dict, reference: tuple[float, str]) -> None:
    """What every fan-out's trunk and stubs must be, wherever its branches sit."""
    check_trunk(where, fan)
    check(tuple(subpaths(fan["trunk"])[0][0]) == (fan["sx"], fan["sy"]) == tuple(fan["trunkWant"]),
          f"{where}: the trunk starts at the parent's right edge on its rail, and the probe judges it there",
          got=(fan["trunk"], fan["trunkWant"]))
    level, named = reference
    for row, d, off in zip(fan["rows"], fan["stubs"], fan["stubOffs"]):
        side = "above" if row < level else "below" if row > level else "level with"
        branch = f"the branch at y={row:g}, {side} {named}"
        points = [pt for sub in subpaths(d) for pt in sub]
        start, end = points[0], points[-1]
        dy = row - fan["sy"]
        if abs(dy) <= 2 * fan["r"]:
            turns, way = start[1] == row and len(points) == 2, "runs straight along"
        elif dy < 0:
            turns, way = start[1] > row, "turns up into"
        else:
            turns, way = start[1] < row, "turns down into"
        check(turns, f"{where}: a stub to {branch}, {way} that row", got=d)
        check(end == (fan["tx"], row), f"{where}: a stub to {branch}, ends in the branch's left-centre", got=d)
        check(off == 0, f"{where}: the probe judges the stub to {branch}, attached from the parent", got=(d, off))


card_rail, pill_rail, tile_rail = scenes["rails"]
check(card_rail == 100 + rail, "the map meets a step or branch card on its rail, CHAIN_RAIL_Y below its top", got=card_rail)
check(pill_rail == 132, "the map meets a pill at its centre — what sits on a rail — even one tall enough to have a rail",
      got=pill_rail)
check(tile_rail == 122, "the map meets a card shorter than two rail heights — a far-mode tile — at its centre", got=tile_rail)
check(scenes["fanInWant"] == [400 - pad, 127],
      "the probe judges a fan-in trunk where it ends: the viewed pill's left edge, at the pill's centre", got=scenes["fanInWant"])
for where, shape in zip(TRUNK_SHAPES, scenes["trunks"]):
    check_trunk(where, shape)

centred = scenes["centred"]
check_fan("a centred fan", centred, (centred["sy"], "the parent's rail"))

row = scenes["row"]
condition = "a main-flow Condition"
rail = row["rail"]
check(min(row["fan"]["rows"]) < rail < max(row["fan"]["rows"]),
      f"{condition}: the scene has lanes above its rail and below it", got=(row["fan"]["rows"], rail))
check(row["fan"]["sy"] == rail and row["fan"]["trunkWant"][1] == rail,
      f"{condition}: its fan leaves from its rail, the height its lanes are centred on", got=(row["fan"]["trunkWant"], rail))
middle = row["fan"]["stubs"][row["fan"]["rows"].index(rail)] if rail in row["fan"]["rows"] else ""
check(middle != "" and [len(sub) for sub in subpaths(middle)] == [2] and all(y == rail for _, y in subpaths(middle)[0]),
      f"{condition}: the lane on its rail is one straight line on from the trunk, level with the chain link into it", got=middle)
check(
    row["chainIn"]["off"] == 0 and all(y == rail for _, y in subpaths(row["chainIn"]["d"])[0]),
    f"{condition}: the chain link into it rides its rail, and the probe judges it attached",
    got=row["chainIn"],
)
aligned_in = row["chainIn"]["align"] or {}
check(aligned_in.get("edge") == "top" and aligned_in.get("off") == 0 and len(set(aligned_in.get("at", []))) == 1,
      f"{condition}: it shares a top with the step before it, so alignment judges the row on the grid", got=aligned_in)
check_fan(condition, row["fan"], (rail, "its rail"))
for lane_row, lane in zip(row["fan"]["rows"], row["lanes"]):
    where = f"{condition}: the lane at y={lane_row:g}"
    check(lane["off"] == 0, f"{where} runs on to its first step along the lane's own rail, judged attached", got=lane)
    check(lane["align"] is not None and lane["align"]["edge"] == "top" and lane["align"]["off"] == 0,
          f"{where} shares a top with its first step, so alignment judges the lane on the grid", got=lane["align"])

# ── Which problems count ────────────────────────────────────────────────────

stale = {"kind": "STALE-HOLD", "key": "e"}
check(
    classify([stale], "+140ms", 20.0) == [stale] and classify([stale], "draw+4f", 20.0) == [stale]
    and classify([stale], "settled", 1.5) == [stale],
    "a hold left on a line with the motion layer off fails wherever it is seen: there is no hold for it to be part of",
)
check(
    "a hold left on a line with the motion layer off fails as stale" in full_stamp
    and "the layer off or on (LITE past 150 cards) is named in the summary" in full_stamp,
    "the stamp says holds are read against the motion layer at every sample, and that LITE switches are named",
    got=full_stamp,
)
failsafe = {"kind": "FAILSAFE", "key": "e"}
check(classify([failsafe], "settled", 1.5) == [failsafe],
      "a line the hold's failsafe had to release fails once settled: the failsafe hid a draw that never came")
check(classify([failsafe], "+340ms", 20.0) == [] and classify([failsafe], "draw+8f", 20.0) == [],
      "in flight and inside draws it is not judged — the settled sample of the same press reports it once")
held = {"kind": "HELD", "key": "e"}
check(classify([held], "+340ms", 20.0) == [] and classify([held], "settled", 1.5) == [held],
      "a held line is expected in flight and a failure once settled")
for kind in ("ORPHAN", "PILL"):
    problem = {"kind": kind, "key": "e"}
    check(classify([problem], "+140ms", 20.0) == [problem], f"{kind} is a failure in flight as well as settled")
    check(classify([problem], "draw+4f", 20.0) == [problem], f"{kind} is a failure inside a draw too")

# A dash exists only while a line draws, and mid-draw the motion layer accepts a
# few pixels of overshoot by design; settled, a dash left on a line never
# settled. The limits are the lead's, set before any draw-window sample existed.
early = {"kind": "EARLY", "key": "e", "arriving": ["wf:a/m:b"]}
check(classify([early], "draw+4f", 20.0) == [early],
      "a line on screen while one of its cards is still arriving fails inside a draw, whatever its offset")
check(classify([early], "draw+0f", 20.0) == [early] and classify([early], "draw+32f", 20.0) == [early],
      "at every draw-window frame")
check(classify([early], "+560ms", 20.0) == [] and classify([early], "settled", 1.5) == [],
      "it is judged only where it is looked for: inside draws")
dash_small = {"kind": "DASH", "key": "e", "delta": 3.0}
dash_at_limit = {"kind": "DASH", "key": "e", "delta": 20.0}
dash_large = {"kind": "DASH", "key": "e", "delta": 25.0}
check(classify([dash_small], "draw+4f", 20.0) == [], "a few pixels of dash overshoot inside a draw is not a failure")
check(classify([dash_at_limit], "draw+0f", 20.0) == [], "a dash exactly at the in-flight limit passes, as an offset would")
check(classify([dash_large], "draw+8f", 20.0) == [dash_large], "a dash past the in-flight limit inside a draw fails")
check(classify([dash_large], "+560ms", 20.0) == [dash_large] and classify([dash_small], "+560ms", 20.0) == [],
      "a wall-clock sample that lands mid-draw gets the same dash limit as a draw-window one")
check(classify([dash_small], "settled", 1.5) == [dash_small],
      "settled, any dash mismatch the probe reports fails — the 1px limit is the probe's")
visible = {"kind": "OFFSET", "key": "e", "off": 30.0, "hidden": False}
hidden = {"kind": "OFFSET", "key": "e", "off": 30.0, "hidden": True}
check(
    classify([visible], "+340ms", 20.0) == [visible] and classify([hidden], "+340ms", 20.0) == [],
    "in flight, an offset counts only on what a reader can see",
)
check(classify([hidden], "settled", 1.5) == [hidden], "once settled, every offset counts, visible or not")
check(ALIGN_PX == 2.0, "two cards of an anchored pair may sit at most 2px apart along the edge they share", got=ALIGN_PX)
column_off = {"kind": "ALIGN", "key": "e", "anchor": "v", "edge": "left", "off": 6.0, "from": "a", "to": "b", "at": [0, 6.0]}
at_limit = {**column_off, "off": ALIGN_PX}
check(classify([column_off], "settled", 1.5) == [column_off], "a column 6px out fails once settled")
check(classify([at_limit], "settled", 1.5) == [], "a pair exactly at the limit passes: the limit is inclusive")
check(
    classify([column_off], "+340ms", 20.0) == [] and classify([column_off], "draw+8f", 20.0) == [],
    "alignment is judged at settled samples only — mid-transition a card is on its way to its place",
)
check(
    "alignment settled samples only" in full_stamp and f"within {ALIGN_PX:g}px" in full_stamp
    and "a chain link from a pill is not judged" in full_stamp,
    "the stamp states the alignment rule, its limit, that it is judged settled only, and what it leaves out",
    got=full_stamp,
)
check(
    "Judged and not judged are counted by kind" in full_stamp and "judges none of them exits 2" in full_stamp,
    "the stamp says alignment is counted judged and not judged by kind, and that judging none exits 2",
    got=full_stamp,
)

quoted = quote_line(
    pass_verdict(full, SNAPSHOTS, ["ghl-119/motion"], RUNS, ON_TIME, SETTLE_MS, reloads=1).splitlines()[0],
    [612.0, 880.0, 590.0], [1405.0, 1690.0, 1350.0], 8, 40, 1, analytics_blocked=412,
)
check(
    quoted.startswith("quote: PASS (1 of 12 fixture runs skipped; source reloaded mid-run ×1) · "),
    "the quotable line carries the verdict with every qualifier it has",
    got=quoted,
)
check(
    "draw start 612ms median / 880ms worst" in quoted and "every line drawn 1405ms median / 1690ms worst" in quoted
    and "soak 8 cycles per fixture, 40 completed" in quoted and "1 hot reload" in quoted,
    "the quotable line carries both timings as median and worst, the repeat count and the reload count",
    got=quoted,
)
check(
    "draw start not measured" in quote_line("FAIL", [], [None], 8, 0, 0, analytics_blocked=0),
    "the quotable line says a timing was not measured rather than printing a number for it",
)
check(
    "8 cycles per fixture, 0 completed" in quote_line("PASS", [], [], 8, 0, 0, analytics_blocked=0),
    "a soak that was set but never ran is quoted as not having run, not as its repeat count",
)

# ── Draw timing in the first line ───────────────────────────────────────────
#
# The numbers a hold fix is judged on belong where the verdict is quoted from.

timed_verdict = pass_verdict(
    full, SNAPSHOTS, [], RUNS, ON_TIME, SETTLE_MS,
    draw_start_median=1305.0, fully_drawn_median=2091.0, timing_expected=True,
)
first = timed_verdict.splitlines()[0]
check(
    "after a rung change, lines start drawing at 1305ms and are all drawn by 2091ms (medians)" in first,
    "a run that measured draw timing carries both medians in the verdict's first line",
    got=first,
)
check(first.startswith("PASS — "), "measured timing is a claim, not a qualifier: a clean timed run stays unqualified", got=first)
untimed = pass_verdict(full, SNAPSHOTS, [], RUNS, ON_TIME, SETTLE_MS, timing_expected=True).splitlines()[0]
check(
    "draw timing not measured" in untimed and "start drawing" not in untimed,
    "a run that should have measured draw timing and did not says so in the first line",
    got=untimed,
)
half = pass_verdict(
    full, SNAPSHOTS, [], RUNS, ON_TIME, SETTLE_MS, draw_start_median=1305.0, timing_expected=True
).splitlines()[0]
check(
    "draw timing not measured" in half,
    "one of the two timings missing counts as not measured — the finish time is not optional",
    got=half,
)

# ── Steps that found nothing ────────────────────────────────────────────────
#
# A step whose locator finds nothing samples nothing and returns. Unless it is
# named, a removed feature looks exactly like a passing one.

check(skips_summary({}) == "steps that found nothing to do: none", "a run where every step found work says none were skipped")
named = skips_summary(
    {
        "press foldable cards": ["shapes/motion · Steps · z1.0", "shapes/motion · Steps · z0.8", "x"],
        "reopen a scenario pill": ["make-102/motion · Structure · z1.0"],
        "never happened": [],
    }
)
check(
    "press foldable cards ×3 — first at shapes/motion · Steps · z1.0" in named,
    "a skipped step is named with how often and where it first happened",
    got=named,
)
check("reopen a scenario pill ×1" in named, "every skipped step is named, not only the most frequent", got=named)
check("never happened" not in named, "a step that always found work is not listed as skipped", got=named)

# ── One implementation ──────────────────────────────────────────────────────
#
# Checked in the source rather than by importing the checker, which needs
# Playwright. It guards the exact failure this module was split out after: a
# second copy of the verdict logic sitting in the checker, where it can drift
# or be shadowed while every check here keeps passing against the other one.

checker = (Path(__file__).parent / "check-map-geometry.py").read_text()
check(
    all(
        f"def {fn}" not in checker
        for fn in (
            "pass_verdict", "reached_fixtures", "sweep_stamp", "skips_summary", "timing_line", "quote_line",
            "classify", "settle_decision", "unfinished_problem", "run_outcome", "second_look_verdict",
            "analytics_pattern", "is_analytics", "probe_cost", "follow_verdict",
        )
    ),
    "the checker carries no copy of the verdict, stamp or skip logic of its own",
)
check(
    "from mapGeometryVerdict import" in checker,
    "the checker takes its verdict from this module",
)

print(f"\n{checks} verdict checks pass.")
