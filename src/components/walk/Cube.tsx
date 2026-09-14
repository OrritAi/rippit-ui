"use client";

import { appColor, appGlyph } from "@/lib/apps";
import { CUBE_BASE, FACES, SIZE_BEYOND, SIZE_HERE, stageTransform } from "./geometry";

/*
 * A stage is a cube, not a card.
 *
 * Floating cards in a void were built and rejected ("not a text RPG game") —
 * a card has no mass, so a world made of them reads as a menu with a
 * background. Six shaded faces under `preserve-3d` give the thing volume, and
 * volume is what makes moving past it feel like moving.
 *
 * Minimal information by design: the app monogram on the front face, the step
 * name and `01 · CLEARED` beneath. Everything else waits for a click. The
 * temptation is to put the payload on the cube; that turns a world back into a
 * dashboard.
 */

export type WalkState = "cleared" | "failed" | "skipped" | "unknown";

const STATE_WORD: Record<WalkState, string> = {
  cleared: "CLEARED",
  failed: "FAILED",
  skipped: "NOT REACHED",
  unknown: "NOT CHECKED",
};

const STATE_DOT: Record<WalkState, string> = {
  cleared: "var(--ok)",
  failed: "var(--err)",
  skipped: "var(--off)",
  unknown: "var(--off)",
};

export interface Stage {
  nodeId: string;
  name: string;
  app: string;
  ordinal: string;
  state: WalkState;
}

export function Cube({
  stage,
  index,
  here,
  open,
  onOpen,
}: {
  stage: Stage;
  index: number;
  /** The stage the camera is standing at: bigger, brighter, fully saturated. */
  here: boolean;
  open: boolean;
  onOpen: (nodeId: string) => void;
}) {
  const size = here ? SIZE_HERE : SIZE_BEYOND;
  const half = size / 2;
  const colour = appColor(stage.app);
  // Distance dims the whole mass, not each face separately, so the shading
  // relationship between faces survives — a far cube reads as the same object
  // further away rather than a differently-lit one.
  const depth = here ? 0.62 : 0.42;

  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{ transform: stageTransform(index), transformStyle: "preserve-3d" }}
    >
      <button
        type="button"
        onClick={() => onOpen(stage.nodeId)}
        aria-label={`${stage.ordinal} ${stage.name} — ${STATE_WORD[stage.state]}`}
        aria-expanded={open}
        className="absolute cursor-pointer border-0 bg-transparent p-0"
        style={{
          width: size,
          height: size,
          marginLeft: -half,
          marginTop: -half,
          transformStyle: "preserve-3d",
          transform: `rotateX(-14deg)`,
        }}
      >
        {FACES.map((face) => (
          <span
            key={face.name}
            aria-hidden
            className="absolute inset-0"
            style={{
              transform: `${face.rotate} translateZ(${half}px)`,
              background: `color-mix(in oklab, ${colour} ${Math.round(face.shade * 100 * depth)}%, ${CUBE_BASE})`,
              border: `1px solid color-mix(in srgb, ${colour} ${here ? 85 : 55}%, transparent)`,
              boxShadow: "inset 0 0 30px rgba(0,0,0,.55)",
            }}
          />
        ))}
        {/* The monogram rides the front face only. */}
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center font-mono font-bold text-white"
          style={{ transform: `translateZ(${half + 1}px)`, fontSize: here ? 34 : 26, opacity: here ? 1 : 0.75 }}
        >
          {appGlyph(stage.app)}
        </span>
      </button>

      {/* The label is a billboard: it counter-tilts so it stays readable while
          the cube behind it is turned. */}
      <div
        className="absolute left-1/2 w-[260px] -translate-x-1/2 text-center"
        style={{ top: half + 14, transform: "translateX(-50%) rotateX(0deg)" }}
      >
        <div
          className="truncate text-[13px] font-semibold"
          style={{ color: here ? "var(--text)" : "var(--t2)" }}
          title={stage.name}
        >
          {stage.name}
        </div>
        <div className="mt-1 flex items-center justify-center gap-1.5 font-mono text-[9.5px] tracking-[.12em] text-t3">
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ background: STATE_DOT[stage.state] }}
          />
          {stage.ordinal} · {STATE_WORD[stage.state]}
        </div>
      </div>
    </div>
  );
}
