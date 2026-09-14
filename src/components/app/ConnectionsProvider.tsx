"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchLinks, LinkMap } from "@/app/lib/api";
import { toast } from "sonner";

const EMPTY_SYNCING: ReadonlySet<string> = new Set();

/**
 * Whose credential a connection runs on: its account parent if it has one,
 * else itself. Sub-accounts under one GoHighLevel account share a session
 * token, so they are one caller to the provider however many rows they are
 * to us — and syncs on the same owner must not overlap.
 */
function credentialOwner(conn: Connection): string {
  return conn.parentId || conn.id;
}
import {
  addConnection,
  Connection,
  deleteConnection,
  fetchConnections,
  syncConnection,
} from "@/app/lib/connections-store";
import { getConnector } from "@/lib/connectors";
import type { NavGroup, ProviderId } from "@/lib/connectors/types";

/*
 * One provider for everything connection-shaped: the connection list, each
 * connection's nav tree (fetched in parallel, filled incrementally so one
 * broken connector never blanks the others), and the shared cross-platform
 * link map (previously fetched separately by three pages).
 */

export type TreeStatus = "loading" | "ready" | "error";

interface ConnectionsCtx {
  connections: Connection[];
  loading: boolean;
  error: string;
  trees: Record<string, NavGroup[]>;
  treeStatus: Record<string, TreeStatus>;
  linkMap: LinkMap | null;
  /** Connection ids currently syncing. */
  syncing: Set<string>;
  /** Connection ids whose delete is still in flight. They are already gone
   *  from `connections`; this is only for a caller that wants to say so. */
  removing: Set<string>;
  /** Whether a sync may start for this connection — false while anything on
   *  the same credential is running. */
  canSync: (conn: Connection) => boolean;
  refresh: () => void;
  sync: (conn: Connection) => Promise<void>;
  disconnect: (conn: Connection) => Promise<void>;
  add: (
    provider: ProviderId,
    values: Record<string, string>
  ) => Promise<Connection>;
}

const Ctx = createContext<ConnectionsCtx>({
  connections: [],
  loading: true,
  error: "",
  trees: {},
  treeStatus: {},
  linkMap: null,
  syncing: EMPTY_SYNCING as Set<string>,
  removing: EMPTY_SYNCING as Set<string>,
  canSync: () => true,
  refresh: () => {},
  sync: async () => {},
  disconnect: async () => {},
  add: async () => {
    throw new Error("ConnectionsProvider missing");
  },
});

export function useConnections() {
  return useContext(Ctx);
}

/** Every workflow across every connection, flattened — search/palette source. */
export interface WorkflowIndexEntry {
  provider: ProviderId;
  refId: string;
  name: string;
  live?: boolean;
  status?: string | null;
  app?: string;
  groupPath: string[];
  connectionId: string;
}

export function useWorkflowIndex(): WorkflowIndexEntry[] {
  const { connections, trees } = useConnections();
  return useMemo(
    () =>
      connections.flatMap((conn) =>
        (trees[conn.id] ?? []).flatMap((g) =>
          [...g.items, ...(g.folders ?? []).flatMap((f) => f.items)].map(
            (item) => ({
              provider: conn.provider,
              refId: item.refId,
              name: item.name,
              live: item.live,
              status: item.status,
              app: item.app,
              groupPath: item.groupPath,
              connectionId: conn.id,
            })
          )
        )
      ),
    [connections, trees]
  );
}

export function ConnectionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [trees, setTrees] = useState<Record<string, NavGroup[]>>({});
  const [treeStatus, setTreeStatus] = useState<Record<string, TreeStatus>>({});
  const [linkMap, setLinkMap] = useState<LinkMap | null>(null);
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [generation, setGeneration] = useState(0);

  // Nothing has landed yet. Only the *first* pass may put the app in a
  // loading state: `refresh()` re-reads every connection and every tree, and
  // flipping `loading` for that blanks the shell's workflow browser, its
  // count, and half a dozen pages — for a reload whose result is usually
  // identical to what is already on screen. Subsequent passes fill in place.
  const cold = useRef(true);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  const loadTree = useCallback((conn: Connection) => {
    setTreeStatus((s) => ({ ...s, [conn.id]: "loading" }));
    getConnector(conn.provider)
      .fetchTree({ id: conn.id, externalId: conn.externalId, label: conn.label, displayName: conn.displayName })
      .then((groups) => {
        setTrees((t) => ({ ...t, [conn.id]: groups }));
        setTreeStatus((s) => ({ ...s, [conn.id]: "ready" }));
      })
      .catch(() => {
        setTreeStatus((s) => ({ ...s, [conn.id]: "error" }));
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (cold.current) setLoading(true);
    setError("");
    fetchConnections()
      .then((conns) => {
        if (cancelled) return;
        setConnections(conns);
        conns.forEach(loadTree);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => {
        if (cancelled) return;
        cold.current = false;
        setLoading(false);
      });

    fetchLinks()
      .then((m) => !cancelled && setLinkMap(m))
      .catch(() => !cancelled && setLinkMap(null));

    return () => {
      cancelled = true;
    };
  }, [generation, loadTree]);

  // Serialised per *credential*, not per workspace.
  //
  // 100 GoHighLevel sub-accounts under one account share a single session
  // token: syncing them at once multiplies outbound load against one
  // credential, which is the traffic pattern the API's per-credential cap
  // exists to prevent, and each sync re-reads the whole estate. Two
  // connections on *different* credentials — a Make account and a GHL one,
  // or two separate GHL accounts — are genuinely independent and run together.
  const inFlight = useRef<Set<string>>(new Set());

  const sync = useCallback(
    async (conn: Connection) => {
      const owner = credentialOwner(conn);
      if (inFlight.current.has(owner)) return;
      inFlight.current.add(owner);
      setSyncing((prev) => new Set(prev).add(conn.id));
      const label = conn.displayName || conn.label || getConnector(conn.provider).shortLabel;
      try {
        const work = syncConnection(conn);
        toast.promise(work, {
          loading: `Syncing ${label}…`,
          success: (res: unknown) => {
            const r = (res ?? {}) as { synced?: number; outcome?: string; errors?: unknown[] };
            const failed = r.outcome === "failed";
            const partial = r.outcome === "partial" || (r.errors?.length ?? 0) > 0;
            if (failed) return { message: `${label}: nothing captured`, description: "The sync ran but read nothing. See Health." };
            if (partial) return { message: `${label} synced with gaps`, description: `${r.synced ?? 0} updated · some failed, see Health.` };
            return { message: `${label} synced`, description: r.synced ? `${r.synced} updated · just now` : "Up to date · just now" };
          },
          error: (e: unknown) => ({
            message: `Could not sync ${label}`,
            description: e instanceof Error && e.message ? e.message : "Try again in a moment.",
          }),
        });
        await work;
        loadTree(conn);
        fetchLinks()
          .then(setLinkMap)
          .catch(() => {});
      } finally {
        inFlight.current.delete(owner);
        setSyncing((prev) => {
          const next = new Set(prev);
          next.delete(conn.id);
          return next;
        });
      }
    },
    [loadTree]
  );

  const canSync = useCallback(
    (conn: Connection) => !inFlight.current.has(credentialOwner(conn)),
    []
  );

  // Disconnect is optimistic and never awaited by the UI.
  //
  // The request is slow by nature — the API purges everything the connection
  // produced before it drops the row, and a large estate cascades a lot of
  // rows — and the old shape awaited it, then called `refresh()`, which put
  // the whole app back into `loading` and refetched every other connection's
  // tree. Removing one connection made the rest of the product unusable for
  // as long as it took.
  //
  // So the row leaves immediately (a delete has one plausible outcome) and
  // the request runs behind a toast. On failure it comes back, which is the
  // only state worth restoring: nothing else in the app depends on it.
  const disconnect = useCallback(
    async (conn: Connection) => {
      const label =
        conn.displayName || conn.label || getConnector(conn.provider).shortLabel;

      setRemoving((prev) => new Set(prev).add(conn.id));
      setConnections((prev) => prev.filter((c) => c.id !== conn.id));
      const drop = <T,>(map: Record<string, T>) =>
        Object.fromEntries(Object.entries(map).filter(([id]) => id !== conn.id));
      setTrees(drop);
      setTreeStatus(drop);

      const work = deleteConnection(conn).finally(() =>
        setRemoving((prev) => {
          const next = new Set(prev);
          next.delete(conn.id);
          return next;
        })
      );

      toast.promise(work, {
        loading: `Disconnecting ${label}…`,
        success: `Disconnected ${label} — its workflows and their history were deleted`,
        error: `${label} could not be disconnected`,
      });

      try {
        await work;
      } catch {
        // Put it back. `refresh()` rather than re-inserting the stale object:
        // the server is the only thing that knows whether the delete got far
        // enough to matter.
        refresh();
        return;
      }
      // Cross-platform edges referenced this connection's workflows. Cheap,
      // and the only shared state a disconnect actually invalidates.
      fetchLinks()
        .then(setLinkMap)
        .catch(() => setLinkMap(null));
    },
    [refresh]
  );

  const add = useCallback(
    async (provider: ProviderId, values: Record<string, string>) => {
      const conn = await addConnection(provider, values);
      refresh();
      return conn;
    },
    [refresh]
  );

  const value = useMemo(
    () => ({
      connections,
      loading,
      error,
      trees,
      treeStatus,
      linkMap,
      syncing,
      removing,
      canSync,
      refresh,
      sync,
      disconnect,
      add,
    }),
    [
      connections,
      loading,
      error,
      trees,
      treeStatus,
      linkMap,
      syncing,
      removing,
      canSync,
      refresh,
      sync,
      disconnect,
      add,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
