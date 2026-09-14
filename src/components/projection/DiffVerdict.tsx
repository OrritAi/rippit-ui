"use client";

import { ArrowUpRight } from "lucide-react";

import type { DiffOutcome, ProjectionVerdict } from "@/app/lib/api";

/*
 * The verdict — the deliverable of the diff, and the reason it is a sentence
 * rather than a table.
 *
 * It is grouped **by cause, not by step**: three steps that stopped running
 * because one router's filter moved is one fact. A per-step list makes the
 * operator do the grouping, which is the work they came here to avoid.
 *
 * The `--err` rule is reserved for a real divergence. "Cannot be checked" is
 * not a divergence and does not get it — a workflow with an HTTP call in it
 * would otherwise show red every time, and a warning that always fires is
 * one nobody reads.
 */

export function DiffVerdict({
  verdict,
  onOpenChange,
}: {
  verdict: ProjectionVerdict;
  /** Opens the change log at the edit the verdict names, when there is one. */
  onOpenChange?: () => void;
}) {
  const diverged = verdict.changed.length > 0 && verdict.unevaluable < verdict.changed.length;
  const tone = diverged ? "var(--err)" : "var(--warn)";
  return (
    <div
      role="status"
      className="flex flex-none items-start gap-3 border-b border-line bg-panel px-4 py-3"
      style={{ borderLeft: `2px solid ${tone}` }}
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[12.5px] leading-[1.55] text-t1">
          <span className="font-semibold">{verdict.headline}</span>
          {verdict.detail ? ` ${verdict.detail}` : null}
        </p>
        {verdict.unevaluable > 0 && diverged && (
          <p className="m-0 mt-1 font-mono text-[10px] text-t3">
            {verdict.unevaluable} more {verdict.unevaluable === 1 ? "step" : "steps"} could not be
            checked, and are not counted as differences
          </p>
        )}
      </div>
      {onOpenChange && (
        <button
          type="button"
          onClick={onOpenChange}
          className="inline-flex flex-none items-center gap-1 rounded-control border border-line-strong px-2.5 py-1 text-[11.5px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:text-t1"
        >
          Open the change
          <ArrowUpRight className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Per-node outcome marks, as the design specifies them. `same` gets nothing:
 *  a diff that decorates every unchanged node is a diff nobody can read. */
export const OUTCOME_MARK: Record<DiffOutcome, { label: string; tone: string } | null> = {
  same: null,
  "newly-reached": { label: "now", tone: "var(--map-accent-text)" },
  "no-longer-reached": { label: "no longer reached", tone: "var(--err-text)" },
  "now-unevaluable": { label: "can't check", tone: "var(--warn-text)" },
  new: { label: "new", tone: "var(--chg-text)" },
  gone: { label: "gone", tone: "var(--off-text)" },
};
