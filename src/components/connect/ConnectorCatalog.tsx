"use client";

import { useEffect, useId, useState } from "react";
import { fetchConnectorCatalog, startOAuth } from "@/app/lib/api";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allConnectors } from "@/lib/connectors";
import type { ConnectorDescriptor, ProviderId } from "@/lib/connectors/types";
import type { Connection } from "@/app/lib/connections-store";
import { ConsentGate, useLegalGates } from "@/components/connect/ConsentGate";
import BookmarkletCard from "@/components/connect/BookmarkletCard";
import { bookmarkletHref } from "@/lib/bookmarklet";
import { useOrigin } from "@/lib/use-origin";
import { AppPuck } from "@/components/shared/AppPuck";
import { Card, CardHeader } from "@/components/shared/Card";
import { ConnectionRow, worstHealth } from "@/components/settings/ConnectionRow";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Per-connector connect flow: a credentials form or extension hand-off. */
/** "Connect with {platform}" — official OAuth path (server-configured). */
function OAuthButton({ connector }: { connector: ConnectorDescriptor }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const { url } = await startOAuth(connector.id);
            window.location.assign(url);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not start OAuth");
            setBusy(false);
          }
        }}
        className="h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px] font-semibold hover:opacity-85 disabled:opacity-50"
      >
        {busy ? "Redirecting…" : `Connect with ${connector.label} (official OAuth)`}
        {!busy && <ArrowRight aria-hidden="true" className="size-3.5" />}
      </Button>
      <p className="text-[11.5px] text-t3">
        Installs Orrit on one sub-account. OAuth returns workflow names and
        status only — keep the extension connected for step-level detail.
      </p>
      {error && (
        <p role="alert" className="text-[12px] text-err-text">
          {error}
        </p>
      )}
    </div>
  );
}

export function ConnectFlow({
  connector,
  onSubmit,
  waiting,
  oauthAvailable,
}: {
  connector: ConnectorDescriptor;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  /** Extension flows: parent is polling for the connection to appear. */
  waiting?: boolean;
  /** Server has an OAuth app configured for this provider. */
  oauthAvailable?: boolean;
}) {
  const formId = useId();
  const gates = useLegalGates();
  // The bookmarklet needs Orrit's real origin baked into its href.
  const origin = useOrigin();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (connector.connect.type === "bookmarklet") {
    return (
      <div className="flex flex-col gap-3 text-[13px] text-t2">
        {/* Gated on the same disclosure as the extension: the capture vehicle
            changed, what the user is consenting to did not. */}
        <ConsentGate
          slugs={gates?.extension ?? null}
          intro="Before connecting GoHighLevel, read what this does and what it risks."
        >
          <ol className="list-decimal space-y-1.5 pl-4">
            {connector.connect.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <BookmarkletCard href={bookmarkletHref(origin)} />
        </ConsentGate>
        {oauthAvailable && (
          <div className="mt-1 border-t border-line2 pt-3">
            <ConsentGate slugs={gates?.connect ?? null}>
              <OAuthButton connector={connector} />
            </ConsentGate>
          </div>
        )}
      </div>
    );
  }

  if (connector.connect.type === "extension") {
    return (
      <div className="flex flex-col gap-2.5 text-[13px] text-t2">
        {/* The extension path carries a risk the OAuth path does not, so the
            two are gated separately — accepting the disclosure is not a
            precondition for the sanctioned route. */}
        <ConsentGate
          slugs={gates?.extension ?? null}
          intro="Before connecting a location with the extension, read what it does and what that risks."
        >
          <ol className="list-decimal space-y-1.5 pl-4">
            {connector.connect.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {waiting && (
            <p role="status" className="mt-2.5 flex items-center gap-2 text-t3">
              <span
                aria-hidden="true"
                className="size-3 animate-spin rounded-full border-2 border-t2 border-t-transparent motion-reduce:animate-none"
              />
              Waiting for the extension to connect…
            </p>
          )}
        </ConsentGate>
        {oauthAvailable && (
          <div className="mt-1 border-t border-line2 pt-3">
            <ConsentGate slugs={gates?.connect ?? null}>
              <OAuthButton connector={connector} />
            </ConsentGate>
          </div>
        )}
      </div>
    );
  }

  if (connector.connect.type === "oauth") {
    return oauthAvailable ? (
      <ConsentGate slugs={gates?.connect ?? null}>
        <OAuthButton connector={connector} />
      </ConsentGate>
    ) : (
      <p className="text-[13px] italic text-t3">
        OAuth is not configured on this server yet.
      </p>
    );
  }

  const { fields, helpText } = connector.connect;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConsentGate slugs={gates?.connect ?? null}>
      <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map((field) => {
        const inputId = `${formId}-${field.name}`;
        const errorId = `${formId}-error`;
        return (
          <div key={field.name}>
            <label
              htmlFor={inputId}
              className="mb-1.5 block text-[12px] font-semibold text-t3"
            >
              {field.label}
            </label>
            <Input
              id={inputId}
              type={field.secret ? "password" : "text"}
              required
              value={values[field.name] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [field.name]: e.target.value }))
              }
              placeholder={field.placeholder}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="h-9 rounded-control border-line-strong bg-hover text-[14px] tabular placeholder:text-t3"
            />
          </div>
        );
      })}
      {helpText && <p className="text-[12px] text-t3">{helpText}</p>}

      {error && (
        <motion.div
          role="alert"
          id={`${formId}-error`}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-control border border-[color-mix(in_srgb,var(--err)_32%,transparent)] bg-[color-mix(in_srgb,var(--err)_10%,transparent)] px-3 py-2 text-[13px] text-err-text"
        >
          {error}
        </motion.div>
      )}

      <Button
        type="submit"
        disabled={busy}
        className="h-auto w-full cursor-pointer rounded-control py-2.5 text-[13.5px] font-semibold hover:opacity-85 disabled:opacity-50"
      >
        {busy ? "Connecting…" : "Connect"}
        {!busy && <ArrowRight aria-hidden="true" className="size-3.5" />}
      </Button>
      </form>
    </ConsentGate>
  );
}

/** What the settings page hands each nested connection row. */
export interface ConnectionActions {
  syncing: Set<string>;
  canSync: (c: Connection) => boolean;
  sync: (c: Connection) => void;
  disconnect: (c: Connection) => Promise<void>;
}

/**
 * Platforms: every platform once. Its connections sit nested under it;
 * the chevron opens the connect flow ("Add another" / "Connect"). Members
 * get the connected platforms and their rows, nothing to click.
 */
export function ConnectorCatalog({
  connections,
  onAdd,
  manage,
  actions,
  loading,
  pollingProvider,
  onExpandChange,
}: {
  connections: Connection[];
  onAdd: (provider: ProviderId, values: Record<string, string>) => Promise<void>;
  manage: boolean;
  actions: ConnectionActions;
  loading?: boolean;
  /** Provider whose extension flow is being awaited (spinner state). */
  pollingProvider?: ProviderId | null;
  onExpandChange?: (provider: ProviderId | null) => void;
}) {
  const [expanded, setExpandedState] = useState<ProviderId | null>(null);
  const setExpanded = (p: ProviderId | null) => {
    setExpandedState(p);
    onExpandChange?.(p);
  };
  // Server catalog: which providers have an OAuth app configured.
  const [oauthProviders, setOauthProviders] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    fetchConnectorCatalog()
      .then((rows) => live && setOauthProviders(new Set(rows.filter((r) => r.oauthAvailable).map((r) => r.provider))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const rows = allConnectors()
    .map((connector) => ({ connector, conns: connections.filter((c) => c.provider === connector.id) }))
    .filter(({ conns }) => manage || conns.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Platforms" meta={connections.length ? `${connections.length} connected` : undefined} />
        {rows.length === 0 && (
          <p className="border-t border-line2 px-4 py-3 text-[12.5px] text-t3">{loading ? "loading…" : "Nothing connected yet."}</p>
        )}
        {rows.map(({ connector, conns }) => {
          const isOpen = expanded === connector.id;
          const connected = conns.length > 0;
          const health = worstHealth(conns);
          const panelId = `connect-${connector.id}`;
          const state = !connected
            ? { text: "not connected", cls: "text-t3" }
            : health === "warn"
              ? { text: "needs reauth", cls: "text-warn-text" }
              : { text: conns.length > 1 ? `connected · ${conns.length}` : "connected", cls: "text-ok-text" };
          const header = (
            <>
              <AppPuck app={connector.id} size={34} status={connected ? health : undefined} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{connector.label}</span>
                {!connected && <span className="mt-px block text-[12px] text-t3 [text-wrap:pretty]">{connector.description}</span>}
              </span>
              <span className={`flex-none font-mono text-[11px] ${state.cls}`}>{state.text}</span>
            </>
          );
          return (
            <div key={connector.id} className="border-t border-line2">
              {manage ? (
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : connector.id)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-hover"
                >
                  {header}
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-3.5 flex-none text-t3 transition-transform duration-[180ms] ease-[var(--ease-out)] ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">{header}</div>
              )}
              {conns.map((conn) => (
                <ConnectionRow
                  key={conn.id}
                  connection={conn}
                  manage={manage}
                  syncing={actions.syncing.has(conn.id)}
                  busy={!actions.canSync(conn)}
                  onSync={() => actions.sync(conn)}
                  onDisconnect={() => actions.disconnect(conn)}
                />
              ))}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={panelId}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <div className={`px-4 pb-3.5 pl-[62px] ${connected ? "border-t border-line2 pt-3" : ""}`}>
                      <ConnectFlow
                        connector={connector}
                        onSubmit={(values) => onAdd(connector.id, values)}
                        waiting={pollingProvider === connector.id}
                        oauthAvailable={oauthProviders.has(connector.id)}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </Card>

      {manage ? (
        <div className="flex items-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-3.5">
          <div aria-hidden="true" className="grid size-[34px] flex-none place-items-center rounded-card border border-line text-[15px] text-t3">
            +
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">More platforms coming</p>
            <p className="text-[12px] text-t3">Zapier, n8n, Close and more — orrit is built connector-first.</p>
          </div>
        </div>
      ) : (
        <p className="text-[12.5px] text-t3">Connections are managed by owners and admins.</p>
      )}
    </div>
  );
}
