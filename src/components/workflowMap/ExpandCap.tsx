"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { MapTip } from "./MapTip";

/*
 * The map's one expand control: what is inside, in words, and a circle that
 * says whether it is showing — tinted with a chevron while shut, filled with
 * the chevron turned once open, spinning while it loads. A connected
 * workflow's pill carries it at the end of its capsule; a card standing for
 * more than itself (a branch's folded arm, a packed run, a whole fan-out)
 * carries it in its footer. One look for "show what this holds", wherever it
 * is on the canvas.
 *
 * The label is the same shut or open, so a toggle never changes the size of
 * the element an edge is measured from. Every change here is a CSS state
 * change on a class — nothing can be stranded half-turned — and the ring
 * that leaves the circle as the contents arrive (`.wm-cap-ping`) is played by
 * mounting, so a zoom or a pan never replays it.
 *
 * It stops click and pointerdown, so pressing it neither selects the node it
 * sits on nor starts a pan.
 */
export function ExpandCap({
  open,
  loading = false,
  label,
  hideLabel = false,
  ariaLabel,
  ariaExpanded,
  onToggle,
  tip = null,
  pillToggle = false,
  className = "",
}: {
  open: boolean;
  loading?: boolean;
  /** What is inside — "12 steps". Visually hidden, never unmounted, when `hideLabel`. */
  label: ReactNode;
  /** Far mode: the circle alone. */
  hideLabel?: boolean;
  ariaLabel: string;
  /** Omitted where pressing descends a rung rather than opening in place. */
  ariaExpanded?: boolean;
  onToggle: () => void;
  /** Always pass one where the label can hide, so crossing FAR_AT never remounts the button. */
  tip?: string | null;
  /** The checker's hook for a pill's toggle. */
  pillToggle?: boolean;
  className?: string;
}) {
  const button = (
    <button
      type="button"
      data-wm-pill-toggle={pillToggle ? "" : undefined}
      aria-expanded={ariaExpanded}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={`group/cap inline-flex flex-none cursor-pointer items-center gap-2 whitespace-nowrap rounded-full py-[3px] pr-[3px] ${hideLabel ? "pl-[3px]" : "pl-2.5"} transition-colors duration-200 ease-[var(--ease-out)] hover:bg-[color-mix(in_srgb,var(--map-accent)_9%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-map-accent ${className}`}
    >
      <span className={hideLabel ? "sr-only" : "text-[11px] font-medium leading-none text-map-accent-text"}>{label}</span>
      <span
        aria-hidden="true"
        className={`relative flex size-[22px] flex-none items-center justify-center rounded-full transition-[background-color,color,scale] duration-[260ms] ease-[var(--ease-out)] group-active/cap:scale-90 motion-reduce:transition-none ${open ? "bg-map-accent text-pill" : "bg-[color-mix(in_srgb,var(--map-accent)_14%,transparent)] text-map-accent-text group-hover/cap:bg-[color-mix(in_srgb,var(--map-accent)_22%,transparent)]"}`}
      >
        {loading ? (
          <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
        ) : (
          /* Turns rather than swapping glyphs, so opening reads as the same
             control changing state; on hover it leans the way it will move. */
          <ChevronDown
            strokeWidth={2.5}
            className={`size-[13px] transition-[rotate,translate] duration-[260ms] ease-[var(--ease-out)] motion-reduce:transition-none ${open ? "rotate-180 group-hover/cap:-translate-y-[1.5px]" : "group-hover/cap:translate-y-[1.5px]"}`}
          />
        )}
        {open && !loading && <span className="wm-cap-ping pointer-events-none absolute inset-0 rounded-full" />}
      </span>
    </button>
  );
  return tip ? <MapTip label={tip}>{button}</MapTip> : button;
}
