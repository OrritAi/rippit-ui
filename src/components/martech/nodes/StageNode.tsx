"use client";

import type { StageNode as StageNodeModel } from "@/lib/martech/types";
import { evidenceClasses, selectionRing } from "./evidence";

/*
 * Stage bar under the page: the step's name, its role and position on the
 * spine. Spine edges attach here so the row reads as one line of steps.
 */
export function StageNode({ node, selected }: { node: StageNodeModel; selected: boolean }) {
  return (
    <div
      className={`flex h-full w-full items-center gap-2.5 rounded-control border px-3 ${evidenceClasses(node.evidence)}`}
      style={{ boxShadow: selectionRing(selected) }}
    >
      {node.position > 0 && (
        <span className="tabular flex size-6 flex-none items-center justify-center rounded-full border border-line bg-hover font-mono text-[10.5px] font-bold text-t2">
          {node.position}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold leading-tight" title={node.label}>
          {node.label}
        </span>
        <span className="block truncate text-[10px] text-t3">{node.sublabel}</span>
      </span>
    </div>
  );
}
