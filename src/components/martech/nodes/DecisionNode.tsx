"use client";

import { Split } from "lucide-react";
import type { DecisionNode as DecisionNodeModel } from "@/lib/martech/types";
import { evidenceClasses, selectionRing } from "./evidence";

/*
 * Decision card: the qualification split read from the survey's disqualify
 * logic. Sits on the spine between the application step and the next one;
 * the disqualified page hangs below it on the branch lane.
 */
export function DecisionNode({ node, selected }: { node: DecisionNodeModel; selected: boolean }) {
  const outcomes = node.decision.branches.map((b) => b.outcome);
  return (
    <div
      className={`flex min-h-full w-full items-center gap-2 rounded-control border px-2.5 py-1.5 ${evidenceClasses(node.evidence)}`}
      style={{ boxShadow: selectionRing(selected) }}
    >
      <span className="flex size-7 flex-none rotate-45 items-center justify-center rounded-[6px] border border-line-strong bg-hover">
        <Split aria-hidden="true" className="size-3.5 -rotate-45 text-t2" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block [overflow-wrap:anywhere] text-[12px] font-semibold leading-tight">
          {node.label}
        </span>
        <span className="block [overflow-wrap:anywhere] text-[9.5px] uppercase leading-[12px] tracking-[.04em] text-t3">
          {outcomes.length ? outcomes.join(" / ") : node.sublabel}
        </span>
      </span>
    </div>
  );
}
