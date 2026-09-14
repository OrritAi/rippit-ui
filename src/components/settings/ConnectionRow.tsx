"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Connection } from "@/app/lib/connections-store";
import { InlineConfirm } from "@/components/shared/InlineConfirm";
import { StatusPill } from "@/components/shared/StatusPill";
import { Button } from "@/components/ui/button";
import { getConnector } from "@/lib/connectors";
import { toastError } from "@/lib/feedback";
import { ago } from "@/lib/time";

export type Health = "ok" | "warn" | "err";

/** Worst-first health of one connection, with the pill + note it earns. */
export function healthOf(c: Connection): {
  level: Health;
  pill: { label: string; tone: "ok" | "warn" | "err" | "muted" };
  note?: { text: string; tone: "warn" | "err" };
} {
  if (c.status === "needs_reauth") return { level: "warn", pill: { label: "Needs reauth", tone: "warn" }, note: { text: "session expired", tone: "warn" } };
  if (c.status === "error") return { level: "err", pill: { label: "Error", tone: "err" } };
  if (c.lastSyncOutcome === "failed") return { level: "err", pill: { label: "Active", tone: "ok" }, note: { text: "last sync failed", tone: "err" } };
  if (c.lastSyncOutcome === "partial") return { level: "warn", pill: { label: "Active", tone: "ok" }, note: { text: "partial sync", tone: "warn" } };
  return { level: "ok", pill: { label: "Active", tone: "ok" } };
}

export function worstHealth(conns: Connection[]): Health {
  const rank: Record<Health, number> = { ok: 0, warn: 1, err: 2 };
  return conns.reduce<Health>((worst, c) => {
    const h = healthOf(c).level;
    return rank[h] > rank[worst] ? h : worst;
  }, "ok");
}

/**
 * One connection, nested under its platform row: name, pill, mono meta,
 * and (for owners/admins) Resync + Disconnect with an inline confirm.
 */
export function ConnectionRow({
  connection,
  manage,
  syncing,
  busy,
  onSync,
  onDisconnect,
}: {
  connection: Connection;
  manage: boolean;
  syncing: boolean;
  /** Something on the same credential is syncing. */
  busy: boolean;
  onSync: () => void;
  onDisconnect: () => Promise<void>;
}) {
  const connector = getConnector(connection.provider);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const name = connection.displayName || connection.label || connection.externalId;
  const health = healthOf(connection);
  const via =
    connection.authType === "oauth"
      ? "via OAuth"
      : connection.authType === "extension"
        ? connection.capturedVia === "bookmarklet"
          ? "via bookmarklet"
          : connection.capturedVia === "extension"
            ? "via extension"
            : "via browser session"
        : null;

  return (
    <div className="ml-[62px] flex items-center gap-3 border-t border-line2 py-2.5 pr-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-medium">{name}</p>
          <StatusPill pill={health.pill} />
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-t3">
          {connector.nouns.container} id {connection.externalId}
          {via && ` · ${via}`}
          {` · synced ${syncing ? "now" : ago(connection.lastSyncedAt)}`}
          {connection.connectedBy?.name && ` · connected by ${connection.connectedBy.name}`}
          {health.note && <span className={health.note.tone === "err" ? "text-err-text" : "text-warn-text"}> · {health.note.text}</span>}
        </p>
      </div>
      {manage &&
        (confirming ? (
          /* Not "stops syncing": the disconnect deletes the whole estate —
             workflows, run history, health, tags, notes and comments — so a
             reconnect starts from scratch. Say the destructive part. */
          <InlineConfirm
            question="deletes its workflows and history"
            confirmLabel="Disconnect"
            busy={removing}
            onConfirm={async () => {
              setRemoving(true);
              try {
                await onDisconnect();
                toast.success("Disconnected — its workflows and their history were deleted");
              } catch (err) {
                toastError(err, "The connection couldn’t be removed. Try again.");
              } finally {
                setRemoving(false);
                setConfirming(false);
              }
            }}
            onCancel={() => setConfirming(false)}
          />
        ) : (
          <div className="flex flex-none items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={onSync}
              disabled={syncing || busy}
              aria-busy={syncing || undefined}
              title={busy && !syncing ? "Another connection on this credential is syncing" : undefined}
              className="cursor-pointer rounded-control border-line-strong bg-transparent text-[12px] font-semibold hover:bg-hover dark:bg-transparent dark:hover:bg-hover"
            >
              {syncing ? "Syncing…" : "Resync"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="cursor-pointer rounded-control text-[12px] text-t2 hover:text-t1"
            >
              Disconnect
            </Button>
          </div>
        ))}
    </div>
  );
}
