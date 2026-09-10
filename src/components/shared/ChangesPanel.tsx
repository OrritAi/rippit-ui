"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { ackVersion, fetchWorkflowChanges, NodeId, WorkflowChange, WorkflowChanges } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";
import { relativeTime } from "@/components/shared/RunsPanel";

/*
 * What changed in this workflow — two buckets only: New (since you last
 * looked) and Earlier (timestamped). Wordy provenance lives in tooltips,
 * not copy. "Mark reviewed" acks every version that still has new rows.
 */

const KIND_TONE: Record<string, { accent: string; label: string }> = {
  "node-added": { accent: "var(--ok)", label: "added" },
  "node-removed": { accent: "var(--err)", label: "removed" },
  "node-changed": { accent: "var(--warn)", label: "changed" },
  "node-reordered": { accent: "var(--off)", label: "moved" },
  "edge-added": { accent: "var(--ok)", label: "connected" },
  "edge-removed": { accent: "var(--err)", label: "disconnected" },
  "ref-added": { accent: "var(--ok)", label: "new reference" },
  "ref-removed": { accent: "var(--warn)", label: "reference dropped" },
  renamed: { accent: "var(--off)", label: "renamed" },
  "status-changed": { accent: "var(--warn)", label: "status" },
};

/** "Changed Form Submitted (summary, configuration)" → "Form Submitted" —
 * the badge already says the verb, the tooltip carries the fields. */
function compactSummary(c: WorkflowChange, label: string): string {
  let s = c.summary.trim();
  if (s.toLowerCase().startsWith(label.toLowerCase() + " ")) s = s.slice(label.length + 1);
  s = s.replace(/\s*\([^)]*\)\s*$/, "");
  return s || c.summary;
}

/** Primitive before → after pairs worth showing (hashes and arrays are noise). */
function diffPairs(c: WorkflowChange): [string, string, string][] {
  const primitive = (v: unknown) => ["string", "number", "boolean"].includes(typeof v);
  const keys = new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})]);
  const out: [string, string, string][] = [];
  for (const k of keys) {
    if (k.endsWith("_hash") || k === "fields" || k === "nodeIds") continue;
    const b = c.before?.[k];
    const a = c.after?.[k];
    if (!primitive(b) && !primitive(a)) continue;
    if (b === a) continue;
    out.push([k, primitive(b) ? String(b) : "—", primitive(a) ? String(a) : "—"]);
  }
  return out.slice(0, 6);
}

export function ChangeRow({ c, onSelectNode }: { c: WorkflowChange; onSelectNode?: (id: NodeId) => void }) {
  const [open, setOpen] = useState(false);
  const t = KIND_TONE[c.kind] ?? { accent: "var(--off)", label: c.kind };
  const fields =
    c.kind === "node-changed" && Array.isArray(c.after?.fields)
      ? (c.after!.fields as string[]).map((f) => (f === "config_hash" ? "configuration" : f)).join(", ")
      : null;
  const pairs = open ? diffPairs(c) : [];
  return (
    <li className={`rounded-control border border-line2 bg-panel ${c.unseen ? "" : "opacity-80"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-[10px] flex-none text-t3 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] ${open ? "rotate-90" : ""}`}
        />
        <span aria-hidden="true" className="size-[7px] flex-none rounded-full" style={{ background: t.accent, boxShadow: `0 0 6px ${t.accent}` }} />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-t3">{t.label}</span>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[12.5px] text-t1">{compactSummary(c, t.label)}</span>
        <span className="flex-none text-[11px] text-t3" title={new Date(c.detectedAt).toLocaleString()}>
          {relativeTime(c.detectedAt)}
        </span>
      </button>
      {open && (
        <div className="border-t border-line2 px-2.5 py-2">
          <p className="text-[12.5px] text-t1">{c.summary}</p>
          <dl className="mt-1.5 flex flex-col gap-[3px] text-[11.5px]">
            {fields && (
              <div className="flex gap-1.5">
                <dt className="flex-none text-t3">Fields</dt>
                <dd className="text-t2">{fields}</dd>
              </div>
            )}
            {pairs.map(([k, b, a]) => (
              <div key={k} className="flex min-w-0 gap-1.5">
                <dt className="flex-none text-t3">{k}</dt>
                <dd className="tabular min-w-0 [overflow-wrap:anywhere] font-mono text-[10.5px] text-t2">
                  {b} → {a}
                </dd>
              </div>
            ))}
            {c.authorHint?.name && (
              <div className="flex gap-1.5">
                <dt className="flex-none text-t3">Edited by</dt>
                <dd className="text-t2">
                  {c.authorHint.name}
                  {c.authorHint.at ? ` · ${relativeTime(c.authorHint.at)}` : ""}
                </dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt className="flex-none text-t3">Detected</dt>
              <dd className="text-t2">
                {new Date(c.detectedAt).toLocaleString()} · sync #{c.version}
              </dd>
            </div>
          </dl>
          {c.nodeId && onSelectNode && (
            <button
              type="button"
              onClick={() => onSelectNode(c.nodeId!)}
              className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded-full border border-line px-2 py-[2px] text-[11px] font-semibold text-t2 transition-colors hover:text-t1"
              title={`Step ${c.nodeId}`}
            >
              Go to step <ArrowRight aria-hidden="true" className="size-[10px]" />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function ChangesBody({
  provider,
  externalId,
  onSelectNode,
  onData,
  reloadToken = 0,
}: {
  provider: ProviderId;
  externalId: string;
  onSelectNode?: (nodeId: NodeId) => void;
  onData?: (data: WorkflowChanges) => void;
  /** Bump to refetch (e.g. after a manual sync). */
  reloadToken?: number;
}) {
  const [data, setData] = useState<WorkflowChanges | null>(null);
  const [error, setError] = useState("");
  const [gen, setGen] = useState(0);

  useEffect(() => {
    let live = true;
    fetchWorkflowChanges(provider, externalId)
      .then((d) => {
        if (!live) return;
        const lastSeen = d.lastSeenAt;
        const marked = { ...d, changes: d.changes.map((c) => ({ ...c, unseen: !lastSeen || c.detectedAt > lastSeen })) };
        setData(marked);
        onData?.(marked);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, externalId, gen, reloadToken]);

  const fresh = (data?.changes ?? []).filter((c) => c.unseen);
  const earlier = (data?.changes ?? []).filter((c) => !c.unseen);
  const reviewedBy = [...new Set((data?.versions ?? []).flatMap((v) => (v.acks ?? []).map((a) => a.name)))];
  const markAllReviewed = () => {
    const unseenVersions = [...new Set(fresh.map((c) => c.version))];
    Promise.all(unseenVersions.map((v) => ackVersion(provider, externalId, v).catch(() => {}))).then(() => setGen((g) => g + 1));
  };

  return (
    <>
      {data && (
        <p
          className="flex-none border-b border-line2 px-3.5 py-1.5 text-[11.5px] text-t3"
          title={data.lastSeenAt ? `You last looked ${relativeTime(data.lastSeenAt)}` : undefined}
        >
          {data.changes.length} change{data.changes.length === 1 ? "" : "s"}
          {data.unseen > 0 ? ` · ${data.unseen} new` : ""}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {error && <p role="alert" className="px-1.5 text-[12px] text-err-text">{error}</p>}
        {!data && !error && <p className="px-1.5 text-[12px] text-t3">Loading…</p>}
        {data && data.changes.length === 0 && (
          <p className="px-1.5 text-[12px] text-t3" title="Rippit snapshots this workflow on every sync and lists what differs from the previous snapshot.">
            No changes recorded yet.
          </p>
        )}
        {fresh.length > 0 && (
          <section className="mb-3">
            <h3 className="mb-1 flex items-center gap-2 px-1 text-[11px] font-semibold text-chg-text">
              <span>New · {fresh.length}</span>
              <button
                type="button"
                onClick={markAllReviewed}
                title="Mark every new change as reviewed by you"
                className="ml-auto cursor-pointer rounded-full border border-line px-2 py-[1px] text-[10.5px] font-semibold text-t2 hover:text-t1"
              >
                Mark reviewed
              </button>
            </h3>
            <ul className="flex flex-col gap-1">
              {fresh.map((c) => (
                <ChangeRow key={c.id} c={c} onSelectNode={onSelectNode} />
              ))}
            </ul>
          </section>
        )}
        {earlier.length > 0 && (
          <section className="mb-3">
            <h3
              className="mb-1 px-1 text-[11px] font-semibold text-t3"
              title={reviewedBy.length > 0 ? `Reviewed by ${reviewedBy.join(", ")}` : undefined}
            >
              Earlier
            </h3>
            <ul className="flex flex-col gap-1">
              {earlier.map((c) => (
                <ChangeRow key={c.id} c={c} onSelectNode={onSelectNode} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
