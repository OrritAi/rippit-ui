"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AdminOrgConnection,
  AdminOrgDetail,
  AdminOrgRow,
  enterSupport,
  fetchAdminOrganization,
  suspendOrganization,
  unsuspendOrganization,
} from "@/app/lib/api";
import { AppPuck, type PuckStatus } from "@/components/shared/AppPuck";
import { KvRow } from "@/components/shared/DetailPanelKit";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { StatusPill } from "@/components/shared/StatusPill";
import { Button } from "@/components/ui/button";
import { getConnector, isProviderId } from "@/lib/connectors";
import { toastError } from "@/lib/feedback";
import { ago, monthYear } from "@/lib/time";
import { ownerOf, statusPill } from "./OrgTable";

const EASE = [0.22, 1, 0.36, 1] as const;
const MEMBERS_SHOWN = 5;

function connectionMeta(c: AdminOrgConnection): { text: string; tone: "t3" | "warn" | "err"; dot: PuckStatus } {
  const at = c.lastSyncAt ?? c.lastSyncedAt ?? null;
  const health = c.health ?? (c.status === "needs_reauth" || c.status === "error" ? "err" : c.lastSyncOutcome && c.lastSyncOutcome !== "ok" ? "warn" : "ok");
  if (health === "err") {
    return { text: c.status === "needs_reauth" ? `auth failed · ${ago(at)}` : `error · ${ago(at)}`, tone: "err", dot: "err" };
  }
  if (health === "warn") return { text: at ? `sync stale · ${ago(at)}` : "never synced", tone: "warn", dot: "warn" };
  return { text: `synced ${ago(at)}`, tone: "t3", dot: "ok" };
}

/*
 * The 340px detail panel: identity, actions (view as / suspend / reactivate),
 * overview, connections with health, a capped members list. Esc closes.
 */
export function OrgPanel({ org, onClose, onChanged }: { org: AdminOrgRow; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const suspended = org.status === "suspended";
  const pill = statusPill(org.status);

  useEffect(() => {
    let live = true;
    fetchAdminOrganization(org.id)
      .then((d) => live && setDetail(d))
      .catch((e) => live && toastError(e, "The organization couldn’t be loaded."));
    return () => {
      live = false;
    };
  }, [org.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirming) setConfirming(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onClose]);

  const suspend = async () => {
    setBusy(true);
    try {
      await suspendOrganization(org.id);
      toast.success(`${org.name} suspended — members lose access on next request`);
      setConfirming(false);
      onChanged();
    } catch (e) {
      toastError(e, "The organization couldn’t be suspended.");
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async () => {
    setBusy(true);
    try {
      await unsuspendOrganization(org.id);
      toast.success(`${org.name} reactivated`);
      onChanged();
    } catch (e) {
      toastError(e, "The organization couldn’t be reactivated.");
    } finally {
      setBusy(false);
    }
  };

  const members = detail?.members ?? [];
  const connections = detail?.connections ?? [];
  const createdAt = detail?.organization.created_at ?? detail?.organization.createdAt ?? org.createdAt;
  const outline = "cursor-pointer rounded-control border-line-strong bg-transparent text-[12.5px] font-semibold hover:bg-hover dark:bg-transparent dark:hover:bg-hover";

  return (
    <motion.aside
      key={org.id}
      aria-label={`${org.name} details`}
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="w-[340px] flex-none overflow-y-auto border-l border-line bg-sidebar"
    >
      <div className="flex flex-col gap-4 px-[18px] pb-10 pt-[18px]">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="[overflow-wrap:anywhere] text-[15px] font-bold tracking-[-0.02em]">{org.name}</h2>
            <p className="mt-0.5 [overflow-wrap:anywhere] font-mono text-[10.5px] text-t3">org id {org.id}</p>
          </div>
          <StatusPill pill={pill} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex-none cursor-pointer text-[14px] leading-none text-t3 transition-colors duration-[var(--dur-fast)] hover:text-t1"
          >
            ×
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => enterSupport({ id: org.id, name: org.name })}
            className="cursor-pointer rounded-control border border-line text-[12.5px] font-semibold"
          >
            View as org
          </Button>
          {suspended ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reactivate} className={outline}>
              Reactivate
            </Button>
          ) : confirming ? (
            <>
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={suspend} className="cursor-pointer rounded-control text-[12.5px] font-semibold dark:bg-destructive">
                Confirm
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)} className="cursor-pointer rounded-control text-[12.5px] text-t2 hover:text-t1">
                Cancel
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)} className={outline}>
              Suspend…
            </Button>
          )}
        </div>
        {confirming && <p className="font-mono text-[11px] text-err-text">members lose access · connections stop syncing</p>}

        <div>
          <h3 className="mb-1 text-[12px] font-semibold text-t2">Overview</h3>
          <KvRow k="Owner" v={ownerOf(org)} />
          <KvRow k="Members" v={org.memberCount} />
          <KvRow k="Workflows" v={org.workflowCount ?? "—"} />
          <KvRow k="Runs / 30d" v={org.runs30d == null ? "—" : `${org.runs30d.toLocaleString()} runs`} />
          <KvRow k="Created" v={monthYear(createdAt)} />
          <KvRow k="Last activity" v={ago(org.lastActivityAt ?? org.lastSyncAt)} />
        </div>

        <div>
          <h3 className="mb-1.5 text-[12px] font-semibold text-t2">Connections</h3>
          {!detail && <p className="border-t border-line2 py-1.5 font-mono text-[10.5px] text-t3">loading…</p>}
          {detail && connections.length === 0 && (
            <p className="border-t border-line2 py-1.5 text-[12px] text-t3">Nothing connected — the org hasn’t added a platform.</p>
          )}
          {connections.map((c) => {
            const m = connectionMeta(c);
            const name = isProviderId(c.provider) ? getConnector(c.provider).label : c.provider;
            return (
              <div key={c.id} className="flex items-center gap-[9px] border-t border-line2 py-[7px]">
                <AppPuck app={c.provider} size={22} status={m.dot} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                  {name}
                  {c.label ? <span className="text-t3"> · {c.label}</span> : null}
                </span>
                <span className={`flex-none font-mono text-[10px] ${m.tone === "err" ? "text-err-text" : m.tone === "warn" ? "text-warn-text" : "text-t3"}`}>{m.text}</span>
              </div>
            );
          })}
        </div>

        <div>
          <h3 className="mb-1.5 text-[12px] font-semibold text-t2">Members</h3>
          {!detail && <p className="border-t border-line2 py-1.5 font-mono text-[10.5px] text-t3">loading…</p>}
          {members.slice(0, MEMBERS_SHOWN).map((m) => (
            <div key={m.user_id} className="flex items-center gap-[9px] border-t border-line2 py-[7px]">
              <InitialsAvatar name={m.display_name || m.email} size={22} />
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{m.email || m.display_name || m.user_id}</span>
              <span className="flex-none font-mono text-[10px] text-t3">{m.role}</span>
            </div>
          ))}
          {members.length > MEMBERS_SHOWN && (
            <p className="border-t border-line2 py-[7px] font-mono text-[10.5px] text-t3">+ {members.length - MEMBERS_SHOWN} more</p>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
