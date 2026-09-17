"use client";

import { useId, useState } from "react";
import { ChevronDown, GitBranch, HelpCircle, X } from "lucide-react";

/*
 * The legend for the unified system map (/map). Keep this the single place
 * the visual vocabulary is spelled out — tokens here must match what the
 * map's node canvas renders.
 */

type Item = { swatch: React.ReactNode; label: string; hint?: string };

const ITEMS: Item[] = [
  {
    swatch: <span className="rounded-full border border-line bg-pill px-1.5 py-[1px] font-mono text-[10px] text-t3">2.1.3</span>,
    label: "Execution order",
    hint: "Depth along the path; routes/branches continue the count",
  },
  {
    swatch: <span className="text-[12px] text-t2">Wait 30 min</span>,
    label: "Wait step",
    hint: "Duration from the platform's config",
  },
  {
    swatch: <span className="h-[2px] w-6 rounded bg-edge" style={{ background: "var(--t3)" }} />,
    label: "Sequence",
  },
  {
    swatch: <span className="h-0 w-6 border-t-2 border-dashed" style={{ borderColor: "var(--warn)" }} />,
    label: "Cross-platform link",
    hint: "Webhook / API / subflow call between workflows",
  },
  {
    swatch: <span className="h-0 w-6 border-t-2 border-dashed" style={{ borderColor: "var(--err)" }} />,
    label: "Dead link",
    hint: "Target hook gone or disabled",
  },
  {
    swatch: <span className="h-0 w-6 border-t-2 border-dotted" style={{ borderColor: "var(--t3)" }} />,
    label: "Shared asset",
    hint: "Both workflows reference the same sheet / tag / endpoint",
  },
  {
    swatch: <span className="rounded-[3px] border border-line px-1 py-[1px] text-[9px] text-t3">grp</span>,
    label: "Workflow container",
    hint: "Node-level view: one box per workflow, ordered by who calls whom",
  },
  {
    swatch: <span className="rounded-full border border-line bg-pill px-1.5 py-[1px] text-[9px] text-t2">💬 2</span>,
    label: "Open comment threads",
    hint: "Click the step → Comments in its panel",
  },
  {
    swatch: <span className="size-3 rounded-[5px] border-2" style={{ borderColor: "var(--chg)", boxShadow: "0 0 6px var(--chg)" }} />,
    label: "Changed since you last looked",
    hint: "Orrit snapshot diff at sync — open Changes for details",
  },
  {
    swatch: <span className="size-2.5 rounded-full border-2 border-plane" style={{ background: "var(--warn)" }} />,
    label: "Filter on step",
  },
  {
    swatch: <span className="size-2.5 rounded-full border-2 border-plane" style={{ background: "var(--err)" }} />,
    label: "Error handler / unmatched link",
  },
  {
    swatch: <span className="rounded-full px-1.5 py-[1px] text-[10px] font-semibold" style={{ background: "color-mix(in srgb, var(--warn) 18%, transparent)", color: "var(--warn-text)" }}>↗</span>,
    label: "Portal to connected workflow",
  },
  // The ladder of description (src/lib/workflowMap/model.ts). A large
  // workflow is mostly the same branch several times over; these marks are
  // how the canvas says so instead of drawing it.
  {
    swatch: <span className="h-3 w-5 rounded-[4px] border border-map-main-line bg-map-main" />,
    label: "The workflow you're viewing",
    hint: "Its own steps and branches. A workflow it calls hangs below in plain cards",
  },
  {
    swatch: (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-map-accent-text">
        12 steps
        <span className="flex size-4 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--map-accent)_14%,transparent)]">
          <ChevronDown aria-hidden="true" strokeWidth={2.5} className="size-[10px]" />
        </span>
      </span>
    ),
    label: "Drawn as one card",
    hint: "A branch, or a run of steps in a line. Click to show what it stands for",
  },
  {
    swatch: (
      <span className="relative inline-block">
        <span aria-hidden="true" className="absolute left-[3px] top-[3px] size-3 rounded-[3px] border border-line opacity-60" />
        <span className="relative block size-3 rounded-[3px] border border-line-strong bg-pill" />
      </span>
    ),
    label: "Many outcomes in one card",
    hint: "Overview only — the thickness is how many branches stand behind it",
  },
  {
    swatch: (
      <span className="flex size-4 items-center justify-center rounded-[5px] border border-line text-t3">
        <GitBranch aria-hidden="true" className="size-[9px]" />
      </span>
    ),
    label: "A branch",
    hint: "Its own name in the accent — a branch belongs to no app, so it wears no app tile",
  },
  {
    swatch: (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-map-accent-text">
        12 steps
        <span className="flex size-4 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--map-accent)_14%,transparent)]">
          <ChevronDown aria-hidden="true" strokeWidth={2.5} className="size-[10px]" />
        </span>
      </span>
    ),
    label: "Show a connected workflow's steps",
    hint: "The circle fills once they are showing — click it again to hide them",
  },
  {
    swatch: <span className="text-[11px] font-medium text-t2">↺ already open above</span>,
    label: "Already open further up",
    hint: "This workflow calls back into one already open above it, so it cannot open again here",
  },
  {
    swatch: (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-map-accent-text">
        ↗ open in Canceled
        <span className="flex size-4 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--map-accent)_14%,transparent)]">
          <ChevronDown aria-hidden="true" strokeWidth={2.5} className="size-[10px]" />
        </span>
      </span>
    ),
    label: "Open at another step",
    hint: "The same workflow is called from several places and drawn open at one — click to open it here instead",
  },
  {
    swatch: <span className="text-[11px] font-semibold text-t1">9 outcomes</span>,
    label: "Every outcome of one decision",
    hint: "Overview only — it says how many and how many shapes, never that they match",
  },
  // Step data's provenance register. The Legend is the single vocabulary, so
  // every mark that carries meaning gets a row — these four are how a panel
  // answers "did this happen, or did Orrit work it out".
  {
    swatch: <span className="h-4 w-0" style={{ borderLeft: "2px solid var(--t2)" }} />,
    label: "Observed",
    hint: "The platform recorded this value in the run",
  },
  {
    swatch: <span className="h-4 w-0" style={{ borderLeft: "2px solid var(--map-accent)" }} />,
    label: "You set it",
    hint: "Your typed input or override, held for this view and never stored",
  },
  {
    swatch: <span className="h-4 w-0" style={{ borderLeft: "2px dashed var(--t3)" }} />,
    label: "Computed",
    hint: "Orrit worked it out from the steps above — not what the platform reported",
  },
  {
    swatch: <span className="h-4 w-0" style={{ borderLeft: "2px dotted var(--t3)" }} />,
    label: "Needs a step",
    hint: "Depends on a step's output Orrit cannot compute; supply it to continue",
  },
];

export function Legend({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`pointer-events-auto ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-line bg-glass px-2.5 py-1 text-[11px] font-semibold text-t2 backdrop-blur-[8px] transition-colors hover:text-t1"
      >
        <HelpCircle aria-hidden="true" className="size-3" />
        Legend
      </button>
      {open && (
        <div
          id={id}
          role="region"
          aria-label="Canvas legend"
          className="mt-1.5 w-[260px] rounded-card border border-line bg-panel p-3 shadow-[0_12px_30px_var(--ambient)]"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-t1">What you&apos;re looking at</span>
            <button
              type="button"
              aria-label="Close legend"
              onClick={() => setOpen(false)}
              className="text-t3 hover:text-t1"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </div>
          <ul className="flex flex-col gap-1.5">
            {ITEMS.map((item) => (
              <li key={item.label} className="flex items-start gap-2.5">
                <span className="flex w-10 shrink-0 items-center justify-center pt-[2px]">{item.swatch}</span>
                <span className="min-w-0">
                  <span className="block text-[12px] text-t1">{item.label}</span>
                  {item.hint && <span className="block text-[11px] text-t3">{item.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
