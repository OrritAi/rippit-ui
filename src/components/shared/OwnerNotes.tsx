"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, UserCircle2 } from "lucide-react";
import { fetchMembers, fetchWorkflowMeta, putWorkflowMeta, setWatch, WorkspaceMember, WorkflowMeta } from "@/app/lib/api";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import type { ProviderId } from "@/lib/connectors/types";

/*
 * Owner chip (+ picker), watch bell, and the pinned Notes panel for one
 * workflow. State lives here; the workflow page only places the pieces.
 */

export function useWorkflowMeta(provider: ProviderId, externalId: string) {
  const [meta, setMeta] = useState<WorkflowMeta | null>(null);
  const [gen, setGen] = useState(0);
  useEffect(() => {
    let live = true;
    fetchWorkflowMeta(provider, externalId)
      .then((m) => live && setMeta(m))
      .catch(() => live && setMeta({ ownerUserId: null, ownerName: null, notes: null, updatedAt: null, watching: false }));
    return () => {
      live = false;
    };
  }, [provider, externalId, gen]);
  return { meta, setMeta, refresh: () => setGen((g) => g + 1) };
}

export function OwnerChip({
  provider,
  externalId,
  meta,
  onChange,
}: {
  provider: ProviderId;
  externalId: string;
  meta: WorkflowMeta | null;
  onChange: (m: WorkflowMeta) => void;
}) {
  const { current } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !current) return;
    fetchMembers(current.id).then((d) => setMembers(d.members)).catch(() => {});
    const onDoc = (e: MouseEvent) => rootRef.current && !rootRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, current]);

  const pick = async (userId: string | null) => {
    try {
      const m = await putWorkflowMeta(provider, externalId, userId ? { ownerUserId: userId } : { clearOwner: true });
      onChange({ ...(meta ?? { notes: null, updatedAt: null }), ...m, watching: meta?.watching });
    } finally {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-[3px] text-[11.5px] font-semibold text-t2 transition-colors hover:border-t1 hover:text-t1"
        title="Owner — who is accountable for this workflow"
      >
        <UserCircle2 aria-hidden="true" className="size-3" />
        {meta?.ownerName ? meta.ownerName : "No owner"}
      </button>
      {open && (
        <div role="dialog" aria-label="Set owner" className="absolute left-0 top-full z-20 mt-1.5 w-[220px] rounded-card border border-line bg-panel p-1.5 shadow-[0_12px_30px_var(--ambient)]">
          <ul className="flex max-h-[220px] flex-col overflow-auto">
            {members.map((m) => (
              <li key={m.user_id}>
                <button
                  type="button"
                  onClick={() => pick(m.user_id)}
                  className={`flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-[12.5px] hover:bg-hover ${meta?.ownerUserId === m.user_id ? "text-t1" : "text-t2"}`}
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">{m.display_name || m.email}</span>
                  {meta?.ownerUserId === m.user_id && <span className="ml-auto text-[10.5px] text-t3">owner</span>}
                </button>
              </li>
            ))}
            {meta?.ownerUserId && (
              <li>
                <button type="button" onClick={() => pick(null)} className="mt-1 w-full rounded-control border-t border-line2 px-2 py-1 text-left text-[12px] text-t3 hover:text-t1">
                  Clear owner
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export function WatchToggle({
  provider,
  externalId,
  watching,
  onChange,
}: {
  provider: ProviderId;
  externalId: string;
  watching: boolean;
  onChange: (w: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={watching}
      onClick={() => setWatch(`wf:${provider}:${externalId}`, !watching).then((r) => onChange(r.watching)).catch(() => {})}
      title={watching ? "Watching — you get notified about changes, comments and failures" : "Watch this workflow"}
      className={`inline-flex size-[26px] shrink-0 items-center justify-center rounded-full border transition-colors ${
        watching ? "border-t1 text-t1" : "border-line-strong text-t3 hover:border-t1 hover:text-t1"
      }`}
    >
      {watching ? <Bell aria-hidden="true" className="size-3" /> : <BellOff aria-hidden="true" className="size-3" />}
      <span className="sr-only">{watching ? "Stop watching" : "Watch"}</span>
    </button>
  );
}

export function NotesBody({
  provider,
  externalId,
  meta,
  onChange,
}: {
  provider: ProviderId;
  externalId: string;
  meta: WorkflowMeta | null;
  onChange: (m: WorkflowMeta) => void;
}) {
  const [draft, setDraft] = useState(meta?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = draft !== (meta?.notes ?? "");
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"What this workflow is for, who to call, what to check first when it breaks…"}
          className="min-h-0 flex-1 resize-none rounded-control border border-line bg-panel px-3 py-2 font-mono text-[12.5px] leading-[1.6] text-t1 placeholder:text-t3"
        />
        <div className="flex items-center justify-between text-[11px] text-t3">
          <span>{meta?.updatedAt ? `Updated ${new Date(meta.updatedAt).toLocaleString()}` : "Not written yet"}</span>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              try {
                const m = await putWorkflowMeta(provider, externalId, { notes: draft });
                onChange({ ...(meta ?? { ownerUserId: null, ownerName: null }), ...m, watching: meta?.watching });
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-control border border-line px-2.5 py-1 text-[12px] font-semibold text-t2 hover:text-t1 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save notes"}
          </button>
        </div>
      </div>
    </>
  );
}
