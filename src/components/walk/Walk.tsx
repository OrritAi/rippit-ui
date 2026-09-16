"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { ChevronRight, Pause, Play, X } from "lucide-react";

import type { ExecutionBundles } from "@/app/lib/api";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { Cube, type Stage } from "./Cube";
import { StagePanel } from "./StagePanel";
import {
  PERSPECTIVE,
  PERSPECTIVE_KICK,
  STEP_MS,
  railBetween,
  worldTransform,
} from "./geometry";

/*
 * First-person walk — a world you traverse, not a HUD over a map.
 *
 * Three rejected attempts are worth recording, because each failure named the
 * constraint that produced this: a bottom HUD bar over the map ("horrible" —
 * it was still a map), floating cards in a void ("not a text RPG game" — no
 * mass), and a straight corridor ("the background is too plain" — no sense of
 * turning). What survives is a fixed place with a moving camera, cubes with
 * real shading, and a horizon.
 *
 * Deliberately absent, both removed in review: the top-left
 * `WALKING / workflow / run` block and the top-right `1 / 6 · depth 4m`
 * counter. The stage label under the cube already says where you are; a
 * counter in the corner is a instrument panel bolted to a world.
 *
 * CSS 3D only — no WebGL, per the standing constraint. Ambience is gated on
 * `prefers-reduced-motion`, which also parks the auto-walk.
 */

export function Walk({
  stages,
  bundles,
  bundlesLoading,
  runLabel,
  startAt = 0,
  onExit,
}: {
  stages: Stage[];
  bundles: ExecutionBundles | null;
  bundlesLoading: boolean;
  /** For the accessible name only — deliberately not drawn in the world. */
  runLabel: string;
  /** Where to stand on entry: the failing step, when there is one. */
  startAt?: number;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(startAt);
  const [playing, setPlaying] = useState(false);
  const [openNode, setOpenNode] = useState<string | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();
  const last = Math.max(0, stages.length - 1);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = Math.min(last, Math.max(0, i + delta));
        if (next !== i) setOpenNode(null);
        return next;
      });
      // The dolly: perspective narrows and opens again, so a step reads as
      // moving rather than cutting. Nothing depends on it — the world has
      // already moved via the transform below.
      const scene = sceneRef.current;
      if (scene && !reduced) {
        animate(
          scene,
          { perspective: [`${PERSPECTIVE_KICK}px`, `${PERSPECTIVE}px`] },
          { duration: 0.62, ease: [0.22, 1, 0.36, 1] },
        );
      }
    },
    [last, reduced],
  );

  /* Auto-walk. Parked entirely under reduced motion — an animation the
     operator cannot stop is worse than no animation. */
  useEffect(() => {
    if (!playing || reduced) return;
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= last) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, STEP_MS);
    return () => clearInterval(t);
  }, [playing, reduced, last]);

  /* Keyboard is the whole navigation contract: arrows or A/D to walk, Esc to
     leave. Ignored while a text field has focus so a future search box cannot
     be hijacked. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        e.preventDefault();
        setPlaying(false);
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        setPlaying(false);
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onExit]);

  if (stages.length === 0) {
    return (
      <div className="relative flex flex-1 items-center justify-center bg-bg">
        <p className="text-[12.5px] text-t3">This run reached no steps Orrit can show.</p>
        <ExitButton onExit={onExit} />
      </div>
    );
  }

  return (
    <div
      className="relative flex-1 overflow-hidden bg-bg"
      role="group"
      aria-label={`Walking ${runLabel}, stage ${index + 1} of ${stages.length}`}
    >
      {/* Ground, ceiling, horizon and stars: the whole reason the world has a
          sense of depth. All CSS gradients — no images anywhere in Orrit. */}
      <Ambience reduced={reduced} />

      <div
        ref={sceneRef}
        className="absolute inset-0"
        style={{ perspective: `${PERSPECTIVE}px`, perspectiveOrigin: "50% 46%" }}
      >
        <div
          className="absolute inset-0"
          style={{
            transformStyle: "preserve-3d",
            transform: worldTransform(index),
            transition: reduced ? "none" : "transform .62s cubic-bezier(.22,1,.36,1)",
          }}
        >
          {stages.slice(0, -1).map((_, i) => {
            const rail = railBetween(i);
            return (
              <div
                key={`rail-${i}`}
                aria-hidden
                className="absolute left-1/2 top-1/2"
                style={{
                  width: rail.length,
                  height: 2,
                  marginLeft: -rail.length / 2,
                  transform: rail.transform,
                  transformStyle: "preserve-3d",
                  background:
                    "linear-gradient(90deg, transparent, color-mix(in srgb, var(--map-accent) 55%, transparent), transparent)",
                  boxShadow: "0 0 12px color-mix(in srgb, var(--map-accent) 40%, transparent)",
                  opacity: i >= index ? 0.9 : 0.35,
                }}
              />
            );
          })}

          {stages.map((stage, i) => (
            <Cube
              key={stage.nodeId}
              stage={stage}
              index={i}
              here={i === index}
              open={openNode === stage.nodeId}
              onOpen={(id) => setOpenNode((cur) => (cur === id ? null : id))}
            />
          ))}
        </div>
      </div>

      {/* Crosshair at eye level — a fixed reference that makes the world's
          movement legible. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[46%] size-1.5 -translate-x-1/2 rounded-full"
        style={{ border: "1px solid color-mix(in srgb, var(--map-accent) 70%, transparent)" }}
      />

      {openNode && (
        <StagePanel
          stage={stages.find((s) => s.nodeId === openNode)!}
          bundles={bundles}
          loading={bundlesLoading}
          onClose={() => setOpenNode(null)}
        />
      )}

      <Hud
        index={index}
        last={last}
        playing={playing && !reduced}
        canPlay={!reduced}
        onBack={() => {
          setPlaying(false);
          go(-1);
        }}
        onNext={() => {
          setPlaying(false);
          go(1);
        }}
        onTogglePlay={() => setPlaying((p) => !p)}
        onExit={onExit}
      />
    </div>
  );
}

function Ambience({ reduced }: { reduced: boolean }) {
  return (
    <>
      {/* Floor: an accent grid laid nearly flat and masked out toward the
          horizon, so it fades rather than ending in a hard line. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{
          transform: "perspective(520px) rotateX(72deg)",
          transformOrigin: "50% 0%",
          backgroundImage:
            "linear-gradient(color-mix(in srgb, var(--map-accent) 18%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--map-accent) 18%, transparent) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "linear-gradient(to top, black, transparent 78%)",
          WebkitMaskImage: "linear-gradient(to top, black, transparent 78%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
        style={{
          transform: "perspective(520px) rotateX(-72deg)",
          transformOrigin: "50% 100%",
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "linear-gradient(to bottom, black, transparent 78%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent 78%)",
        }}
      />
      {/* Horizon with its bloom, at the camera's own eye line. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0"
        style={{
          top: "44%",
          height: 1,
          background: "color-mix(in srgb, var(--map-accent) 45%, transparent)",
          boxShadow: "0 0 60px 12px color-mix(in srgb, var(--map-accent) 16%, transparent)",
        }}
      />
      {/* Starfield: three radial-gradient layers, static under reduced
          motion (they never move anyway — the camera does). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: "44%",
          opacity: reduced ? 0.4 : 0.7,
          backgroundImage:
            "radial-gradient(1px 1px at 12% 30%, rgba(255,255,255,.5), transparent), radial-gradient(1px 1px at 63% 18%, rgba(255,255,255,.35), transparent), radial-gradient(1px 1px at 82% 52%, rgba(255,255,255,.45), transparent), radial-gradient(1px 1px at 34% 66%, rgba(255,255,255,.3), transparent)",
          backgroundSize: "420px 220px",
        }}
      />
      {/* Vignette, pulling the edges to black so the world has no corners. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 46%, transparent 40%, var(--bg) 100%)" }}
      />
    </>
  );
}

function Hud({
  index,
  last,
  playing,
  canPlay,
  onBack,
  onNext,
  onTogglePlay,
  onExit,
}: {
  index: number;
  last: number;
  playing: boolean;
  canPlay: boolean;
  onBack: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onExit: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 pb-6">
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={index === 0}
          className="rounded-control border border-line-strong bg-pill px-3 py-1.5 text-[12px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:text-t1 disabled:pointer-events-none disabled:opacity-40"
        >
          Back
        </button>
        {canPlay && (
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? "Pause the walk" : "Walk automatically"}
            className="inline-flex size-[34px] items-center justify-center rounded-full border border-line-strong bg-pill text-t2 transition-colors duration-[var(--dur-fast)] hover:text-t1"
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          disabled={index >= last}
          className="inline-flex items-center gap-1.5 rounded-control bg-t1 px-3 py-1.5 text-[12px] font-semibold text-bg transition-opacity duration-[var(--dur-fast)] disabled:pointer-events-none disabled:opacity-40"
        >
          Next stage
          <ChevronRight className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onExit}
          aria-label="Leave the walk"
          className="inline-flex size-[34px] items-center justify-center rounded-full border border-line-strong bg-pill text-t2 transition-colors duration-[var(--dur-fast)] hover:text-t1"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <p className="m-0 font-mono text-[9.5px] tracking-[.14em] text-t3">← → · esc</p>
    </div>
  );
}

function ExitButton({ onExit }: { onExit: () => void }) {
  return (
    <button
      type="button"
      onClick={onExit}
      aria-label="Leave the walk"
      className="absolute bottom-6 left-1/2 inline-flex size-[34px] -translate-x-1/2 items-center justify-center rounded-full border border-line-strong bg-pill text-t2 hover:text-t1"
    >
      <X className="size-3.5" />
    </button>
  );
}
