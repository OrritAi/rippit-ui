"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEscape } from "@/components/shell/shell-context";

/*
 * The history surface's header, in place of the workflow's ActionBar. Reading
 * a workflow and picking through its runs are different jobs, so the surface
 * says so with its own ground (`--code`) and a `--line-strong` edge rather
 * than the panel's hairline.
 *
 * The surface has two levels and this header is how you can tell which one
 * you are on:
 *
 *   level 1   ← Back      │ History                      │ Dry run
 *   level 2   ← All runs  │ ● success · 3 min ago · 9/9 ⌄ │ Dry run
 *
 * At level 2 the **run is the title** — it occupies the position a page name
 * would, because on that screen the run *is* what you are looking at. The
 * back label names where it goes rather than saying "Back" twice, so one
 * press is always legible before you make it.
 *
 * This is also where the surface's Esc layer is registered. It renders before
 * the map, so its handler sits *under* the map's own layers in the LIFO
 * stack: Esc closes a selected step, then stops the replay, and only then
 * leaves history — and the palette, which Radix owns, still wins over all of
 * them.
 */
export function HistoryHeader({
  onBack,
  backLabel = "Back",
  title,
  onDryRun,
}: {
  onBack: () => void;
  /** Names the destination: `Back` out of history, `All runs` out of a run. */
  backLabel?: string;
  /** Level 2 passes the run switcher; level 1 passes nothing and gets "History". */
  title?: ReactNode;
  onDryRun?: () => void;
}) {
  useEscape(true, onBack);

  return (
    <div className="z-[6] flex min-h-[68px] flex-none items-center gap-[18px] border-b border-line-strong bg-code px-6 py-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-8 flex-none cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-transparent px-3 text-[12.5px] font-semibold text-t1 transition-colors duration-[var(--dur-fast)] hover:bg-hover"
      >
        <ArrowLeft aria-hidden="true" className="size-[14px]" />
        {backLabel}
      </button>
      <span aria-hidden="true" className="h-[26px] w-px flex-none bg-line" />
      {title ?? (
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-extrabold leading-[1.2] tracking-[-0.02em]">History</h1>
        </div>
      )}
      <Button size="sm" onClick={onDryRun}>
        Dry run
      </Button>
    </div>
  );
}
