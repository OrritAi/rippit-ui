"use client";

import { useMemo } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { Issue, LastRun, ModuleInfo, NodeId } from "@/app/lib/api";
import { LastRunChip } from "@/components/shared/RunsPanel";

/*
 * Health dock: every structural + runtime issue on this workflow in one
 * list, worst first. Rows with a known step navigate the canvas to it
 * (select + center); workflow-level issues render as plain rows.
 */

const TONE: Record<Issue["severity"], { text: string; accent: string; label: string }> = {
  error: { text: "var(--err-text)", accent: "var(--err)", label: "Error" },
  warn: { text: "var(--warn-text)", accent: "var(--warn)", label: "Warning" },
  info: { text: "var(--off-text)", accent: "var(--off)", label: "Info" },
};

const ORDER: Issue["severity"][] = ["error", "warn", "info"];

export function HealthBody({
  issues,
  modules,
  lastRun,
  onSelectNode,
}: {
  issues: Issue[];
  modules: ModuleInfo[];
  lastRun?: LastRun | null;
  onSelectNode: (id: NodeId) => void;
}) {
  const byNode = useMemo(() => new Map(modules.map((m) => [String(m.id), m])), [modules]);
  const counts = useMemo(
    () => issues.reduce((acc, i) => ({ ...acc, [i.severity]: acc[i.severity] + 1 }), { error: 0, warn: 0, info: 0 }),
    [issues]
  );
  const sorted = useMemo(
    () => [...issues].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)),
    [issues]
  );
  const clear = issues.length === 0 && lastRun?.status !== "error" && lastRun?.status !== "incomplete";

  return (
    <div className="flex flex-col gap-3 px-3.5 py-3">
      {/* summary strip */}
      <div className="flex flex-wrap items-center gap-1.5">
        {clear ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ok-text">
            <CheckCircle2 aria-hidden="true" className="size-4" style={{ color: "var(--ok)" }} />
            All clear — no issues detected
          </span>
        ) : (
          <>
            {ORDER.filter((s) => counts[s] > 0).map((s) => (
              <span
                key={s}
                className="rounded-full border px-2 py-[2px] text-[11.5px] font-semibold"
                style={{
                  color: TONE[s].text,
                  borderColor: `color-mix(in srgb, ${TONE[s].accent} 40%, transparent)`,
                  background: `color-mix(in srgb, ${TONE[s].accent} 10%, transparent)`,
                }}
              >
                {counts[s]} {TONE[s].label.toLowerCase()}
                {counts[s] === 1 ? "" : "s"}
              </span>
            ))}
            {lastRun && (lastRun.status === "error" || lastRun.status === "incomplete") && (
              <LastRunChip status={lastRun.status} at={lastRun.at} />
            )}
          </>
        )}
      </div>

      {sorted.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sorted.map((i, idx) => {
            const t = TONE[i.severity];
            const node = i.nodeId != null ? byNode.get(String(i.nodeId)) : undefined;
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: t.text }}>
                    {t.label} · {i.code}
                  </span>
                  {node && (
                    <span className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-t3 transition-colors group-hover/hrow:text-t1">
                      go to step <ArrowRight aria-hidden="true" className="size-3" />
                    </span>
                  )}
                </div>
                {node && (
                  <p className="mt-1 [overflow-wrap:anywhere] text-[12.5px] font-semibold text-t1">
                    {node.ordinal ? `${node.ordinal} · ` : ""}
                    {node.label || node.module}
                  </p>
                )}
                <p className="mt-0.5 text-[13px] text-t2">{i.message}</p>
              </>
            );
            const style = {
              borderColor: `color-mix(in srgb, ${t.accent} 35%, transparent)`,
              background: `color-mix(in srgb, ${t.accent} 7%, transparent)`,
            };
            return (
              <li key={`${i.code}:${String(i.nodeId)}:${idx}`}>
                {node ? (
                  <button
                    type="button"
                    onClick={() => onSelectNode(node.id)}
                    aria-label={`${t.label}: ${i.message} — go to step ${node.label || node.module}`}
                    className="group/hrow block w-full cursor-pointer rounded-card border px-3 py-2 text-left transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:-translate-y-[1px]"
                    style={style}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="rounded-card border px-3 py-2" style={style}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
