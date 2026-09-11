"use client";

import type { AdminOrgRow, AdminOrgStatus } from "@/app/lib/api";
import { AppPuck } from "@/components/shared/AppPuck";
import { Card, CardHeader } from "@/components/shared/Card";
import { StatusPill } from "@/components/shared/StatusPill";
import { ago } from "@/lib/time";

const GRID = "minmax(200px,1.5fr) 76px 110px 90px 104px 96px";

export function statusPill(status: AdminOrgStatus): { label: string; tone: "ok" | "err" | "muted" } {
  if (status === "suspended") return { label: "Suspended", tone: "muted" };
  if (status === "incident") return { label: "Incident", tone: "err" };
  return { label: "Active", tone: "ok" };
}

export function ownerOf(o: AdminOrgRow): string {
  return o.ownerEmail || o.owners?.[0]?.name || "—";
}

/** Every organization, one button-row each; the selected one stays highlighted. */
export function OrgTable({
  rows,
  selectedId,
  onSelect,
  loading,
}: {
  rows: AdminOrgRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader title="Organizations" meta={rows.length} />
      <div
        className="grid items-center gap-x-3 border-t border-line2 px-4 py-[7px] font-mono text-[10.5px] text-t3"
        style={{ gridTemplateColumns: GRID }}
      >
        <div>organization</div>
        <div className="text-right">members</div>
        <div>platforms</div>
        <div className="text-right">workflows</div>
        <div>status</div>
        <div className="text-right">last activity</div>
      </div>
      {rows.map((o) => {
        const selected = o.id === selectedId;
        const pill = statusPill(o.status);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onSelect(selected ? null : o.id)}
            aria-pressed={selected}
            aria-label={`${o.name} — ${pill.label}`}
            className={`grid w-full cursor-pointer items-center gap-x-3 border-t border-line2 px-4 py-2.5 text-left transition-colors duration-[var(--dur-fast)] hover:bg-hover ${
              selected ? "bg-hover" : ""
            }`}
            style={{ gridTemplateColumns: GRID }}
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{o.name}</span>
              <span className="block truncate font-mono text-[10.5px] text-t3">{ownerOf(o)}</span>
            </span>
            <span className="tabular text-right font-mono text-[12px]">{o.memberCount}</span>
            <span className="flex items-center gap-1">
              {o.platforms?.length ? (
                o.platforms.map((p) => <AppPuck key={p} app={p} size={20} title={p} />)
              ) : (
                <span className="font-mono text-[10.5px] text-t3">—</span>
              )}
            </span>
            <span className="tabular text-right font-mono text-[12px]">{o.workflowCount ?? "—"}</span>
            <span>
              <StatusPill pill={pill} />
            </span>
            <span className="text-right font-mono text-[10.5px] text-t3">{ago(o.lastActivityAt ?? o.lastSyncAt)}</span>
          </button>
        );
      })}
      {rows.length === 0 && (
        <p className="border-t border-line2 px-4 py-5 text-[12.5px] text-t3">
          {loading ? "loading…" : "No organizations match — clear the search or filter."}
        </p>
      )}
    </Card>
  );
}
