import type { Evidence } from "@/app/lib/api";

/*
 * The one visual rule for evidence: configured nodes are solid cards in the
 * chrome palette; not-captured nodes are dashed outlines in muted text.
 * Never a status colour — "not captured" is Rippit's gap, not the estate's.
 */
export function evidenceClasses(evidence: Evidence): string {
  return evidence === "configured"
    ? "border-line bg-pill text-t1"
    : "border-dashed border-line-strong bg-transparent text-t3";
}

export function selectionRing(selected: boolean): string {
  return selected ? "0 0 0 2.5px var(--ringc)" : "0 1px 0 var(--shade)";
}
