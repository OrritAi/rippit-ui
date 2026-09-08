"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LinkMap } from "@/app/lib/api";
import { linksFor, workflowHref, WorkflowRef } from "@/lib/portals";
import { CONNECTORS } from "@/lib/connectors";
import { AppPuck } from "@/components/shared/AppPuck";

const CAP = 6;

/*
 * Row of connected workflows under the action bar — the same destinations
 * as the on-canvas portal chips, reachable even when a portal is off-screen.
 * Warn accent = linked, err accent = the link is broken. Capped at 6 with a
 * "+N" expander so a hub workflow never pushes the canvas down.
 */
export function ConnectedChips({ linkMap, self, className = "" }: { linkMap: LinkMap | null; self: WorkflowRef; className?: string }) {
  const [all, setAll] = useState(false);
  const targets = useMemo(() => {
    if (!linkMap) return [];
    const seen = new Map<string, { ref: WorkflowRef; name: string; dead: boolean; direction: "in" | "out" }>();
    for (const link of linksFor(linkMap, self)) {
      const outgoing = link.from.source === self.source && link.from.refId === self.refId;
      const other = outgoing ? link.to : link.from;
      const key = `${other.source}:${other.refId}`;
      const name = linkMap.workflows.find((w) => w.source === other.source && w.refId === other.refId)?.name || key;
      const prev = seen.get(key);
      seen.set(key, { ref: { source: other.source, refId: other.refId }, name, dead: prev?.dead || link.status === "dead", direction: outgoing ? "out" : "in" });
    }
    return [...seen.values()].sort((a, b) => Number(b.dead) - Number(a.dead));
  }, [linkMap, self]);

  if (targets.length === 0) return null;
  const shown = all ? targets : targets.slice(0, CAP);

  return (
    <div className={`flex flex-none flex-wrap items-center gap-2 border-b border-line2 px-3 py-2 ${className}`}>
      <span className="text-[11px] font-semibold text-t3">Connected ({targets.length})</span>
      {shown.map((t) => {
        const accent = t.dead ? "var(--err)" : "var(--warn)";
        const conn = CONNECTORS[t.ref.source];
        return (
          <Link
            key={`${t.ref.source}:${t.ref.refId}`}
            href={workflowHref(t.ref)}
            aria-label={`${t.direction === "out" ? "Calls" : "Called by"} ${t.name}${t.dead ? " (link broken)" : ""} — open workflow`}
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold transition-[border-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:-translate-y-px"
            style={{
              borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`,
              background: `color-mix(in srgb, ${accent} 9%, var(--pill))`,
              color: t.dead ? "var(--err-text)" : "var(--warn-text)",
            }}
          >
            <AppPuck app={conn.id} color={conn.brandColor} size={15} />
            <span className="text-t3">{conn.shortLabel} :</span>
            <span className="max-w-[180px] truncate">{t.name}</span>
            <span aria-hidden="true">{t.direction === "out" ? "→" : "←"}</span>
            {t.dead && <span>broken</span>}
          </Link>
        );
      })}
      {targets.length > CAP && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="rounded-full border border-line px-2 py-[3px] text-[11px] font-semibold text-t3 transition-colors hover:border-line-strong hover:text-t1"
        >
          {all ? "show fewer" : `+${targets.length - CAP} more`}
        </button>
      )}
    </div>
  );
}
