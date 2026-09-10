"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Execution, ExecutionsResponse, fetchExecutions, NodeId } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";

/*
 * Last-N runtime executions of a workflow (Make today). Rows: status dot,
 * when, duration, ops, error; a failing module is a link that selects that
 * node on the canvas. Polls once more while the API reports `refreshing`.
 */

const TONE: Record<Execution["status"], { accent: string; text: string; label: string }> = {
  success: { accent: "var(--ok)", text: "var(--ok-text)", label: "ok" },
  warning: { accent: "var(--warn)", text: "var(--warn-text)", label: "warning" },
  error: { accent: "var(--err)", text: "var(--err-text)", label: "failed" },
  incomplete: { accent: "var(--warn)", text: "var(--warn-text)", label: "incomplete" },
  unknown: { accent: "var(--off)", text: "var(--off-text)", label: "unknown" },
};

export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function LastRunChip({ status, at }: { status: Execution["status"]; at: string | null }) {
  const t = TONE[status] ?? TONE.unknown;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-[10.5px] font-semibold"
      style={{
        color: t.text,
        borderColor: `color-mix(in srgb, ${t.accent} 40%, transparent)`,
        background: `color-mix(in srgb, ${t.accent} 10%, transparent)`,
      }}
      title={at ? new Date(at).toLocaleString() : undefined}
    >
      <span aria-hidden="true" className="size-[5px] rounded-full" style={{ background: t.accent }} />
      last run {t.label} · {relativeTime(at)}
    </span>
  );
}

export function RunsBody({
  provider,
  externalId,
  onSelectNode,
  onData,
}: {
  provider: ProviderId;
  externalId: string;
  onSelectNode?: (nodeId: NodeId) => void;
  onData?: (data: ExecutionsResponse) => void;
}) {
  const [data, setData] = useState<ExecutionsResponse | null>(null);
  const [error, setError] = useState("");
  const [gen, setGen] = useState(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    fetchExecutions(provider, externalId, gen > 0)
      .then((d) => {
        if (!live) return;
        setData(d);
        onData?.(d);
        if (d.refreshing) {
          // the API refreshes in the background; read once more shortly
          timer = setTimeout(() => {
            fetchExecutions(provider, externalId)
              .then((d2) => {
                if (!live) return;
                setData(d2);
                onData?.(d2);
              })
              .catch(() => {});
          }, 6000);
        }
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, externalId, gen]);

  const failures = data?.executions.filter((e) => e.status === "error" || e.status === "incomplete").length ?? 0;

  return (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-line2 px-3.5 py-1.5 text-[11.5px] text-t3">
        {data ? <span>{data.executions.length} runs · {failures} failed</span> : <span>Loading…</span>}
        <button
          type="button"
          onClick={() => setGen((g) => g + 1)}
          aria-label="Refresh runs from the platform"
          className="ml-auto flex size-6 items-center justify-center rounded-control border border-line text-t3 hover:text-t1"
        >
          <RefreshCw aria-hidden="true" className={`size-3 ${data?.refreshing ? "spin" : ""}`} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {error && (
          <p role="alert" className="px-1.5 text-[12px] text-err-text">
            {error}
          </p>
        )}
        {!data && !error && <p className="px-1.5 text-[12px] text-t3">Loading…</p>}
        {data && !data.supported && (
          <p className="px-1.5 text-[12px] text-t3">{data.reason ?? "Runtime status not available for this platform yet."}</p>
        )}
        {data && data.supported && data.executions.length === 0 && (
          <p className="px-1.5 text-[12px] text-t3">
            {data.refreshing ? "Fetching runs from the platform…" : "No runs in the platform's retained history."}
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {data?.executions.map((e) => {
            const t = TONE[e.status] ?? TONE.unknown;
            return (
              <li
                key={e.executionId}
                className="rounded-control border border-line2 bg-panel px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-[7px] rounded-full" style={{ background: t.accent, boxShadow: `0 0 6px ${t.accent}` }} />
                  <span className="text-[12px] font-semibold" style={{ color: t.text }}>
                    {t.label}
                  </span>
                  <span className="text-[11.5px] text-t3" title={e.startedAt ? new Date(e.startedAt).toLocaleString() : undefined}>
                    {relativeTime(e.startedAt)}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-t3">
                    {e.durationMs != null ? `${e.durationMs} ms` : ""}
                    {e.operations != null ? ` · ${e.operations} ops` : ""}
                  </span>
                </div>
                {(e.errorMessage || e.causeModuleId) && (
                  <div className="mt-1 flex items-start gap-2 text-[11.5px]">
                    <span className="min-w-0 flex-1 break-words text-t2">
                      {e.errorName && <span className="font-mono text-t3">{e.errorName}: </span>}
                      {e.errorMessage}
                    </span>
                    {e.causeModuleId && onSelectNode && (
                      <button
                        type="button"
                        onClick={() => onSelectNode(e.causeModuleId!)}
                        className="shrink-0 rounded-full border border-line px-2 py-[1px] font-mono text-[10.5px] text-t2 hover:text-t1"
                      >
                        module {e.causeModuleId}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="flex-none border-t border-line2 px-3.5 py-1.5 text-[11px] text-t3">
        {data?.fetchedAt ? `As of ${relativeTime(data.fetchedAt)} · status, timing and failing step only — never run data` : "Status, timing and failing step only — never run data"}
      </p>
    </>
  );
}
