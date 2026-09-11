"use client";

import Link from "next/link";
import { Route } from "lucide-react";
import type { RecordRun } from "@/app/lib/api";
import { AppPuck } from "@/components/shared/AppPuck";
import { RunStatusChip } from "@/components/shared/RunsPanel";
import { RowCard } from "@/components/views/ViewFrame";
import { CONNECTORS } from "@/lib/connectors";
import { workflowHref } from "@/lib/portals";

/*
 * Record timeline — every run that carried one record, newest first,
 * grouped by day: time · workflow · status · "Replay on map" (the workflow
 * page with `?run=`, which replays the execution and grays what it did not
 * touch). Rows say how the record was matched (webhook payload or run name)
 * and never show the identifier itself beyond the page title — the index
 * holds hashes only.
 */

export function runHref(run: RecordRun): string {
  return `${workflowHref({ source: run.provider, refId: run.workflowExternalId })}?run=${encodeURIComponent(run.executionId)}`;
}

const SOURCE_LABEL: Record<string, string> = {
  hook_log: "matched in the webhook payload",
  run_name: "matched in the run name",
  run_name_live: "matched in the run name (live)",
};
const KIND_LABEL: Record<string, string> = {
  email: "email",
  phone: "phone number",
  contact_id: "contact id",
  id: "id",
};

function dayKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(iso: string | null): string {
  if (!iso) return "Date unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date unknown";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function timeLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

interface DayGroup {
  key: string;
  label: string;
  runs: RecordRun[];
}

export function groupByDay(runs: RecordRun[]): DayGroup[] {
  const sorted = [...runs].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  const groups: DayGroup[] = [];
  for (const r of sorted) {
    const key = dayKey(r.startedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.runs.push(r);
    else groups.push({ key, label: dayLabel(r.startedAt), runs: [r] });
  }
  return groups;
}

export function RecordTimeline({ runs }: { runs: RecordRun[] }) {
  const groups = groupByDay(runs);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, gi) => (
        <section key={g.key || `unknown-${gi}`} aria-label={g.label}>
          <h3 className="tabular mb-1.5 px-1 font-mono text-[10.5px] text-t3">
            {g.label} · {g.runs.length} run{g.runs.length === 1 ? "" : "s"}
          </h3>
          <RowCard delay={Math.min(gi, 6) * 0.04}>
            {g.runs.map((r) => {
              const connector = CONNECTORS[r.provider];
              const name = r.workflowName || `${connector?.shortLabel ?? r.provider} ${r.workflowExternalId}`;
              const meta = [
                connector?.shortLabel ?? r.provider,
                r.connectionLabel,
                `run ${r.executionId}`,
                `${KIND_LABEL[r.kind] ?? r.kind} ${SOURCE_LABEL[r.source] ?? `matched via ${r.source}`}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={`${r.provider}:${r.workflowExternalId}:${r.executionId}`} className="flex w-full flex-wrap items-center gap-x-[11px] gap-y-1.5 border-b border-line2 px-3.5 py-[11px] last:border-b-0">
                  <span className="tabular w-[46px] flex-none font-mono text-[11px] text-t3" title={r.startedAt ? new Date(r.startedAt).toLocaleString() : undefined}>
                    {timeLabel(r.startedAt)}
                  </span>
                  <AppPuck app={r.provider} size={24} />
                  <span className="min-w-0 flex-1 basis-[200px]">
                    <Link href={workflowHref({ source: r.provider, refId: r.workflowExternalId })} className="block text-[13px] font-semibold text-t1 underline-offset-4 [overflow-wrap:anywhere] hover:underline">
                      {name}
                    </Link>
                    <span className="tabular mt-[1px] block font-mono text-[9.5px] text-t3 [overflow-wrap:anywhere]">{meta}</span>
                  </span>
                  <RunStatusChip status={r.status} />
                  <Link
                    href={runHref(r)}
                    title="Replay this run on the workflow map — steps it did not touch gray out"
                    className="inline-flex flex-none items-center gap-1.5 rounded-control border border-line px-2 py-[3px] text-[11.5px] font-semibold text-t2 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1"
                  >
                    <Route aria-hidden="true" className="size-3" />
                    Replay on map
                  </Link>
                </div>
              );
            })}
          </RowCard>
        </section>
      ))}
    </div>
  );
}
