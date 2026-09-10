"use client";

import { useId, useState } from "react";
import { HelpCircle, X } from "lucide-react";

/*
 * Legend for the Martech canvas — the same shell as canvas/Legend.tsx, with
 * this surface's vocabulary. Tokens here must match what MartechCanvas
 * draws (edgeStyle) and how nodes render evidence (nodes/evidence.ts).
 */

type Item = { swatch: React.ReactNode; label: string; hint?: string };

const ITEMS: Item[] = [
  {
    swatch: <span className="h-6 w-8 rounded-[4px] border border-line bg-pill" />,
    label: "Configured",
    hint: "Read from the platform's configuration",
  },
  {
    swatch: <span className="h-6 w-8 rounded-[4px] border border-dashed border-line-strong" />,
    label: "Not captured",
    hint: "Rippit has nothing for this yet — not a fault in the estate",
  },
  {
    swatch: <span className="h-[2px] w-6 rounded" style={{ background: "var(--edge)" }} />,
    label: "Page order / automation flow",
  },
  {
    swatch: <span className="h-0 w-6 border-t-2" style={{ borderColor: "var(--err)" }} />,
    label: "Disqualified branch",
    hint: "Survey outcome that leaves the funnel",
  },
  {
    swatch: <span className="h-0 w-6 border-t-2 border-dotted" style={{ borderColor: "var(--t3)" }} />,
    label: "Trigger listens on this asset",
  },
  {
    swatch: <span className="h-0 w-6 border-t-2 border-dashed" style={{ borderColor: "var(--warn)" }} />,
    label: "Server conversion report",
    hint: "Configured Conversions API action — not a delivery record",
  },
  {
    swatch: <span className="h-0 w-6 border-t-2 border-dotted" style={{ borderColor: "var(--t3)", borderImage: "none" }} />,
    label: "Same asset on another page",
  },
  {
    swatch: <span className="h-0 w-6 border-t-2 border-dashed opacity-70" style={{ borderColor: "var(--t3)" }} />,
    label: "Inferred / not captured link",
    hint: "Traffic source or a step order Rippit could not confirm",
  },
  {
    swatch: <span className="rounded-full border px-1.5 py-[1px] text-[9px] font-semibold" style={{ color: "var(--err-text)", borderColor: "color-mix(in srgb, var(--err) 40%, transparent)" }}>! stale</span>,
    label: "Relationship no longer current",
  },
];

export function MartechLegend({ className = "" }: { className?: string }) {
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
        <div id={id} role="region" aria-label="Canvas legend" className="mt-1.5 w-[270px] rounded-card border border-line bg-panel p-3 shadow-[0_12px_30px_var(--ambient)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-t1">What you&apos;re looking at</span>
            <button type="button" aria-label="Close legend" onClick={() => setOpen(false)} className="text-t3 hover:text-t1">
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
          <p className="mt-2 border-t border-line2 pt-2 text-[10.5px] text-t3">
            Everything here is configuration Rippit read. Nothing shows whether a step ran.
          </p>
        </div>
      )}
    </div>
  );
}
