"use client";

/*
 * The override bracket — the region a change re-projects.
 *
 * It is a **container, not a node treatment**, and that is the whole design.
 * The canvas already spends its two node channels: dimming means `untouched`
 * and a dashed border means `unknown`. A third meaning painted onto nodes
 * would collide with both, so "everything below here is now computed rather
 * than observed" is drawn *around* the region instead.
 *
 * The first attempt washed the subtree and every node chip in `--map-accent`.
 * It was built, reviewed and rejected — "I don't like the whole blue
 * highlight" — and it was rejected for a good reason beyond taste: an accent
 * wash reads as *selection*, which is what `--map-accent` already means on
 * this canvas. Only the node the operator actually changed is marked, in
 * neutral ink; the bracket and the ripple say the rest.
 */

import { RotateCcw } from "lucide-react";

export function OverrideBracket({
  rect,
  cause,
  onRevert,
}: {
  /** Viewport-space box of the affected region, from the map's own measure. */
  rect: { x: number; y: number; width: number; height: number };
  /** Names what caused the re-projection: "your change on Create contact". */
  cause: string;
  onRevert: () => void;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-[2]"
      style={{ left: rect.x - 16, top: rect.y - 18, width: rect.width + 32, height: rect.height + 36 }}
    >
      <div
        className="size-full rounded-[14px]"
        style={{
          border: "1px dashed var(--line-strong)",
          // A 2% white lift, not an accent tint: enough to read as one region,
          // not enough to compete with status or selection.
          background: "color-mix(in srgb, var(--text) 2%, transparent)",
        }}
      />
      <div
        className="pointer-events-auto absolute -top-[12px] left-2 inline-flex items-center gap-2 rounded-full border border-line-strong px-2.5 py-[3px]"
        style={{ background: "var(--plane)" }}
      >
        <span className="font-mono text-[9.5px] text-t2">re-projected from {cause}</span>
        <button
          type="button"
          onClick={onRevert}
          className="inline-flex items-center gap-1 font-mono text-[9.5px] text-t3 transition-colors duration-[var(--dur-fast)] hover:text-t1"
        >
          <RotateCcw className="size-2.5" />
          revert
        </button>
      </div>
    </div>
  );
}

/** The notice above the canvas while any override is active. Says how many,
 *  what changed, and — the part that matters — that nothing left Rippit. */
export function OverrideNotice({
  count,
  detail,
  onReset,
}: {
  count: number;
  /** "opportunity.value 400 → 2500" — the before/after pair, not just the new value. */
  detail: string;
  onReset: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-none items-center gap-3 border-b border-line bg-panel px-4 py-2.5"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-t2">
        {count} {count === 1 ? "override" : "overrides"} · {detail} · nothing sent to Make
      </span>
      <button
        type="button"
        onClick={onReset}
        className="flex-none rounded-control border border-line-strong px-2.5 py-[3px] text-[11px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:text-t1"
      >
        Reset to what happened
      </button>
    </div>
  );
}

/** A changed value, shown as the pair rather than the result. `400 → 2500`
 *  answers "what did I change" in one glance; `2500` alone does not. */
export function BeforeAfter({ before, after }: { before: string; after: string }) {
  return (
    <span className="font-mono text-[11px]">
      <span className="text-t3 line-through">{before}</span>
      <span className="mx-1 text-t3">→</span>
      <span className="text-t1">{after}</span>
    </span>
  );
}
