"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert, CircleSlash, HeartPulse, TriangleAlert, Unplug, type LucideIcon } from "lucide-react";
import { useConnections, useWorkflowIndex, type WorkflowIndexEntry } from "@/components/app/ConnectionsProvider";
import { getConnector } from "@/lib/connectors";
import type { Issue, LastRun } from "@/app/lib/api";
import { LastRunChip } from "@/components/shared/RunsPanel";
import { AppPuck } from "@/components/shared/AppPuck";
import { CaptureBadge } from "@/components/shared/CaptureBadge";
import { RowCard, ViewBar, ViewBody, ViewTitle } from "@/components/views/ViewFrame";
import { workflowHref } from "@/lib/portals";
import { useCountUp } from "@/lib/useCountUp";

/*
 * Health = the triage board. Aggregates every workflow's structural issues,
 * failing runs and dead cross-links into one worst-first list; each issue
 * row deep-links to the exact step on that workflow's canvas (?step=).
 */

const TONE: Record<Issue["severity"], { text: string; accent: string; label: string }> = {
  error: { text: "var(--err-text)", accent: "var(--err)", label: "Error" },
  warn: { text: "var(--warn-text)", accent: "var(--warn)", label: "Warning" },
  info: { text: "var(--off-text)", accent: "var(--off)", label: "Info" },
};
const ORDER: Issue["severity"][] = ["error", "warn", "info"];

interface WorkflowHealth {
  entry: WorkflowIndexEntry;
  issues: Issue[];
  errors: number;
  warns: number;
  lastRun?: LastRun;
  runFailing: boolean;
  deadLinks: number;
}

function Stat({ label, value, icon: Icon, delay, danger }: { label: string; value: number; icon: LucideIcon; delay: number; danger?: boolean }) {
  const n = useCountUp(value, delay * 1000);
  return (
    <div className="flex items-center gap-[11px] rounded-card border border-line bg-panel px-3.5 py-3 shadow-[var(--shadow-card)] anim-fade-up" style={{ animationDelay: `${delay}s` }}>
      <span className="inline-flex size-[30px] flex-none items-center justify-center rounded-control border border-line bg-hover" style={{ color: value > 0 ? (danger ? "var(--err-text)" : "var(--warn-text)") : "var(--t2)" }}>
        <Icon aria-hidden="true" className="size-[13px]" />
      </span>
      <span>
        <span className="tabular block text-[18px] font-bold leading-none">{n}</span>
        <span className="mt-[3px] block text-[10.5px] text-t3">{label}</span>
      </span>
    </div>
  );
}

function SeverityChip({ severity, count }: { severity: Issue["severity"]; count: number }) {
  const t = TONE[severity];
  if (count === 0) return null;
  return (
    <span
      className="rounded-full border px-2 py-[2px] text-[11.5px] font-semibold"
      style={{ color: t.text, borderColor: `color-mix(in srgb, ${t.accent} 40%, transparent)`, background: `color-mix(in srgb, ${t.accent} 10%, transparent)` }}
    >
      {count} {t.label.toLowerCase()}
      {count === 1 ? "" : "s"}
    </span>
  );
}

export default function HealthPage() {
  const { connections, loading, linkMap } = useConnections();
  const all = useWorkflowIndex();

  useEffect(() => {
    document.title = "Health — Rippit";
  }, []);

  const accountOf = useMemo(() => new Map(connections.map((c) => [c.id, c.displayName])), [connections]);

  const rows: WorkflowHealth[] = useMemo(() => {
    const cardOf = new Map((linkMap?.workflows ?? []).map((w) => [`${w.source}:${w.refId}`, w]));
    const issuesOf = new Map<string, Issue[]>();
    for (const i of linkMap?.issues ?? []) {
      if (!i.workflowExternalId) continue;
      const key = `${i.provider}:${i.workflowExternalId}`;
      issuesOf.set(key, [...(issuesOf.get(key) ?? []), i]);
    }
    const deadOf = new Map<string, number>();
    for (const l of linkMap?.links ?? []) {
      if (l.status !== "dead") continue;
      const key = `${l.from.source}:${l.from.refId}`;
      deadOf.set(key, (deadOf.get(key) ?? 0) + 1);
    }
    return all.map((entry) => {
      const key = `${entry.provider}:${entry.refId}`;
      const card = cardOf.get(key);
      const issues = (issuesOf.get(key) ?? []).slice().sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
      const errors = card?.issueCounts?.error ?? issues.filter((i) => i.severity === "error").length;
      const warns = card?.issueCounts?.warn ?? issues.filter((i) => i.severity === "warn").length;
      const runFailing = card?.lastRun?.status === "error" || card?.lastRun?.status === "incomplete";
      return { entry, issues, errors, warns, lastRun: card?.lastRun, runFailing, deadLinks: deadOf.get(key) ?? 0 };
    });
  }, [all, linkMap]);

  const unhealthy = useMemo(
    () =>
      rows
        .filter((r) => r.errors + r.warns > 0 || r.runFailing || r.deadLinks > 0)
        .sort((a, b) => b.errors - a.errors || Number(b.runFailing) - Number(a.runFailing) || b.deadLinks - a.deadLinks || b.warns - a.warns || a.entry.name.localeCompare(b.entry.name)),
    [rows]
  );
  const healthyCount = rows.length - unhealthy.length;

  // Workflows Rippit could not read. Deliberately kept out of the breakage
  // counts: a capture failure means the map may be wrong, not that the estate
  // is broken, and conflating the two is how a monitoring product loses trust.
  const captureProblems = useMemo(
    () =>
      (linkMap?.workflows ?? []).filter(
        (w) => w.capture && (w.capture.state === "failed" || w.capture.state === "never-captured")
      ),
    [linkMap]
  );
  const totals = useMemo(
    () =>
      unhealthy.reduce(
        (acc, r) => ({ errors: acc.errors + r.errors, warns: acc.warns + r.warns, failing: acc.failing + (r.runFailing ? 1 : 0), dead: acc.dead + r.deadLinks }),
        { errors: 0, warns: 0, failing: 0, dead: 0 }
      ),
    [unhealthy]
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="Health" meta={loading ? "loading…" : `${unhealthy.length} of ${rows.length} workflows need attention`} />
      <ViewBody width={760}>
        <ViewTitle
          title="Health"
          sub={loading ? "loading workspace…" : rows.length === 0 ? "no workflows synced yet" : `${healthyCount} healthy · ${unhealthy.length} need${unhealthy.length === 1 ? "s" : ""} attention`}
        />
        <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Errors" value={totals.errors} icon={CircleAlert} delay={0} danger />
          <Stat label="Warnings" value={totals.warns} icon={TriangleAlert} delay={0.05} />
          <Stat label="Failing runs" value={totals.failing} icon={HeartPulse} delay={0.1} danger />
          <Stat label="Dead links" value={totals.dead} icon={Unplug} delay={0.15} danger />
        </div>

        {!loading && captureProblems.length > 0 && (
          <RowCard className="mb-2.5">
            <div className="flex items-start gap-2.5 px-3.5 py-3">
              <CircleSlash aria-hidden="true" className="mt-0.5 size-4 flex-none text-warn-text" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-t1">
                  {captureProblems.length} workflow{captureProblems.length === 1 ? "" : "s"} Rippit could not read
                </p>
                <p className="mt-0.5 text-[11.5px] text-t3">
                  This is a gap in what Rippit captured, not a fault in your automations — what is
                  shown for {captureProblems.length === 1 ? "it" : "them"} may be out of date, and
                  breakage checks that depend on the full estate are paused.
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {captureProblems.slice(0, 8).map((w) => (
                    <li key={`${w.source}:${w.refId}`}>
                      <Link
                        href={workflowHref({ source: w.source, refId: w.refId })}
                        className="inline-flex items-center gap-1.5 rounded-control border border-line-strong px-2 py-[3px] text-[11.5px] text-t2 hover:border-t1 hover:text-t1"
                      >
                        {w.name}
                        <CaptureBadge capture={w.capture} compact />
                      </Link>
                    </li>
                  ))}
                  {captureProblems.length > 8 && (
                    <li className="self-center text-[11px] text-t3">+{captureProblems.length - 8} more</li>
                  )}
                </ul>
              </div>
            </div>
          </RowCard>
        )}

        {loading && (
          <RowCard>
            <div role="status" aria-label="Loading health" className="flex flex-col gap-2 p-3">
              {[0, 1, 2].map((i) => (
                <div key={i} aria-hidden="true" className="h-[38px] animate-pulse rounded-row bg-hover motion-reduce:animate-none" />
              ))}
            </div>
          </RowCard>
        )}

        {!loading && unhealthy.length === 0 && (
          <RowCard>
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <CheckCircle2 aria-hidden="true" className="size-6" style={{ color: "var(--ok)" }} />
              <p className="text-[13px] font-semibold text-t1">{rows.length === 0 ? "Nothing to check yet" : "Everything is healthy"}</p>
              <p className="text-[12px] text-t3">
                {rows.length === 0 ? "Connect a platform to start monitoring workflow health." : "No structural issues, failing runs or dead links across your workflows."}
              </p>
            </div>
          </RowCard>
        )}

        {!loading &&
          unhealthy.map((r, ri) => {
            const connector = getConnector(r.entry.provider);
            const folder = r.entry.groupPath.length ? r.entry.groupPath[r.entry.groupPath.length - 1] : null;
            const href = workflowHref({ source: r.entry.provider, refId: r.entry.refId });
            return (
              <RowCard key={`${r.entry.provider}:${r.entry.refId}`} className="mb-2.5" delay={0.18 + Math.min(ri, 8) * 0.04}>
                <Link href={href} className="group flex w-full items-center gap-2.5 border-b border-line2 px-3.5 py-2.5 transition-[background] duration-[var(--dur-fast)] hover:bg-hover">
                  <span className="transition-transform duration-[var(--dur-fast)] group-hover:-translate-y-[2px]">
                    <AppPuck app={r.entry.provider} size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block [overflow-wrap:anywhere] text-[12.5px] font-semibold text-t1">{r.entry.name}</span>
                    <span className="tabular mt-[1px] block [overflow-wrap:anywhere] font-mono text-[9.5px] text-t3">
                      {connector.shortLabel}
                      {accountOf.get(r.entry.connectionId) ? ` · ${accountOf.get(r.entry.connectionId)}` : ""}
                      {folder ? ` · ${folder}` : ""}
                    </span>
                  </span>
                  <SeverityChip severity="error" count={r.errors} />
                  <SeverityChip severity="warn" count={r.warns} />
                  {r.deadLinks > 0 && <SeverityChip severity="error" count={r.deadLinks} />}
                  {r.lastRun && r.runFailing && <LastRunChip status={r.lastRun.status} at={r.lastRun.at} />}
                  <ArrowRight aria-hidden="true" className="size-3.5 flex-none text-t3 transition-colors group-hover:text-t1" />
                </Link>
                {r.issues.map((i, idx) => {
                  const t = TONE[i.severity];
                  const target = i.nodeId != null ? `${href}?step=${encodeURIComponent(String(i.nodeId))}` : href;
                  return (
                    <Link
                      key={`${i.code}:${String(i.nodeId)}:${idx}`}
                      href={target}
                      className="group/issue flex w-full items-start gap-2.5 border-b border-line2 px-3.5 py-2 transition-[background] duration-[var(--dur-fast)] last:border-b-0 hover:bg-hover"
                    >
                      <span aria-hidden="true" className="mt-[5px] size-[8px] flex-none rounded-full" style={{ background: t.accent }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide" style={{ color: t.text }}>
                          {t.label} · {i.code}
                        </span>
                        <span className="mt-[1px] block text-[12.5px] text-t2">{i.message}</span>
                      </span>
                      {i.nodeId != null && (
                        <span className="mt-[3px] inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-t3 transition-colors group-hover/issue:text-t1">
                          go to step <ArrowRight aria-hidden="true" className="size-3" />
                        </span>
                      )}
                    </Link>
                  );
                })}
                {r.issues.length === 0 && (r.runFailing || r.deadLinks > 0) && (
                  <p className="px-3.5 py-2 text-[12px] text-t3">
                    {[r.runFailing ? "last run failed" : null, r.deadLinks > 0 ? `${r.deadLinks} dead cross-link${r.deadLinks === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")} — open the workflow for details.
                  </p>
                )}
              </RowCard>
            );
          })}

        {!loading && unhealthy.length > 0 && healthyCount > 0 && (
          <p className="mt-1 flex items-center gap-1.5 px-1 text-[12px] text-t3">
            <CheckCircle2 aria-hidden="true" className="size-3.5" style={{ color: "var(--ok)" }} />
            {healthyCount} other workflow{healthyCount === 1 ? " is" : "s are"} healthy.
          </p>
        )}
      </ViewBody>
    </div>
  );
}
