"""
What the geometry checker's PASS is allowed to claim.

This is the part of `check-map-geometry.py` that decides the verdict, kept in
a module of its own for one reason: it has to be testable with nothing
installed. The checker imports Playwright at the top, and the `python3` an npm
script reaches for does not have it — so a test that imported the checker
would fail on import, on every machine without the workers venv, before a line
of this logic ran. This module uses the standard library only, and
`mapGeometryVerdict.check.py` exercises it inside `npm run check:map`, with no
browser and no dev server, so it gates even when the dev server is down.

The separation is worth having because this logic has been wrong twice, and
silently both times — each bug produced a plausible PASS: an empty-sweep guard
that sat as dead code behind a duplicate of itself, and a fixture-name split
that read "big/LITE" as "big" and let a fixtures-only run claim real coverage.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

# Past this much median drift, an in-flight sample is no longer reliably inside
# the window it was aimed at. One frame of slack at 60fps is 17ms and a heavy
# map legitimately runs slower than that, so this is generous — it is meant to
# catch a contended server, not ordinary load.
LATE_MS_SUSPECT = 150.0

# Below this much free memory the machine is paging, and a sweep's in-flight
# timing is the first thing to suffer. Stated in the stamp next to the timing.
MEMORY_LOW_PCT = 20.0

# How far apart the two cards of an anchored pair may sit along the edge they
# share, in the map's own CSS pixels: a column link's left edges, and a chain
# link's tops between two steps. The layout puts both on one line exactly, so
# anything past subpixel rounding is the layout drifting — and a column a few
# pixels out is the first thing a reader notices about a map meant to look
# composed.
ALIGN_PX = 2.0

# PostHog's own domain, blocked whatever the env says: the app's analytics host
# is `NEXT_PUBLIC_POSTHOG_HOST`, but PostHog loads its extensions and remote
# config from sibling hosts (`us-assets.i.posthog.com`), which no single host
# setting names.
ANALYTICS_DOMAIN = "posthog.com"


def analytics_pattern(api_host: str | None) -> str:
    """The URLs the checker's browser refuses to send: the app's product analytics.

    `instrumentation-client.ts` starts PostHog on every page once its host and
    token are set, and a certifying run loads the map hundreds of times. Left
    alone, every load sends synthetic traffic to the real analytics project, and
    each round trip adds variance to a run that is measuring milliseconds. So
    those requests are aborted, as an ad blocker would. PostHog's code is bundled
    with the app, so it still loads, starts and runs — its cost on the main
    thread stays in the measurement; only the network is taken out.

    `api_host` is `NEXT_PUBLIC_POSTHOG_HOST` as written: a URL, a bare host, or a
    path on the app's own origin when analytics is proxied (`/ingest`). The
    result is a regex source that Python and JavaScript read the same way,
    because Playwright hands it to the browser side to decide which requests to
    intercept at all. A predicate would intercept every request the page makes,
    the map's own chunks included, and route each through this process first.
    """
    hosts = [r"(?:[^/?#@]*\.)?" + re.escape(ANALYTICS_DOMAIN).replace("\\-", "-")]
    paths: list[str] = []
    value = (api_host or "").strip()
    if value.startswith("/"):
        path = "/" + value.strip("/")
        if re.fullmatch(r"[A-Za-z0-9._~/-]+", path):
            paths.append(path.replace(".", r"\."))
    elif value:
        if "://" not in value:
            value = "https://" + value
        host = value.split("://", 1)[1].split("/", 1)[0].split("?", 1)[0].split("#", 1)[0].rsplit("@", 1)[-1].split(":", 1)[0]
        if re.fullmatch(r"[A-Za-z0-9.-]+", host):
            hosts.append(host.replace(".", r"\."))
    alternatives = [rf"^https?://(?:{'|'.join(hosts)})(?::\d+)?(?:[/?#]|$)"]
    alternatives += [rf"^https?://[^/?#]+{path}(?:[/?#]|$)" for path in paths]
    return "|".join(alternatives)


def is_analytics(url: str, api_host: str | None) -> bool:
    """Whether the checker's browser blocks this URL — the same regex it hands Playwright."""
    return re.search(analytics_pattern(api_host), url, re.IGNORECASE) is not None


def settle_decision(elapsed_ms: float, held: int, drawing: int, floor_ms: float, cap_ms: float) -> str:
    """When the settled sample may be taken: "wait", "sample", or "capped".

    A settled sample is a claim about a map that has stopped moving, and a line
    that is still held back or still drawing is a map that has not. A fixed
    settle time only guesses when that is: measured on real workflows, a rung
    change's last line landed at 2091ms median against a 2100ms sample, so about
    half of those "settled" samples were taken mid-draw — and a larger workflow
    or a busier machine would move it again. So the sample waits for the
    condition itself: nothing held, nothing drawing.

    `floor_ms` stays, and is not the draw: it is the time the measure hook's
    own settle takes to land its trailing measure and finish the edge tween
    after a commit, which nothing in the page announces and which a transition
    that holds no lines at all still needs. `cap_ms` bounds the wait, and
    reaching it with lines still held or drawing is a failure in its own right
    — lines that never finish drawing are the stuck-line defect by another
    route — never a sample quietly taken anyway.
    """
    busy = held > 0 or drawing > 0
    if elapsed_ms >= cap_ms and busy:
        return "capped"
    if elapsed_ms < floor_ms or busy:
        return "wait"
    return "sample"


def unfinished_problem(held: int, drawing: int, cap_ms: float) -> dict:
    """The failure recorded when the settle cap is reached with lines still unfinished."""
    return {
        "kind": "UNFINISHED",
        "key": "settle",
        "held": held,
        "drawing": drawing,
        "cap": cap_ms,
    }


def classify(problems: list[dict], when: str, tol: float) -> list[dict]:
    """Which problems are failures at this point in time.

    ORPHAN is never acceptable — a path pointing at a node that is not on the
    screen is the bug. PILL neither: a pill beside a step that does not make its
    call is wrong whenever it is drawn. UNFINISHED neither: lines still held or
    drawing when the settle cap ran out never finished, whatever else the
    sample shows.

    EARLY is a line on screen while one of its cards is still arriving — the
    moment a line and its card come apart, and exactly what the hold exists to
    prevent. Drawing or already solid makes no difference: a line whose card
    moves while it draws loses its dash and shows solid, early all the same. It
    is looked for only inside draws, where the samples are aimed at it, and
    fails there whatever the line's offset happens to be at that frame.

    DASH is a `stroke-dasharray` that no longer matches its own path's length:
    the draw was computed against a `d` that has since moved. A dash only exists
    while a line is drawing, so every DASH is found mid-draw. A line starts its
    draw against the geometry measured once its cards have landed, and a
    relayout during the draw moves the path from under the dash until `MapEdges`
    drops the dash with the move — a mismatch that should not outlive the move,
    and is visible as at most that many pixels of gap or overshoot. So in flight
    a DASH fails past the in-flight limit, the same one an offset gets; settled,
    any mismatch the probe reports — over 1px — fails, because a dash still on a
    line then is one that never settled. Decided before any draw-window sample
    existed, not fitted to one.

    STALE-HOLD is a line still carrying `data-wm-undrawn` with the motion layer
    off. It hides nothing while motion is off — the hiding rule is scoped to
    `.wm-motion` — but it outlived the class it belongs to, and the moment motion
    comes back on it hides a line nothing will draw. Always a failure: with
    motion off there is no hold for it to be part of.

    FAILSAFE is a line the hold's failsafe had to release. Once settled it
    fails: the line is on screen, but only because its own draw never came, and
    a failsafe that fired is a defect it hid — a pass would launder it. In flight
    it is not judged, because the mark stays on the line after the release and
    the settled sample of the same press reports it once.

    HELD is expected in flight — a line is deliberately invisible until its
    draw reaches it — and a failure once everything has settled, because a
    permanently invisible edge is a workflow whose shape is missing.

    ALIGN is an anchored pair's two cards off the grid the layout puts them on:
    a column link's cards more than `ALIGN_PX` apart at their left edges, or a
    chain link's two steps at their tops. It is a claim about a map at rest, so
    it is judged at settled samples only — mid-transition a card is on its way
    to its place by design — and the probe measures where the layout put each
    card, with a hover lift or a selected card's growth taken back out.

    An OFFSET on something nobody can see yet is likewise not a failure in
    flight. Mid-entrance a card is held at opacity 0 until its reveal and a
    line until its draw, so the two are genuinely at different points of the
    same animation; a reader sees neither. Once settled that excuse is gone
    and every offset counts, visible or not.

    There is deliberately no exemption for LITE or reduced motion, and an
    earlier version of this file had one. The reasoning was that past LITE_AT
    `animateUnfold` runs no per-frame measure loop, so the map has declined to
    follow the cards and should not be held to it. That is backwards: with
    motion off there is no animation for a sample to be mid-way through, so a
    line that is not on its card is simply drawn wrong, and the exemption hid a
    594px stale measurement in exactly the configuration where nothing could
    have excused it. `motion` is still reported, because it says which mode a
    failure was found in, but it never decides whether one counts.
    """
    out = []
    for p in problems:
        kind = p["kind"]
        if kind in ("ORPHAN", "PILL", "UNFINISHED", "STALE-HOLD"):
            out.append(p)
        elif kind == "EARLY":
            if when.startswith("draw+"):
                out.append(p)
        elif kind == "DASH":
            if when == "settled" or p.get("delta", 0) > tol:
                out.append(p)
        elif kind in ("HELD", "FAILSAFE"):
            if when == "settled":
                out.append(p)
        elif kind == "ALIGN":
            if when == "settled" and p.get("off", 0) > ALIGN_PX:
                out.append(p)
        elif kind == "OFFSET":
            if p.get("off", 0) > tol and (when == "settled" or not p.get("hidden")):
                out.append(p)
    return out


def sweep_stamp(
    *,
    fixtures: list[str],
    rungs: Iterable[str],
    zooms: list[float],
    modes: list[str],
    quick: bool,
    soak_cycles: int,
    memory_free: float | None,
    in_flight_ms: Iterable[int],
    settle_floor_ms: float,
    settle_cap_ms: float,
    tol_inflight: float,
    tol_settled: float,
    draw_probe_frames: Iterable[int],
    long_frames: str | None,
    stall: tuple[int, Iterable[str]] | None,
    analytics_host: str | None,
) -> str:
    """The sweep definition, printed before the run starts.

    Cases are discovered as the sweep goes — a rung with nothing to press
    contributes none — so two runs are only comparable when these lines match,
    which is why they are stated rather than left to be counted afterwards.

    Two lines matter beyond comparability. The hold soak states how many times
    each line-holding transition is repeated: a defect that shows one time in
    three passes a single attempt two times in three by luck, and eight attempts
    about 4% of the time, so a PASS means little without the count beside it.
    And free memory at the start, because a machine that is paging slides every
    in-flight sample late, which the skew figure at the end only reports after
    the fact.
    """
    flight = list(in_flight_ms)
    if memory_free is None:
        memory = "unknown — memory_pressure unavailable"
    elif memory_free < MEMORY_LOW_PCT:
        memory = f"{memory_free:.0f}% free at start — low: expect in-flight samples to land late"
    else:
        memory = f"{memory_free:.0f}% free at start"
    presses = "2 foldable cards pressed" if quick else "every foldable card pressed at z1.0 and 2 elsewhere"
    if not (analytics_host or "").strip():
        blocked_to = f"any {ANALYTICS_DOMAIN} host (NEXT_PUBLIC_POSTHOG_HOST not found)"
    elif analytics_host.strip().startswith("/"):
        blocked_to = f"{analytics_host.strip()} on any origin, and any {ANALYTICS_DOMAIN} host"
    else:
        blocked_to = f"{analytics_host.strip().split('://')[-1].rstrip('/')} and any {ANALYTICS_DOMAIN} host"
    soak = (
        f"{soak_cycles} cycle{'s' if soak_cycles != 1 else ''} per fixture where the motion layer is on, at z1.0 — "
        "to Steps and back, an arm folded and reopened, a scenario pill reopened after another branch withdrew it"
        if soak_cycles
        else "off"
    )
    return "\n".join(
        [
            "sweep",
            f"  fixtures  {', '.join(fixtures)}",
            f"  rungs     {', '.join(rungs)}   zooms {zooms}   modes {modes}",
            "  view      each fixture starts at 100 % with the content origin top-left, once the map's own",
            "            first-load framing has run, so where a fixture opens never depends on its size",
            f"  per rung  rung change, {presses}, expand all, collapse all",
            "  a press   counted as what it did: a descent and the climb back, or an arm opened, folded, reopened, folded",
            "  Structure at z1.0 also: every arm opened at once, each pill edge checked against the step that calls it,",
            "            a sibling arm folded and reopened while the other arms' pills are compared, and a scenario pill",
            "            reopened after opening the same scenario elsewhere withdrew it",
            f"  hold soak {soak}",
            "  timing    motion mode: from each click on a rung change, arm reopen or pill reopen, when the new lines'",
            "            draw starts and when every line is fully drawn — the release a hold fix claims to change",
            f"  samples   +{'ms, +'.join(str(m) for m in flight)}ms, then settled once no line is held or drawing —",
            f"            no earlier than {settle_floor_ms:.0f}ms, and a failure if lines are unfinished at {settle_cap_ms:.0f}ms",
            "  drawing   motion mode: sampled at the frame a press's lines start drawing and "
            f"{', '.join(str(n) for n in list(draw_probe_frames) if n)} frames on —",
            "            every first arm open and pill expand, and rung changes and reopens on odd soak cycles only;",
            "            a line on screen while either of its cards is still arriving fails. Quoted timings come from",
            "            every timed click no probe touched; probed minus unprobed soak cycles is the probes' cost",
            "  holds     a line counts as held only once every card it joins has been shown; one held for a card",
            "            no pan has revealed yet is waiting, not stuck, and is counted apart; one the hold's failsafe",
            "            had to release fails once settled. Holds are read against `.wm-motion` at every sample:",
            "            a hold left on a line with the motion layer off fails as stale, and a press that switches",
            "            the layer off or on (LITE past 150 cards) is named in the summary",
            "  alignment settled samples only: a column link's two cards share a left edge, and a chain link's two",
            f"            steps a top, within {ALIGN_PX:g}px — measured where the layout put each card, with a hover lift or",
            "            a selected card's growth taken out; a chain link from a pill is not judged, since a pill that",
            "            starts a row is nudged onto the rail. Judged and not judged are counted by kind, and a run that",
            "            draws such lines and judges none of them exits 2",
            "  frames    the gap before every sample, and the long frames between a failing sample's click and it: "
            + (
                "long animation frames, attributed to scripts"
                if long_frames == "long-animation-frame"
                else "long tasks only — this browser has no long animation frames"
                if long_frames == "longtask"
                else "not observable — this browser reports neither long animation frames nor long tasks"
            ),
            f"  tolerance {tol_inflight}px in flight (visible elements only), {tol_settled}px settled (everything);",
            "            a drawing line is judged at its start from its first drawn frame, and at its far end once the",
            f"            dash reaches it; a dash off its path's length fails past {tol_inflight}px mid-draw, past 1px settled",
            f"  memory    {memory}",
            *(
                [
                    f"  stall     diagnostic, no verdict: the main thread held busy {stall[0]}ms at "
                    + " and at ".join(stall[1])
                    + ", one dedicated",
                    "            soak cycle each — rung changes both ways, a first arm open, a reopen, a pill expand",
                ]
                if stall
                else []
            ),
            f"  analytics requests to {blocked_to} aborted in this browser — PostHog's code still",
            "            loads and runs; how many were blocked is in the summary and the quote line",
        ]
    )


def probe_cost(probed: list[float | None], unprobed: list[float | None]) -> float | None:
    """What sampling inside the draw cost a timing: probed median minus unprobed median.

    None unless both sides measured something — a run with one soak cycle has
    no unprobed cycle to compare against, and says so rather than printing 0.
    """
    a = median_of(probed)
    b = median_of(unprobed)
    return None if a is None or b is None else a - b


def timing_line(what: str, values: list[float | None]) -> str:
    """Median and worst of a timing measured on each transition, with its count.

    `None` is a transition where the measurement did not complete inside the
    recording window — a draw that never started, or lines still being drawn
    when recording stopped. It is counted and stated, never dropped: dropping
    the slowest cases is how a median ends up describing a better map than the
    one measured.
    """
    done = sorted(v for v in values if v is not None)
    unfinished = len(values) - len(done)
    if not done:
        return f"{what}: not measured" + (f" ({unfinished} did not complete)" if unfinished else "")
    median = done[len(done) // 2]
    tail = f"; {unfinished} did not complete within the recording" if unfinished else ""
    return f"{what}: median {median:.0f}ms, worst {done[-1]:.0f}ms (n={len(values)}{tail})"


def median_of(values: list[float | None]) -> float | None:
    done = sorted(v for v in values if v is not None)
    return done[len(done) // 2] if done else None


def run_outcome(
    samples: int,
    failing: int,
    interruptions: int,
    unperformed: int,
    *,
    remounts: int = 0,
    draw_expected: bool = False,
    draw_ends_judged: int = 0,
    align_drawn: int = 0,
    align_judged: int = 0,
) -> tuple[int, str]:
    """The exit code and the verdict's head, from what the run managed to do.

    Six ways a run can end short of a clean pass, in a fixed precedence:

      nothing measured   exit 2 — a broken harness, not a broken map
      failing samples    exit 1 — the map; reported even if the run was also
                         interrupted, because a line off its card is a line off
                         its card
      interrupted        exit 2 — the page navigated or the browser errored
      or remounted              mid-fixture, so the sweep measured less than it
                                claims. A navigation that lands between two
                                reads throws nothing: the sweep carries on
                                against a fresh map, with every arm and pill the
                                preceding steps opened closed again, and the
                                only trace is the content box marked at load
                                being gone. Both are named in the head.
      unperformed        exit 2 — planned presses of controls that always exist
                         could not be made
      nothing judged     exit 2 — the motion layer drew lines, and not one line
      inside a draw             end was compared with its card inside a draw: the
                                moment a line and an arriving card could come
                                apart was never looked at, however many samples
                                were taken there. A probe that read every line as undrawn
                                would look exactly like this. Reduced motion and
                                LITE draw nothing, expect nothing, and are named
                                as skips.
      ALIGN judged       exit 2 — a settled sample drew column links or chain
      nothing                   links between two steps (`align_drawn`, the most
                                in one sample), and alignment judged none of them
                                in the whole run: every pair was counted as not
                                judged, which is what a card transform the probe
                                cannot read looks like. Named beside the draw
                                guard when both apply.

    Exit 2 is always the checker failing to do its job, and exit 1 always the
    map, so a gate can tell them apart without reading the output.
    """
    if samples == 0:
        return 2, "FAIL (nothing measured)"
    if failing:
        return 1, f"FAIL ({failing} samples with problems)"
    lost = [f"sweep interrupted ×{interruptions}"] if interruptions else []
    lost += [f"map remounted mid-run ×{remounts}"] if remounts else []
    if lost:
        return 2, f"FAIL ({'; '.join(lost)})"
    if unperformed:
        return 2, "FAIL (planned transitions not performed)"
    blind = ["no line judged inside a draw"] if draw_expected and draw_ends_judged == 0 else []
    if align_drawn and not align_judged:
        blind.append(f"ALIGN judged nothing: {align_drawn} lines of that kind were drawn")
    if blind:
        return 2, f"FAIL ({'; '.join(blind)})"
    return 0, "PASS"


# A card that moved more than this over the second look's few frames was moving.
# A card at rest reads back the same rect frame after frame, so this only has
# to clear floating-point noise; any real motion is far above it.
DRIFT_PX = 0.05


def second_look_verdict(look: dict, later: list[float | None], tol: float) -> str:
    """What a settled line found off its card turned out to be.

    `look` is the page's account of the failing moment (`__wmExplain`): how far
    each card drifted over a few frames, and every animation on it or on
    anything it sits in. `later` is the line's offset at each later look — None
    where it could not be taken, because the line was gone or a card was not
    laid out.

      left behind    still off its card at the last look. Nothing moved it
                     back — the defect the checker exists for.
      still moving   back on its card, and something was moving when it
                     failed: the sample was taken before the layout settled.
      lagging        back on its card with nothing moving: a measure missed a
                     layout change for a while, then caught it.

    It names the failure; it never excuses it. The sample failed and stays
    failed — this only says where to look.
    """
    moving = any((end.get("drift") or 0.0) > DRIFT_PX for end in look.get("ends", [])) or any(
        a.get("state") in ("running", "pending") for link in look.get("chain", []) for a in link.get("animations", [])
    )
    last = later[-1] if later else None
    if last is None:
        return "not measured again — the line or a card was gone by the last look"
    if last > tol:
        return "left behind, though something was moving when it failed" if moving else "left behind"
    return "still moving" if moving else "lagging"


def follow_verdict(looks: list[dict], key: str, tol: float) -> str:
    """What an in-flight line found off its card did in the frames after.

    `looks` are the page's (`__wmFollow`): at each, the line's offset by the
    sample rules (None where it could not be taken), whether its `d` changed
    since the previous look, and how far its cards moved.

      catching up                 its cards at rest and the line moving onto
                                  them — a measurement being tweened in rather
                                  than applied, after the measure loop stopped
      card moving, line following its cards moving and the line moving too
      card moving, line not       its cards moving and the line not — nothing
                                  is following the card
      left behind                 nothing moving, and the line still past the
                                  limit — nothing will put it back

    Like the settled second look, it names a failure and never excuses one.
    """
    seq = [line for look in looks for line in look.get("lines", []) if line.get("key") == key]
    if not seq or seq[-1].get("off") is None:
        return "not measured again — the line or a card was gone by the last look"
    cards = any((line.get("cardMoved") or 0.0) > DRIFT_PX for line in seq)
    moved = any(line.get("lineMoved") for line in seq)
    if cards:
        return "card moving, line following" if moved else "card moving, line not following"
    if moved:
        return "catching up — the line moving onto a card at rest"
    if seq[-1]["off"] > tol:
        return "left behind"
    return "back within the limit, with nothing seen moving"


def quote_line(
    head: str,
    draw_start: list[float | None],
    fully_drawn: list[float | None],
    soak_cycles: int,
    soak_done: int,
    reloads: int,
    *,
    analytics_blocked: int,
) -> str:
    """The one line to quote: outcome, the two timings the motion fix claims to change, repeats, reloads.

    `head` is the verdict's own first line, or its part before " — ", so every
    qualifier the verdict carries travels with the numbers. Each timing is its
    median and its worst: now that the settled sample waits for the draw, a slow
    draw no longer shows up as a qualifier, so these two numbers are the only
    place it stays visible. The soak states both what was set and what
    was done, because a soak skipped everywhere would otherwise quote a repeat
    count it never performed. The analytics count is there, zero included, because a
    run that should have blocked requests and blocked none has either stopped
    matching where the app sends them or is measuring a different app.
    """
    head = head.split(" — ", 1)[0]

    def figure(name: str, values: list[float | None]) -> str:
        done = sorted(v for v in values if v is not None)
        if not done:
            return f"{name} not measured"
        return f"{name} {done[len(done) // 2]:.0f}ms median / {done[-1]:.0f}ms worst"

    timing = figure("draw start", draw_start) + " · " + figure("every line drawn", fully_drawn)
    soak = f"soak {soak_cycles} cycles per fixture, {soak_done} completed" if soak_cycles else "no soak"
    blocked = f"{analytics_blocked} analytics request{'s' if analytics_blocked != 1 else ''} blocked"
    return f"quote: {head} · {timing} · {soak} · {reloads} hot reload{'s' if reloads != 1 else ''} · {blocked}"


def skips_summary(skips: dict[str, list[str]]) -> str:
    """Every sweep step whose locator found nothing, named, with a count.

    A step that finds nothing returns without sampling, and a run full of them
    still passes. Some are expected — the Steps rung draws every step, so there
    is nothing on it to press — but a removed feature looks exactly the same,
    and a member split dropped out of this sweep that way while it went on
    passing. So none of them is silent: each is named here with how often and
    where it first happened, and a reader can tell the expected from the new.
    """
    if not any(skips.values()):
        return "steps that found nothing to do: none"
    lines = ["steps that found nothing to do:"]
    for step, where in sorted(skips.items()):
        if where:
            first = f" — first at {where[0]}" if where[0] else ""
            lines.append(f"  {step} ×{len(where)}{first}")
    return "\n".join(lines)


def reached_fixtures(plans: Iterable[str]) -> set[str]:
    """Fixture names that at least one sample actually measured.

    Each plan record reads `<fixture>/<mode>=<plan>`, and one is written per
    sample, so a fixture that opened and then measured nothing is absent — which
    is the right answer for coverage.

    `rsplit`, because a fixture name may itself contain a slash ("big/LITE") and
    only the trailing segment is the motion mode. Splitting from the left reads
    that fixture as "big".
    """
    return {p.split("=", 1)[0].rsplit("/", 1)[0] for p in plans}


def pass_verdict(
    reached: set[str],
    snapshots: set[str],
    missing: list[str],
    runs: int,
    median_late: float,
    settle_ms: float,
    *,
    unexercised: Iterable[str] = (),
    reloads: int = 0,
    draw_start_median: float | None = None,
    fully_drawn_median: float | None = None,
    timing_expected: bool = False,
) -> str:
    """The PASS verdict, composed from what the sweep reached and when it looked.

    Every qualifier belongs in the verdict line itself rather than in a note
    above it: a caveat someone has to scroll back for is a caveat that gets
    dropped when the number is quoted. So the first line is built to be quoted
    alone and still be true, and anything after it is detail that can be lost
    without the verdict becoming false.

    Coverage and timing are independent, so they are composed rather than
    written out per combination — six hand-written sentences are six chances for
    one of them to drift from the rest.

    Coverage asks whether a real captured workflow was measured: whether any
    reached fixture is one of the sweep's `snapshots`. That is decided by what a
    fixture is, not by a list of names that are not real, so a synthetic fixture
    added to the sweep later cannot be mistaken for real data because nobody
    remembered to add it to a list. Nor does it ask whether anything was
    skipped: with three snapshots in the sweep, one of them 404'ing still leaves
    real coverage, and calling that "fixtures only" would understate it as badly
    as the reverse overstates it.

    `unexercised` names the transition kinds the sweep sets out to perform and
    the whole run never did. A sweep step whose locator stops matching the map
    returns without sampling anything, so a UI change can quietly remove a
    transition from the sweep while it goes on passing — which is how a member
    split once dropped out of it. A run that never performed a transition has
    not tested it, and the first line says so.

    `reloads` counts the dev server hot-reloading the page while the run was
    measuring it. With several people saving files under `src/`, a long sweep
    easily spans one, and then its samples were not all taken against one
    version of the code — a claim about "the map" that is really about two. A
    reload also remounts the map, which on its own is enough to re-hold every
    line the motion layer had already drawn, so a failure next to a reload may
    be the reload rather than the map. Nothing in the samples shows it; only
    the count does.

    The draw timings go in the first line whenever they were measured: after a
    rung change, when the new lines start drawing and when the last one is
    drawn, as medians. They are the numbers a fix to the motion layer's hold is
    judged on — measured on every rung change, unlike the absence of a rare
    stuck line, which passes by luck. A run that should have measured them and
    did not says so as a qualifier, so a broken recorder cannot shelter behind a
    line that simply omits them. A run with no motion layer to time keeps the
    line exactly as it has always read.

    Timing qualifies the in-flight claim and nothing else. Settled samples wait
    `settle_ms` for the layout to stop moving, so drift of a few hundred
    milliseconds does not reach them: a skewed run is a full-strength settled
    result and a weak in-flight one. A blanket "samples late" would get the
    settled half discounted too, and that is the half that protects a reader — a
    line left permanently off its card is the bug the checker exists for.
    """
    fixtures_only = not (reached & snapshots)
    late = median_late > LATE_MS_SUSPECT
    never = list(unexercised)
    qualifiers = []
    if fixtures_only:
        qualifiers.append("fixtures only")
    elif missing:
        qualifiers.append(f"{len(missing)} of {runs} fixture runs skipped")
    if never:
        qualifiers.append(f"never exercised: {', '.join(never)}")
    if reloads:
        qualifiers.append(f"source reloaded mid-run ×{reloads}")
    timing_measured = draw_start_median is not None and fully_drawn_median is not None
    if timing_expected and not timing_measured:
        qualifiers.append("draw timing not measured")
    if late:
        qualifiers.append("in-flight samples late")
    # Semicolons between qualifiers, because one can carry a comma-separated
    # list of its own.
    head = "PASS" + (f" ({'; '.join(qualifiers)})" if qualifiers else "")
    subject = "every line measured is" if (fixtures_only or missing or never) else "every line is"
    if late:
        claim = (
            f"{subject} attached to both of its cards once settled; "
            f"in-flight coverage weakened by {median_late:+.0f}ms median skew"
        )
    else:
        claim = f"{subject} attached to both of its cards, in flight and settled"
    if timing_measured:
        claim += (
            f"; after a rung change, lines start drawing at {draw_start_median:.0f}ms"
            f" and are all drawn by {fully_drawn_median:.0f}ms (medians)"
        )
    lines = [f"{head} — {claim}."]
    if late:
        lines.append(
            f"  Settled samples wait for every line to finish drawing, never less than {settle_ms:.0f}ms,\n"
            "  so drift this size does not reach them. The in-flight ones may have landed\n"
            "  after the window they aim at: re-run with\n"
            "  nothing else driving the dev server (another checker, a build) for a\n"
            "  full-strength in-flight result."
        )
    if reloads:
        lines.append(
            f"  The page hot-reloaded {reloads} time{'s' if reloads != 1 else ''} while this run measured it, so its samples\n"
            "  do not all describe one version of the code. Re-run with nothing saving files\n"
            "  under src/ before citing it."
        )
    if never:
        lines.append(
            f"  Never performed anywhere in the run: {', '.join(never)}. A sweep step whose\n"
            "  locator no longer matches the map returns without sampling, so check each one\n"
            "  still finds its target before reading this run as coverage of it."
        )
    if fixtures_only:
        lines.append(
            "  No snapshot fixture was reached, so this is not coverage of real captured\n"
            "  workflows: set RIPPIT_MAP_SNAPSHOT_DIR on the dev server to include them."
        )
    elif missing:
        lines.append(f"  Not reached: {', '.join(missing)}.")
    return "\n".join(lines)
