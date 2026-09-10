"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "@/components/app/WorkspaceProvider";
import {
  createWorkspace,
  fetchMembers,
  inviteMember,
  removeMember,
  renameWorkspace,
  revokeInvite,
  updateMe,
  WorkspaceInvite,
  WorkspaceMember,
} from "@/app/lib/api";
import { Check, Copy, KeyRound, LogOut, RefreshCw, Trash2 } from "lucide-react";
import { getConnector as getConnectorDescriptor } from "@/lib/connectors";
import type { ProviderId } from "@/lib/connectors/types";
import { mintPairingCode, PairingCode } from "@/app/lib/api";
import type { WorkspaceRole } from "@/app/lib/api";
import {
  AcceptedTermsList,
  ConsentGate,
  useLegalGates,
} from "@/components/connect/ConsentGate";
import { useAuth } from "@/components/app/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConnections } from "@/components/app/ConnectionsProvider";
import {
  ConnectorCatalog,
  ConnectorGlyph,
} from "@/components/connect/ConnectorCatalog";
import { getConnector } from "@/lib/connectors";
import { StatusPill } from "@/components/shared/StatusPill";
import { ViewBar } from "@/components/views/ViewFrame";
import type { Connection } from "@/app/lib/connections-store";

function ConnectionRow({
  connection,
  syncing,
  busy,
  onSync,
  onDisconnect,
}: {
  connection: Connection;
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

  return (
    <div className="flex items-center gap-3 border-b border-line2 px-4 py-3.5 last:border-b-0">
      <ConnectorGlyph connector={connector} size={34} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {connector.shortLabel} · {name}
          </span>
          <StatusPill
            pill={
              connection.status === "active"
                ? { label: "Active", tone: "ok" }
                : connection.status === "needs_reauth"
                  ? { label: "Needs reauth", tone: "warn" }
                  : { label: "Error", tone: "warn" }
            }
          />
        </p>
        <p className="[overflow-wrap:anywhere] font-mono text-[11px] text-t3">
          {connector.nouns.container} id {connection.externalId}
          {connection.accountName && connection.label && connection.accountName !== connection.label ? ` · ${connection.accountName}` : ""}
          {connection.authType === "oauth" && " · via OAuth (names & status only)"}
          {/* auth_type "extension" means "a browser session token" — both the
              bookmarklet and the extension produce it, so only config tells us
              which. Say "browser session" when it does not. */}
          {connection.authType === "extension" &&
            (connection.capturedVia === "bookmarklet"
              ? " · via bookmarklet"
              : connection.capturedVia === "extension"
                ? " · via extension"
                : " · via browser session")}
          {connection.lastSyncedAt &&
            ` · synced ${new Date(connection.lastSyncedAt).toLocaleString()}`}
          {connection.connectedBy?.name && ` · connected by ${connection.connectedBy.name}`}
        </p>
        {/* The estate only reports itself fresh when the sync actually worked;
            a failed attempt says so here instead of looking like nothing
            happened. */}
        {connection.lastSyncOutcome && connection.lastSyncOutcome !== "ok" && (
          <p className={`mt-1 text-[12px] ${connection.lastSyncOutcome === "failed" ? "text-err-text" : "text-warn-text"}`}>
            {connection.lastSyncOutcome === "failed"
              ? "The last sync failed — nothing was captured, so what you see below is older than it looks."
              : "The last sync captured some workflows but not all — see which on the Health page."}
            {connection.lastSyncAttemptAt &&
              ` Attempted ${new Date(connection.lastSyncAttemptAt).toLocaleString()}.`}
          </p>
        )}
        {connection.status === "needs_reauth" && (
          <p className="mt-1 text-[12px] text-warn-text">
            {connector.connect.type === "extension"
              ? "Session expired — reconnect from the Rippit extension."
              : "Session expired — reconnect below."}
          </p>
        )}
      </div>
      <button
        onClick={onSync}
        // Locked while ANY connection is syncing: only one runs at a time, so
        // a live-looking button elsewhere would be one that does nothing.
        disabled={syncing || busy}
        aria-busy={syncing}
        aria-label={
          syncing
            ? `Syncing ${connector.label} ${name}`
            : busy
              ? "Another sub-account on this credential is syncing"
              : `Sync ${connector.label} ${name} now`
        }
        title={
          syncing ? "Syncing…" : busy ? "Another sub-account on this credential is syncing" : "Sync now"
        }
        className="flex size-[30px] items-center justify-center rounded-control border border-line-strong text-t3 transition-colors not-disabled:cursor-pointer hover:border-t1 hover:text-t1 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:text-t3"
      >
        <RefreshCw
          aria-hidden="true"
          className={`size-3.5 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
      </button>
      {confirming && !busy ? (
        <span className="flex items-center gap-2 text-[12px]">
          <button
            onClick={async () => {
              setRemoving(true);
              try {
                await onDisconnect();
              } finally {
                setRemoving(false);
                setConfirming(false);
              }
            }}
            disabled={removing}
            className="cursor-pointer font-semibold text-err-text underline-offset-2 hover:underline disabled:opacity-50"
          >
            {removing ? "Removing…" : "Confirm"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="cursor-pointer text-t3 underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          // No destructive action mid-sync: deleting a connection while its
          // estate is being captured leaves the manifest and workflow rows
          // pointing at something that no longer exists.
          disabled={busy}
          aria-label={
            busy
              ? "Syncing — disconnect is unavailable"
              : `Disconnect ${connector.label} ${name}`
          }
          title={busy ? "Syncing — wait for it to finish" : "Disconnect"}
          className="flex size-[30px] items-center justify-center rounded-control border border-line-strong text-t3 transition-colors not-disabled:cursor-pointer hover:border-err hover:text-err-text disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:text-t3"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function PairingCard() {
  const gates = useLegalGates();
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!pairing) return;
    const tick = () => {
      const ms = new Date(pairing.expires_at).getTime() - Date.now();
      setRemaining(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pairing]);

  const expired = pairing != null && remaining <= 0;

  const generate = async () => {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      setPairing(await mintPairingCode());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t generate a code");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-line bg-panel px-4 py-4">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound aria-hidden="true" className="size-3.5 text-t3" />
        <h3 className="text-[13.5px] font-semibold">Chrome extension</h3>
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-t2">
        Only needed if you are on the older Rippit Chrome extension. Connecting
        HighLevel now uses the bookmarklet under <strong>Add a platform</strong>{" "}
        — no install, and it works in any browser. If you do have the extension,
        generate a code and paste it in; codes are single-use and expire after
        10 minutes.
      </p>

      {/* The code is what claims a connection, so this is where consent for the
          extension path is enforced client-side; the API 403s regardless. */}
      <ConsentGate
        slugs={gates?.extension ?? null}
        intro="Generating a code connects a location through the extension. Read what that does first."
      >
      {pairing && !expired && (
        <div className="mb-3 flex items-center gap-3">
          <code className="rounded-control border border-line-strong bg-code px-3 py-2 font-mono text-[17px] font-bold tracking-[0.25em]">
            {pairing.code}
          </code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(pairing.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            aria-label={copied ? "Copied" : "Copy pairing code"}
            className="flex size-[30px] cursor-pointer items-center justify-center rounded-control border border-line-strong text-t3 transition-colors hover:border-t1 hover:text-t1"
          >
            {copied ? (
              <Check aria-hidden="true" className="size-3.5 text-ok-text" />
            ) : (
              <Copy aria-hidden="true" className="size-3.5" />
            )}
          </button>
          <span role="status" className="tabular text-[12px] text-t3">
            expires in {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </span>
        </div>
      )}
      {expired && (
        <p role="status" className="mb-3 text-[12.5px] text-warn-text">
          That code expired — generate a new one.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-[12.5px] text-err-text">
          {error}
        </p>
      )}

      <Button
        onClick={generate}
        disabled={busy}
        variant="outline"
        className="h-auto cursor-pointer rounded-control border-line-strong bg-transparent px-3 py-[7px] text-[12.5px] font-semibold text-t2 hover:border-t1 hover:bg-transparent hover:text-t1 disabled:opacity-50"
      >
        {busy
          ? "Generating…"
          : pairing && !expired
            ? "Generate a new code"
            : "Generate code"}
      </Button>
      </ConsentGate>
    </div>
  );
}

/* Workspace: name, members, invites. Owners manage; members see the list. */
function WorkspaceCard() {
  const { current, workspaces, switchTo, refresh } = useWorkspace();
  const { user } = useAuth();
  const [data, setData] = useState<{ members: WorkspaceMember[]; invites: WorkspaceInvite[] } | null>(null);
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [email, setEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [gen, setGen] = useState(0);
  const isOwner = current?.role === "owner";

  useEffect(() => {
    if (!current) return;
    let live = true;
    fetchMembers(current.id)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [current, gen]);

  if (!current) return null;
  const reload = () => setGen((g) => g + 1);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-panel px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold">{current.name}</h3>
          <p className="[overflow-wrap:anywhere] font-mono text-[11.5px] text-t3">
            you are {current.role} · {data?.members.length ?? "…"} member{data && data.members.length === 1 ? "" : "s"}
            {workspaces.length > 1 ? ` · ${workspaces.length} workspaces` : ""}
          </p>
        </div>
        {isOwner && (
          <form
            className="flex items-center gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              try {
                await renameWorkspace(current.id, name);
                setNewName("");
                refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Rename failed");
              }
            }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Rename workspace…"
              aria-label="New workspace name"
              className="h-8 w-[180px] rounded-control border-line-strong bg-hover text-[13px]"
            />
            <Button type="submit" variant="outline" disabled={!newName.trim()} className="h-8 rounded-control border-line-strong bg-transparent px-2.5 text-[12.5px] text-t2 hover:text-t1">
              Rename
            </Button>
          </form>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-line2 rounded-control border border-line2">
        {(data?.members ?? []).map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[13px]">
              {m.display_name || m.email || m.user_id}
              {m.user_id === user?.id && <span className="text-t3"> (you)</span>}
            </span>
            <span className="rounded-full border border-line px-2 py-[1px] text-[10.5px] font-semibold text-t3">{m.role}</span>
            {isOwner && m.user_id !== user?.id && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await removeMember(current.id, m.user_id);
                    reload();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Remove failed");
                  }
                }}
                className="text-[12px] text-t3 hover:text-err-text"
                aria-label={`Remove ${m.display_name || m.email || "member"}`}
              >
                remove
              </button>
            )}
          </li>
        ))}
        {(data?.invites ?? []).map((inv) => (
          <li key={inv.id} className="flex items-center gap-3 px-3 py-2 text-t3">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[13px]">{inv.email}</span>
            <span className="rounded-full border border-dashed border-line px-2 py-[1px] text-[10.5px] font-semibold">invited · {inv.role}</span>
            {isOwner && (
              <button
                type="button"
                onClick={async () => {
                  await revokeInvite(current.id, inv.id).catch(() => {});
                  reload();
                }}
                className="text-[12px] hover:text-err-text"
                aria-label={`Revoke invite for ${inv.email}`}
              >
                revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            const value = email.trim();
            if (!value) return;
            setError("");
            try {
              await inviteMember(current.id, value, inviteRole);
              setEmail("");
              reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Invite failed");
            }
          }}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Invite by email…"
            aria-label="Invite member by email"
            className="h-8 rounded-control border-line-strong bg-hover text-[13px]"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
            aria-label="Role for the invited member"
            className="h-8 rounded-control border border-line-strong bg-hover px-2 text-[12.5px] text-t2"
          >
            <option value="member">Member</option>
            {/* Viewers read the estate and change nothing — the role for a
                client or stakeholder receiving the documentation. */}
            <option value="viewer">Viewer (read-only)</option>
            <option value="owner">Owner</option>
          </select>
          <Button type="submit" disabled={!email.trim()} className="h-8 rounded-control px-3 text-[12.5px] font-semibold">
            Invite
          </Button>
        </form>
      )}
      <p className="text-[11.5px] text-t3">
        Invited people join automatically the first time they sign in with that email.
        Everyone in a workspace sees the same connections, tags, comments and change log.
      </p>
      <div className="flex items-center gap-2 border-t border-line2 pt-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = (e.currentTarget.elements.namedItem("ws") as HTMLInputElement).value.trim();
            if (!name) return;
            try {
              const w = await createWorkspace(name);
              switchTo(w.id);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Create failed");
            }
          }}
        >
          <Input name="ws" placeholder="New workspace name…" aria-label="New workspace name" className="h-8 w-[200px] rounded-control border-line-strong bg-hover text-[13px]" />
          <Button type="submit" variant="outline" className="h-8 rounded-control border-line-strong bg-transparent px-2.5 text-[12.5px] text-t2 hover:text-t1">
            Create workspace
          </Button>
        </form>
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-err-text">
          {error}
        </p>
      )}
    </div>
  );
}

function ProfileCard() {
  const { user, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-panel px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <h3 className="text-[13.5px] font-semibold">Signed in</h3>
        <p className="[overflow-wrap:anywhere] font-mono text-[12px] text-t3">{user?.email}</p>
        <form
          className="mt-2 flex items-center gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await updateMe(name.trim()).catch(() => {});
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name (shown to teammates)"
            aria-label="Display name"
            className="h-8 w-[240px] rounded-control border-line-strong bg-hover text-[13px]"
          />
          <Button type="submit" variant="outline" disabled={!name.trim()} className="h-8 rounded-control border-line-strong bg-transparent px-2.5 text-[12.5px] text-t2 hover:text-t1">
            {saved ? "Saved" : "Save"}
          </Button>
        </form>
      </div>
      <Button
        onClick={async () => {
          setBusy(true);
          await signOut();
        }}
        disabled={busy}
        variant="outline"
        className="h-auto cursor-pointer rounded-control border-line-strong bg-transparent px-3 py-[7px] text-[12.5px] font-semibold text-t2 hover:border-t1 hover:bg-transparent hover:text-t1 disabled:opacity-50"
      >
        <LogOut aria-hidden="true" className="size-3" />
        {busy ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}

export default function ConnectionsPage() {
  const { connections, syncing, canSync, sync, disconnect, add, refresh } =
    useConnections();
  const [watching, setWatching] = useState<ProviderId | null>(null);
  const searchParams = useSearchParams();
  const connectedParam = searchParams.get("connected");
  const oauthError = searchParams.get("oauth_error");
  const [oauthNotice, setOauthNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  useEffect(() => {
    document.title = "Settings — Rippit";
  }, []);

  // Returning from an OAuth redirect: show the outcome and reload connections.
  useEffect(() => {
    if (connectedParam) {
      setOauthNotice({ tone: "ok", text: `Connected ${connectedParam.toUpperCase()} via OAuth — syncing…` });
      refresh();
    } else if (oauthError) {
      setOauthNotice({ tone: "warn", text: `OAuth connection failed: ${oauthError}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedParam, oauthError]);

  // Extension flows connect out-of-band; refresh periodically so a new
  // location appears without a manual reload — faster while an
  // extension-connect card is open.
  const extensionOpen =
    watching != null &&
    getConnectorDescriptor(watching).connect.type === "extension";
  useEffect(() => {
    const t = setInterval(refresh, extensionOpen ? 5000 : 15000);
    return () => clearInterval(t);
  }, [refresh, extensionOpen]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="Settings" meta={`${connections.length} connection${connections.length === 1 ? "" : "s"}`} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          {oauthNotice && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 rounded-card border px-4 py-2.5 text-[13px]"
              style={{
                color: oauthNotice.tone === "ok" ? "var(--ok-text)" : "var(--warn-text)",
                borderColor: `color-mix(in srgb, var(${oauthNotice.tone === "ok" ? "--ok" : "--warn"}) 35%, transparent)`,
                background: `color-mix(in srgb, var(${oauthNotice.tone === "ok" ? "--ok" : "--warn"}) 8%, transparent)`,
              }}
            >
              <span>{oauthNotice.text}</span>
              <button type="button" onClick={() => setOauthNotice(null)} className="text-t3 hover:text-t1" aria-label="Dismiss">
                ×
              </button>
            </div>
          )}

          <section aria-labelledby="connected-heading">
            <h2
              id="connected-heading"
              className="mb-2 text-[12px] font-semibold text-t3"
            >
              Connected platforms
            </h2>
            <div className="overflow-hidden rounded-card border border-line bg-panel">
              {connections.length === 0 && (
                <p className="px-4 py-6 text-center text-[13px] italic text-t3">
                  Nothing connected yet — add a platform below.
                </p>
              )}
              {connections.map((conn) => (
                <ConnectionRow
                  key={conn.id}
                  connection={conn}
                  syncing={syncing.has(conn.id)}
                  busy={!canSync(conn)}
                  onSync={() => sync(conn)}
                  onDisconnect={() => disconnect(conn)}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="add-heading">
            <h2
              id="add-heading"
              className="mb-2 text-[12px] font-semibold text-t3"
            >
              Add a platform
            </h2>
            <ConnectorCatalog
              connections={connections}
              onAdd={async (provider, values) => {
                await add(provider, values);
              }}
              pollingProvider={extensionOpen ? watching : null}
              onExpandChange={setWatching}
            />
          </section>

          <section aria-labelledby="pairing-heading">
            <h2
              id="pairing-heading"
              className="mb-2 text-[12px] font-semibold text-t3"
            >
              Chrome extension (legacy)
            </h2>
            <PairingCard />
          </section>

          <section aria-labelledby="workspace-heading">
            <h2
              id="workspace-heading"
              className="mb-2 text-[12px] font-semibold text-t3"
            >
              Workspace
            </h2>
            <WorkspaceCard />
          </section>

          <section aria-labelledby="profile-heading">
            <h2
              id="profile-heading"
              className="mb-2 text-[12px] font-semibold text-t3"
            >
              Account
            </h2>
            <ProfileCard />
          </section>

          <section aria-labelledby="terms-heading">
            <h2
              id="terms-heading"
              className="mb-2 text-[12px] font-semibold text-t3"
            >
              Terms you have accepted
            </h2>
            <div className="rounded-card border border-line bg-panel px-4 py-4">
              <AcceptedTermsList />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
