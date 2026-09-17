"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { toast } from "sonner";
import { useRole } from "@/components/app/WorkspaceProvider";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { ConnectorCatalog } from "@/components/connect/ConnectorCatalog";
import { SectionTitle } from "@/components/shared/Card";
import { getConnector } from "@/lib/connectors";
import { can } from "@/lib/roles";

/*
 * Connections: one list, every platform once, its connections nested under
 * it. Every mutation is one of the ConnectionsProvider's — sync already
 * toasts its own progress.
 */

export default function ConnectionsPage() {
  const role = useRole();
  const manage = can(role, "manageConnections");
  const { connections, loading, syncing, canSync, sync, disconnect, add, refresh } = useConnections();

  // Returning from an OAuth redirect: say how it went, then forget the query
  // so a reload does not say it again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const oauthError = params.get("oauth_error");
    if (!connected && !oauthError) return;
    if (connected) {
      toast.success(`Connected ${connected.toUpperCase()} — syncing`);
      refresh();
    } else if (oauthError) {
      toast.error(`The connection didn’t go through: ${oauthError}`);
    }
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The bookmarklet connects out-of-band (in /connect): pick up new rows
  // without a manual reload.
  useEffect(() => {
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <section aria-labelledby="connections-heading" className="flex flex-col gap-4">
      <SectionTitle>
        <span id="connections-heading">Connections</span>
      </SectionTitle>

      <ConnectorCatalog
        connections={connections}
        manage={manage}
        loading={loading}
        actions={{ syncing, canSync, sync, disconnect }}
        onAdd={async (provider, values) => {
          await add(provider, values);
          posthog.capture("connection_added", { provider });
          toast.success(`${getConnector(provider).label} connected — syncing`);
        }}
      />
    </section>
  );
}
