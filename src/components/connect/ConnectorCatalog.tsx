"use client";

import { useEffect, useId, useState } from "react";
import { fetchConnectorCatalog, startOAuth } from "@/app/lib/api";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allConnectors } from "@/lib/connectors";
import type { ConnectorDescriptor, ProviderId } from "@/lib/connectors/types";
import type { Connection } from "@/app/lib/connections-store";
import { ConsentGate, useLegalGates } from "@/components/connect/ConsentGate";
import BookmarkletCard from "@/components/connect/BookmarkletCard";
import { bookmarkletHref } from "@/lib/bookmarklet";
import { useOrigin } from "@/lib/use-origin";

const EASE = [0.22, 1, 0.36, 1] as const;

export function ConnectorGlyph({
  connector,
  size = 38,
}: {
  connector: ConnectorDescriptor;
  size?: number;
}) {
  const col = connector.brandColor;
  return (
    <div
      aria-hidden="true"
      className="flex flex-none items-center justify-center rounded-[11px] border border-white/25 font-mono text-[13px] font-bold text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(180deg, color-mix(in oklab, ${col} 55%, #000), color-mix(in oklab, ${col} 42%, #000))`,
      }}
    >
      {connector.glyph}
    </div>
  );
}

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
        Installs Rippit on one sub-account. OAuth returns workflow names and
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
  // The bookmarklet needs Rippit's real origin baked into its href.
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

/**
 * The connector card grid: every registered platform, its connection status,
 * and an expand-in-place connect flow. Used by the landing page and the
 * Connections settings page.
 */
export function ConnectorCatalog({
  connections,
  onAdd,
  pollingProvider,
  onExpandChange,
}: {
  connections: Connection[];
  onAdd: (
    provider: ProviderId,
    values: Record<string, string>
  ) => Promise<void>;
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

  return (
    <div className="flex flex-col gap-3">
      {allConnectors().map((connector) => {
        const conns = connections.filter((c) => c.provider === connector.id);
        const isOpen = expanded === connector.id;
        const connected = conns.length > 0;
        const needsReauth = conns.some((c) => c.status === "needs_reauth");
        const panelId = `connect-${connector.id}`;
        return (
          <div
            key={connector.id}
            className="overflow-hidden rounded-card border border-line bg-panel backdrop-blur-[14px]"
          >
            <button
              onClick={() => setExpanded(isOpen ? null : connector.id)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-hover"
            >
              <ConnectorGlyph connector={connector} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{connector.label}</p>
                <p className="[overflow-wrap:anywhere] text-[12px] text-t3">
                  {connector.description}
                </p>
              </div>
              {connected ? (
                needsReauth ? (
                  <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-warn-text">
                    Needs reauth
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ok-text">
                    <Check aria-hidden="true" className="size-3" />
                    Connected
                    {conns.length > 1 ? ` · ${conns.length}` : ""}
                  </span>
                )
              ) : (
                <span className="text-[11.5px] font-semibold text-t3">
                  Not connected
                </span>
              )}
              <ChevronDown
                aria-hidden="true"
                className={`size-3.5 text-t3 transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={panelId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                >
                  <div className="border-t border-line2 px-4 py-4">
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

      {/* extensibility signal */}
      <div className="flex items-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-3.5 text-t3">
        <div
          aria-hidden="true"
          className="flex size-[38px] flex-none items-center justify-center rounded-[11px] border border-line"
        >
          <Puzzle className="size-4" />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-t2">
            More platforms coming
          </p>
          <p className="text-[12px]">
            Zapier, n8n, Close, and more — Rippit is built connector-first.
          </p>
        </div>
      </div>
    </div>
  );
}
