"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLinks, type LinkMap } from "@/app/lib/api";
import { useConnections, useWorkflowIndex } from "@/components/app/ConnectionsProvider";
import { ErrorCard } from "@/components/shared/ErrorCard";
import { LoadingState } from "@/components/shared/LoadingState";
import { StatusPill } from "@/components/shared/StatusPill";
import { useEscape } from "@/components/shell/shell-context";
import { ViewBar } from "@/components/views/ViewFrame";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useHydrated } from "@/lib/stored";
import { ArcPanel, NodePanel } from "./DetailPanels";
import { GlobeTooltip } from "./GlobeTooltip";
import { INTRO, readBooted, writeBooted } from "./intro";
import { buildGlobeModel } from "./model";
import { paletteFor } from "./palette";
import { PlatformsPanel } from "./PlatformsPanel";
import { BootOverlay } from "./BootOverlay";
import { useGlobeRenderer, type Hover, type Sel } from "./useGlobeRenderer";

/*
 * Home = the estate as a globe. Every workflow across the connected platforms
 * is a node; verified cross-workflow links are arcs; incidents pulse. The
 * shell keeps its rail and search bar; this view adds the standard 46px bar
 * with the fleet counts and a Live pill that only says "Live" while the link
 * map is actually fresh.
 */

const POLL_MS = 60_000;
const FRESH_MS = 120_000;
const INTRO_SAFETY_MS = 6_000;

type LinksStatus = "pending" | "ok" | "error";
type BootPhase = "pending" | "intro" | "static";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function WorkflowGlobe({ intro = true }: { intro?: boolean }) {
  const { linkMap: ctxLinkMap, connections, loading: connectionsLoading, refresh } = useConnections();
  const index = useWorkflowIndex();
  const reduced = usePrefersReducedMotion();
  const hydrated = useHydrated();
  const { resolvedTheme } = useTheme();
  const palette = hydrated && resolvedTheme ? paletteFor(resolvedTheme) : null;

  /* ─── Link map: seeded from context, kept fresh by a light poll ────── */
  const [links, setLinks] = useState<{ map: LinkMap | null; at: number | null; status: LinksStatus }>({
    map: ctxLinkMap,
    at: ctxLinkMap ? Date.now() : null,
    status: ctxLinkMap ? "ok" : "pending",
  });
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    try {
      const map = await fetchLinks();
      setLinks({ map, at: Date.now(), status: "ok" });
    } catch {
      setLinks((s) => ({ ...s, status: "error" }));
    }
  }, []);
  useEffect(() => {
    if (ctxLinkMap) setLinks({ map: ctxLinkMap, at: Date.now(), status: "ok" });
  }, [ctxLinkMap]);
  useEffect(() => {
    let cancelled = false;
    if (!ctxLinkMap) load();
    const tick = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      load();
    };
    const poll = setInterval(tick, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const linkMap = links.map;
  const model = useMemo(() => buildGlobeModel({ linkMap, index, connections }), [linkMap, index, connections]);
  const hasNodes = model.nodes.length > 0;

  /* ─── View state ───────────────────────────────────────────────────── */
  const [hover, setHover] = useState<Hover | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  useEscape(sel !== null, () => {
    setSel(null);
    return true;
  });
  // Filtering ghosts nodes; a tooltip must not linger on one.
  useEffect(() => setHover(null), [filter]);
  // A refetch can shrink the model; never point at a node that is gone.
  useEffect(() => {
    setSel((s) => (s && s.i >= (s.type === "node" ? model.nodes.length : model.arcs.length) ? null : s));
    setHover((h) => (h && h.i >= model.nodes.length ? null : h));
  }, [model]);

  /* ─── Boot / intro ─────────────────────────────────────────────────── */
  const [bootPhase, setBootPhase] = useState<BootPhase>("pending");
  const [booting, setBooting] = useState(false);
  const [entered, setEntered] = useState(false);
  const bootTimer = useRef<number | null>(null);
  useEffect(() => {
    const forced = window.location.search.includes("intro=1");
    const play = intro && !reduced && (forced || !readBooted());
    setBootPhase(play ? "intro" : "static");
    setBooting(play);
    // Decided once per mount on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onIntroStart = useCallback(() => {
    setEntered(true);
    bootTimer.current = window.setTimeout(() => {
      setBooting(false);
      writeBooted();
    }, INTRO.overlayFadeAtMs);
  }, []);
  useEffect(() => () => {
    if (bootTimer.current) clearTimeout(bootTimer.current);
  }, []);
  // Safety valve: never leave the cover up over an estate that has nothing
  // to assemble (empty, still loading, or failed).
  useEffect(() => {
    if (bootPhase !== "intro" || hasNodes) return;
    const settled = !connectionsLoading && (connections.length === 0 || links.status === "error" || (links.status === "ok" && !hasNodes));
    if (settled) {
      setBootPhase("static");
      setBooting(false);
      return;
    }
    const t = window.setTimeout(() => {
      setBootPhase("static");
      setBooting(false);
    }, INTRO_SAFETY_MS);
    return () => clearTimeout(t);
  }, [bootPhase, hasNodes, connectionsLoading, connections.length, links.status]);

  const playingIntro = bootPhase === "intro";
  const { wrapRef, canvasRef } = useGlobeRenderer({
    model,
    palette,
    reduced,
    intro: playingIntro,
    view: { hover, sel, filter },
    onHover: setHover,
    onSelect: setSel,
    onIntroStart,
  });

  /* ─── Derived chrome ───────────────────────────────────────────────── */
  const counts = model.counts;
  const fresh = links.at !== null && now - links.at < FRESH_MS;
  const pill =
    links.status === "pending" && !linkMap
      ? { label: "Loading", tone: "muted" as const }
      : links.status === "error" && !linkMap
        ? { label: "Offline", tone: "err" as const }
        : fresh
          ? { label: "Live", tone: "ok" as const }
          : { label: `Stale · ${Math.max(1, Math.round((now - (links.at ?? now)) / 60_000))}m`, tone: "muted" as const };
  const summary = linkMap
    ? `${plural(counts.platforms, "platform")} connected · ${plural(counts.workflows, "workflow")} · ${plural(counts.incidents, "incident")}`
    : "— platforms connected · — workflows · — incidents";

  const noConnections = !connectionsLoading && connections.length === 0;
  const linksFailed = !linkMap && links.status === "error" && connections.length > 0;
  const linksPending = !linkMap && links.status !== "error" && !noConnections;
  const emptyEstate = !!linkMap && !hasNodes && !noConnections;
  const covered = bootPhase === "pending" || !palette;
  const showChrome = hasNodes && (!playingIntro || entered);
  const selNode = sel && sel.type === "node" ? model.nodes[sel.i] : null;
  const selArc = sel && sel.type === "arc" ? model.arcs[sel.i] : null;
  const hoverNode = hover ? model.nodes[hover.i] : null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="Workflow map">
        <span className="tabular hidden font-mono text-[11px] text-t3 sm:block">{summary}</span>
        <StatusPill pill={pill} pulse={pill.label === "Live" && !reduced} />
      </ViewBar>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-bg">
        <div ref={wrapRef} className="absolute inset-0">
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label="Workflow globe. Arrow keys rotate, plus and minus zoom, Enter opens the highlighted workflow, Escape closes the panel."
            aria-describedby="globe-summary"
            className="block h-full w-full cursor-grab touch-none select-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ringc)]"
          />
        </div>
        <p id="globe-summary" className="sr-only">
          {summary}
        </p>

        {hover && hoverNode && <GlobeTooltip hover={hover} node={hoverNode} />}

        {showChrome && palette && (
          <PlatformsPanel
            platforms={model.platforms}
            total={counts.workflows}
            connected={counts.platforms}
            filter={filter}
            onFilter={setFilter}
            open={panelOpen}
            onToggle={() => setPanelOpen((v) => !v)}
            palette={palette}
            animate={playingIntro && !reduced}
          />
        )}
        {selNode && <NodePanel node={selNode} onClose={() => setSel(null)} />}
        {selArc && <ArcPanel arc={selArc} nodes={model.nodes} onClose={() => setSel(null)} />}
        {showChrome && (
          <div
            className="pointer-events-none absolute bottom-[14px] right-4 z-[4] font-mono text-[11.5px] text-t3"
            style={playingIntro && !reduced ? { animation: `riseIn 450ms var(--ease-out) ${INTRO.hintDelayMs}ms both` } : undefined}
          >
            drag to rotate · scroll to zoom
          </div>
        )}

        {!playingIntro && noConnections && (
          <div className="absolute inset-0 z-[8] flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-card border border-line bg-pill p-6 text-center shadow-[var(--shadow-card)] anim-fade-up">
              <h1 className="mb-1.5 text-[15px] font-semibold">Nothing connected yet</h1>
              <p className="mb-4 text-[13px] text-t2">
                The workflow map shows every automation across your platforms as one globe. Connect Make or HighLevel to populate it.
              </p>
              <Link href="/settings/connections" className="text-[13px] font-semibold text-t1 underline-offset-4 hover:underline">
                Open Settings
              </Link>
            </div>
          </div>
        )}
        {!playingIntro && !noConnections && linksFailed && (
          <div className="absolute inset-0 z-[8]">
            <ErrorCard
              title="Failed to load the workflow map"
              message="The cross-platform link map couldn’t be fetched."
              onRetry={() => {
                setLinks((s) => ({ ...s, status: "pending" }));
                load();
                refresh();
              }}
              backHref="/settings/connections"
              backLabel="Connections"
            />
          </div>
        )}
        {!playingIntro && !noConnections && !linksFailed && linksPending && (
          <div className="absolute inset-0 z-[8]">
            <LoadingState message="Loading your workflows…" />
          </div>
        )}
        {!playingIntro && emptyEstate && (
          <div className="pointer-events-none absolute inset-0 z-[8] flex items-center justify-center p-4">
            <p className="pointer-events-auto max-w-sm text-center text-[13px] italic text-t3">
              No workflows indexed yet — sync a connection to populate the globe.{" "}
              <Link href="/settings/connections" className="not-italic font-semibold text-t1 underline-offset-4 hover:underline">
                Connections
              </Link>
            </p>
          </div>
        )}

        <BootOverlay show={booting} workflows={counts.workflows} />
        {covered && <div aria-hidden="true" className="absolute inset-0 z-30 bg-bg" />}
      </div>
    </div>
  );
}
