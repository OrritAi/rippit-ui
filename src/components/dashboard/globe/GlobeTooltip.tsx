import { ago } from "@/lib/time";
import { statusWord, type GlobeNode } from "./model";
import type { Hover } from "./useGlobeRenderer";

export function GlobeTooltip({ hover, node }: { hover: Hover; node: GlobeNode }) {
  const run = node.provider === "make" ? node.card?.lastRun : undefined;
  const tail = run?.at ? ` · last run ${ago(run.at)}` : node.reason === "not-captured" ? " · not captured" : "";
  return (
    <div
      className="pointer-events-none absolute z-[5] max-w-[250px] rounded-row border border-line-strong bg-pill px-[9px] py-1.5 shadow-[var(--shadow-float)]"
      style={{ left: Math.min(hover.x + 14, Math.max(0, hover.w - 250)), top: Math.max(6, hover.y - 40) }}
    >
      <div className="[overflow-wrap:anywhere] text-[13px] font-semibold text-t1">{node.name}</div>
      <div className="whitespace-nowrap font-mono text-[11.5px] text-t2">
        {node.provider} · {statusWord(node)}
        {tail}
      </div>
    </div>
  );
}
