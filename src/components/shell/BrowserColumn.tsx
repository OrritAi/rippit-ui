"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  ChevronRight,
  Clock3,
  GripVertical,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  AnimatePresence,
  Reorder,
  motion,
  useDragControls,
  useReducedMotion,
  type DragControls,
} from "framer-motion";
import { useConnections, useWorkflowIndex } from "@/components/app/ConnectionsProvider";
import { getConnector } from "@/lib/connectors";
import type { NavFolder, NavGroup, NavItem, ProviderId } from "@/lib/connectors/types";
import type { Connection } from "@/app/lib/connections-store";
import { workflowHref } from "@/lib/portals";
import { fetchViews, SavedView } from "@/app/lib/api";
import { AppPuck } from "@/components/shared/AppPuck";
import { readStored, useRecentWorkflows, useStoredJson, writeStored } from "@/lib/stored";
import { ExpandToggle, useClamp } from "@/components/shared/ExpandableText";

/*
 * 206px workflow browser — folders are the browsing unit (hundreds of
 * workflows stay scannable because only one folder per connection is open
 * at a time). Typing filters the whole estate into a flat, capped hit list.
 * Severity dots come from the link map (error > warn/changed).
 */

type Sev = "err" | "warn" | null;
const OPEN_KEY = "orrit.browser.open";
const CONN_KEY = "orrit.browser.connOpen";
const PROVIDER_ORDER_KEY = "orrit.browser.providerOrder";
const CONN_ORDER_KEY = "orrit.browser.connOrder";
const HIT_CAP = 30;
const EMPTY_OPEN: Record<string, string | null> = {};
const EMPTY_CONN: Record<string, boolean> = {};
const EMPTY_ORDER: string[] = [];
const EMPTY_CONN_ORDER: Record<string, string[]> = {};

/** Stable sort by a persisted id order; ids not yet in the order keep their
 * natural position after the ordered ones. */
/**
 * User's saved drag order first, then a deterministic fallback.
 *
 * Anything the user has not explicitly ordered must still land in a fixed
 * place: falling back to arrival order means the sidebar reshuffles whenever
 * the API returns rows in a different order, which it is entitled to do.
 */
function orderBy<T>(items: T[], order: string[], key: (t: T) => string): T[] {
  const idx = new Map(order.map((k, i) => [k, i]));
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const rank = (idx.get(ka) ?? order.length) - (idx.get(kb) ?? order.length);
    return rank || ka.localeCompare(kb);
  });
}

const ROW =
  "flex w-full cursor-pointer items-center gap-1.5 rounded-row border-0 bg-transparent px-1.5 text-left transition-[background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover";

/** Dense rows clamp names to two lines; ClampedRow adds the expand control beside the link. */
function ClampedRow({ text, label, children }: { text: string; label: string; children: (clamp: ReturnType<typeof useClamp>) => React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const clamp = useClamp(2, text, expanded);
  return (
    <div className="flex w-full items-start">
      {children(clamp)}
      {clamp.overflowing && <ExpandToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} label={label} />}
    </div>
  );
}

function SevDot({ sev }: { sev: Sev }) {
  if (!sev) return null;
  const c = sev === "err" ? "var(--err)" : "var(--warn)";
  return (
    <span
      aria-hidden="true"
      className="size-[5px] flex-none rounded-full"
      style={{ background: c, boxShadow: `0 0 5px ${c}` }}
    />
  );
}

/** Light-blue "N unseen changes" count. */
function ChangeCount({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <span
      aria-label={`${n} change${n === 1 ? "" : "s"} since you last looked`}
      title={`${n} change${n === 1 ? "" : "s"} since you last looked`}
      className="tabular flex-none rounded-full border px-[5px] py-px font-mono text-[9px] leading-[1.4] text-chg-text"
      style={{
        background: "color-mix(in srgb, var(--chg) 10%, transparent)",
        borderColor: "color-mix(in srgb, var(--chg) 35%, transparent)",
      }}
    >
      {n}
    </span>
  );
}

function StatusDot({ item }: { item: NavItem }) {
  const c =
    item.status === "paused" ? "var(--warn)" : item.live ? "var(--ok)" : "var(--off)";
  return <span aria-hidden="true" className="size-[4px] flex-none rounded-full" style={{ background: c }} />;
}

/** Workflow browser — the side panel for Workflows / Dashboard / System map. */
export function WorkflowBrowser() {
  const pathname = usePathname();
  const { connections, trees, treeStatus, syncing, canSync, sync, linkMap, loading } = useConnections();
  const index = useWorkflowIndex();
  const [q, setQ] = useState("");
  // Persisted "which folder is open per connection".
  const open = useStoredJson<Record<string, string | null>>(OPEN_KEY, EMPTY_OPEN);
  // Read the current value at call time rather than closing over it: these
  // identities then never change, which is what lets the memoised rows below
  // skip re-rendering a whole estate when one folder toggles.
  const toggleFolder = useCallback((connId: string, folderId: string) => {
    const current = readStored<Record<string, string | null>>(OPEN_KEY, EMPTY_OPEN);
    writeStored(OPEN_KEY, {
      ...current,
      [connId]: current[connId] === folderId ? null : folderId,
    });
  }, []);
  // Organizations / locations collapse too (default open).
  const connOpen = useStoredJson<Record<string, boolean>>(CONN_KEY, EMPTY_CONN);
  const toggleConn = useCallback((connId: string) => {
    const current = readStored<Record<string, boolean>>(CONN_KEY, EMPTY_CONN);
    writeStored(CONN_KEY, { ...current, [connId]: !(current[connId] ?? true) });
  }, []);
  const [views, setViews] = useState<SavedView[]>([]);
  const recentAll = useRecentWorkflows();
  const recent = recentAll.slice(0, 5);

  // Persisted ordering: platform sections, and connections within each.
  const providerOrder = useStoredJson<string[]>(PROVIDER_ORDER_KEY, EMPTY_ORDER);
  const connOrder = useStoredJson<Record<string, string[]>>(CONN_ORDER_KEY, EMPTY_CONN_ORDER);
  const sections = useMemo(() => {
    const byProvider = new Map<string, Connection[]>();
    for (const c of connections) {
      byProvider.set(c.provider, [...(byProvider.get(c.provider) ?? []), c]);
    }
    return orderBy([...byProvider.keys()], providerOrder, (p) => p).map((provider) => ({
      provider: provider as ProviderId,
      connections: orderBy(byProvider.get(provider)!, connOrder[provider] ?? EMPTY_ORDER, (c) => c.id),
    }));
  }, [connections, providerOrder, connOrder]);

  useEffect(() => {
    let live = true;
    fetchViews().then((d) => live && setViews(d.views)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Severity (issues only) and unseen-change counts per workflow, from the
  // link map. Changes render as a light-blue count, never as a warn dot.
  const sevOf = useMemo(() => {
    const m = new Map<string, Sev>();
    for (const w of linkMap?.workflows ?? []) {
      const ic = w.issueCounts;
      const sev: Sev = ic && ic.error > 0 ? "err" : ic && ic.warn > 0 ? "warn" : null;
      if (sev) m.set(`${w.source}:${w.refId}`, sev);
    }
    return m;
  }, [linkMap]);
  const changedOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of linkMap?.workflows ?? []) {
      const n = w.changedSince?.count ?? 0;
      if (n > 0) m.set(`${w.source}:${w.refId}`, n);
    }
    return m;
  }, [linkMap]);

  const ql = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!ql) return null;
    const out: { key: string; href: string; name: string; app: string; path: string; sev: Sev }[] = [];
    for (const w of index) {
      const path = w.groupPath.join(" / ");
      if (w.name.toLowerCase().includes(ql) || path.toLowerCase().includes(ql)) {
        out.push({
          key: `${w.provider}:${w.refId}`,
          href: workflowHref({ source: w.provider, refId: w.refId }),
          name: w.name,
          app: w.provider,
          path: path || getConnector(w.provider).shortLabel,
          sev: sevOf.get(`${w.provider}:${w.refId}`) ?? null,
        });
        if (out.length >= HIT_CAP) break;
      }
    }
    return out;
  }, [ql, index, sevOf]);

  return (
    <>
      <div className="flex-none px-2 pb-1 pt-2">
        <label className="flex h-7 items-center gap-[7px] rounded-control border border-line bg-hover px-[9px] transition-[border-color] duration-[var(--dur-fast)] focus-within:border-line-strong hover:border-line-strong">
          <Search aria-hidden="true" className="size-[11px] flex-none text-t3" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${index.length || ""}…`}
            aria-label="Filter workflows"
            className="min-w-0 flex-1 border-0 bg-transparent text-[11.5px] text-t1 outline-none placeholder:text-t3"
          />
        </label>
      </div>
      <div className="thin-scroll stagger min-h-0 flex-1 overflow-y-auto p-[7px]">
        {hits ? (
          <div>
            <p role="status" className="tabular mx-1.5 mb-1 mt-0.5 font-mono text-[10px] text-t3">
              {hits.length}
              {hits.length === HIT_CAP ? "+" : ""} match{hits.length === 1 ? "" : "es"}
            </p>
            {hits.map((h) => (
              <ClampedRow key={h.key} text={h.name} label={`Show the full name of ${h.name}`}>
                {(clamp) => (
                  <Link href={h.href} className={`${ROW} min-h-[29px] min-w-0 flex-1 gap-[7px] py-[3px]`}>
                    <AppPuck app={h.app} size={16} />
                    <span className="min-w-0 flex-1">
                      <span ref={clamp.attach} style={clamp.style} className="text-[11.5px] text-t1">
                        {h.name}
                      </span>
                      <span className={`tabular block font-mono text-[9px] text-t3 [overflow-wrap:anywhere]`}>{h.path}</span>
                    </span>
                    <SevDot sev={h.sev} />
                  </Link>
                )}
              </ClampedRow>
            ))}
            {hits.length === 0 && <p className="px-1.5 py-1 text-[11.5px] italic text-t3">No workflows match</p>}
          </div>
        ) : (
          <>
            {recent.length > 0 && (
              <section className="mb-2" aria-label="Recently opened">
                <p className="px-1.5 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">Recent</p>
                {recent.map((r) => {
                  const href = `/w/${r.provider}/${r.id}`;
                  return (
                    <Link key={`${r.provider}:${r.id}`} href={href} aria-current={pathname === href ? "page" : undefined} className={`${ROW} min-h-[26px] py-[3px] text-[11.5px] ${pathname === href ? "bg-hover font-medium text-t1" : "text-t2 hover:text-t1"}`}>
                      <Clock3 aria-hidden="true" className="size-[11px] flex-none text-t3" />
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{r.name}</span>
                    </Link>
                  );
                })}
              </section>
            )}
            <Reorder.Group
              as="div"
              axis="y"
              values={sections.map((s) => s.provider)}
              onReorder={(next: string[]) => writeStored(PROVIDER_ORDER_KEY, next)}
            >
              {sections.map((s) => (
                <ProviderSection key={s.provider} provider={s.provider} count={s.connections.length}>
                  <Reorder.Group
                    as="div"
                    axis="y"
                    values={s.connections.map((c) => c.id)}
                    onReorder={(next: string[]) => writeStored(CONN_ORDER_KEY, { ...connOrder, [s.provider]: next })}
                  >
                    {s.connections.map((conn) => (
                      <ConnectionItem key={conn.id} id={conn.id}>
                        {(dragControls) => (
                          <ConnectionTree
                            connection={conn}
                            groups={trees[conn.id] ?? []}
                            status={treeStatus[conn.id] ?? "loading"}
                            syncing={syncing.has(conn.id)}
                            busy={!canSync(conn)}
                            onSync={() => sync(conn)}
                            openFolder={open[conn.id] ?? null}
                            onToggleFolder={(fid) => toggleFolder(conn.id, fid)}
                            expanded={connOpen[conn.id] ?? true}
                            onToggle={() => toggleConn(conn.id)}
                            sevOf={sevOf}
                            changedOf={changedOf}
                            pathname={pathname}
                            dragControls={dragControls}
                          />
                        )}
                      </ConnectionItem>
                    ))}
                  </Reorder.Group>
                </ProviderSection>
              ))}
            </Reorder.Group>
            {!loading && connections.length === 0 && (
              <div className="px-1.5 py-2 text-[11.5px] text-t3">
                Nothing connected yet.{" "}
                <Link href="/settings/connections" className="font-semibold text-t1 underline-offset-2 hover:underline">
                  Connect a platform
                </Link>
              </div>
            )}
            {loading && (
              <div role="status" aria-label="Loading connections" className="flex flex-col gap-1.5 px-1 py-1">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} aria-hidden="true" className="h-[22px] animate-pulse rounded-row bg-hover motion-reduce:animate-none" />
                ))}
              </div>
            )}
            {views.length > 0 && (
              <section className="mt-2" aria-label="Saved views">
                <p className="px-1.5 pb-0.5 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-t3">Views</p>
                {views.map((v) => (
                  <Link
                    key={v.id}
                    href={`/${v.kind === "unified" ? "map" : "dashboard"}?view=${encodeURIComponent(v.id)}`}
                    className={`${ROW} min-h-[26px] py-[3px] text-[11.5px] text-t2 hover:text-t1`}
                  >
                    <Bookmark aria-hidden="true" className="size-[11px] flex-none text-t3" />
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{v.name}</span>
                  </Link>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Count shown in the panel header. */
export function useWorkflowCount(): string {
  const { loading } = useConnections();
  const index = useWorkflowIndex();
  return loading ? "…" : `${index.length}`;
}

/** Small grab handle — shown on hover, drives a framer-motion drag control. */
function Grip({ controls, label }: { controls: DragControls; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Drag to reorder"
      onPointerDown={(e) => {
        e.preventDefault();
        controls.start(e);
      }}
      className="flex flex-none cursor-grab touch-none items-center border-0 bg-transparent p-0 text-t3 opacity-0 transition-opacity duration-[var(--dur-fast)] focus-visible:opacity-100 group-hover/reorder:opacity-100 active:cursor-grabbing"
    >
      <GripVertical aria-hidden="true" className="size-[11px]" />
    </button>
  );
}

/** One platform (GHL / Make) section: labeled header, draggable as a whole. */
function ProviderSection({ provider, count, children }: { provider: ProviderId; count: number; children: React.ReactNode }) {
  const controls = useDragControls();
  const connector = getConnector(provider);
  return (
    <Reorder.Item
      as="div"
      value={provider}
      dragListener={false}
      dragControls={controls}
      layout
      className="group/reorder relative mb-2.5 rounded-row bg-sidebar"
    >
      <div className="flex min-h-[24px] items-center gap-[6px] border-b border-line2 px-1.5">
        <AppPuck app={connector.id} color={connector.brandColor} size={14} />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[11px] font-semibold uppercase tracking-wide text-t3">{connector.label}</span>
        <span className="tabular font-mono text-[10px] text-t3">{count}</span>
        <Grip controls={controls} label={`Drag to reorder the ${connector.label} section`} />
      </div>
      <div className="pt-1">{children}</div>
    </Reorder.Item>
  );
}

/** One connection inside a section — draggable by the grip in its header. */
function ConnectionItem({ id, children }: { id: string; children: (controls: DragControls) => React.ReactNode }) {
  const controls = useDragControls();
  return (
    <Reorder.Item as="div" value={id} dragListener={false} dragControls={controls} layout className="relative rounded-row bg-sidebar">
      {children(controls)}
    </Reorder.Item>
  );
}

function ConnectionTree({
  connection,
  groups,
  status,
  syncing,
  busy,
  onSync,
  openFolder,
  onToggleFolder,
  expanded,
  onToggle,
  sevOf,
  changedOf,
  pathname,
  dragControls,
}: {
  connection: Connection;
  groups: NavGroup[];
  status: "loading" | "ready" | "error";
  syncing: boolean;
  /** Something on the same credential is syncing. */
  busy: boolean;
  onSync: () => void;
  openFolder: string | null;
  onToggleFolder: (id: string) => void;
  expanded: boolean;
  onToggle: () => void;
  sevOf: Map<string, Sev>;
  changedOf: Map<string, number>;
  pathname: string;
  dragControls?: DragControls;
}) {
  const connector = getConnector(connection.provider);
  const needsReauth = connection.status === "needs_reauth";
  const total = groups.reduce(
    (n, g) => n + g.items.length + (g.folders ?? []).reduce((m, f) => m + f.items.length, 0),
    0
  );
  return (
    <div className="mb-1.5">
      <div className="group/reorder flex min-h-[27px] items-center gap-[6px] rounded-row px-1.5 py-[3px] transition-[background] duration-[var(--dur-fast)] hover:bg-hover">
        <button
          type="button"
          onClick={onToggle}
          // Frozen mid-sync: the tree under it is being rewritten, so toggling
          // would expand rows that are about to be replaced.
          disabled={syncing}
          aria-expanded={expanded}
          aria-label={
            syncing
              ? `Syncing ${connector.label} · ${connection.displayName}`
              : `${expanded ? "Collapse" : "Expand"} ${connector.label} · ${connection.displayName}`
          }
          className={`flex min-w-0 flex-1 items-center gap-[6px] border-0 bg-transparent p-0 text-left not-disabled:cursor-pointer ${
            syncing ? "cursor-default opacity-60" : ""
          }`}
        >
          <ChevronRight aria-hidden="true" className={`size-[10px] flex-none text-t3 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] ${expanded ? "rotate-90" : ""}`} />
          <AppPuck app={connector.id} color={connector.brandColor} size={15} />
          <span
            className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[11px] font-semibold text-t1"
            title={`${connector.label} · ${connection.displayName}${connection.accountName && connection.label ? ` (${connection.accountName})` : ""} · id ${connection.externalId}`}
          >
            {connector.shortLabel} · {connection.displayName}
          </span>
        </button>
        {needsReauth ? (
          <Link href="/settings/connections" className="flex items-center gap-0.5 text-[10px] font-semibold text-warn-text hover:underline" title="Session expired — reconnect from Settings">
            <TriangleAlert aria-hidden="true" className="size-2.5" />
            reauth
          </Link>
        ) : (
          <button
            type="button"
            onClick={onSync}
            // Locked while ANY connection is syncing, not just this one: only
            // one sync runs at a time, so a live-looking button elsewhere would
            // be a button that silently does nothing.
            disabled={syncing || busy}
            aria-busy={syncing}
            aria-label={
              syncing
                ? `Syncing ${connector.label} ${connection.displayName}`
                : busy
                  ? "Another sub-account on this credential is syncing"
                  : `Sync ${connector.label} ${connection.displayName} now`
            }
            title={
              syncing
                ? "Syncing…"
                : busy
                  ? "Another sub-account on this credential is syncing"
                  : connection.lastSyncedAt
                    ? `Last synced ${new Date(connection.lastSyncedAt).toLocaleString()}`
                    : "Sync now"
            }
            className="group/sync flex items-center gap-1 text-t3 transition-colors hover:text-t1 disabled:cursor-not-allowed disabled:hover:text-t3 not-disabled:cursor-pointer"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-[9px] transition-opacity ${
                syncing ? "spin motion-reduce:animate-none" : "opacity-60 group-hover/sync:opacity-100"
              }`}
            />
            <span aria-hidden="true" className="tabular font-mono text-[9px]">
              {syncing ? "syncing" : total}
            </span>
          </button>
        )}
        {dragControls && <Grip controls={dragControls} label={`Drag to reorder ${connection.displayName}`} />}
      </div>
      <Accordion open={expanded}>
      <div
        className={`ml-[6px] transition-opacity duration-[var(--dur-fast)] ${
          syncing ? "pointer-events-none select-none opacity-50" : ""
        }`}
        aria-busy={syncing || undefined}
      >
      {status === "loading" && total === 0 && (
        <div role="status" aria-label={`Loading ${connector.nouns.workflowPlural}`} className="flex flex-col gap-1 px-1.5 py-0.5">
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden="true" className="h-[20px] animate-pulse rounded-row bg-hover motion-reduce:animate-none" />
          ))}
        </div>
      )}
      {status === "error" && (
        <p className="px-1.5 py-0.5 text-[11px] text-warn-text">
          Couldn’t load.{" "}
          <button type="button" onClick={onSync} className="cursor-pointer underline underline-offset-2 hover:text-t1">
            Retry
          </button>
        </p>
      )}
      {status === "ready" && total === 0 && !syncing && (
        <p className="px-1.5 py-0.5 text-[11px] italic text-t3">
          No {connector.nouns.workflowPlural} synced yet
        </p>
      )}
      {groups.map((g) => (
        <div key={g.id}>
          {groups.length > 1 && (
            <p className="[overflow-wrap:anywhere] px-1.5 pb-0.5 pt-1 font-mono text-[9.5px] text-t3">
              {g.label}
            </p>
          )}
          {(g.folders ?? []).map((f) => (
            <FolderRows
              key={f.id}
              folder={f}
              provider={connection.provider}
              open={openFolder === f.id}
              onToggle={() => onToggleFolder(f.id)}
              sevOf={sevOf}
              changedOf={changedOf}
              pathname={pathname}
            />
          ))}
          {g.items.map((it) => (
            <WorkflowRow key={it.refId} item={it} provider={connection.provider} sevOf={sevOf} changedOf={changedOf} pathname={pathname} indent={false} />
          ))}
        </div>
      ))}
      </div>
      </Accordion>
    </div>
  );
}

const FolderRows = memo(function FolderRows({
  folder,
  provider,
  open,
  onToggle,
  sevOf,
  changedOf,
  pathname,
}: {
  folder: NavFolder;
  provider: ProviderId;
  open: boolean;
  onToggle: () => void;
  sevOf: Map<string, Sev>;
  changedOf: Map<string, number>;
  pathname: string;
}) {
  const sev: Sev = folder.items.some((i) => sevOf.get(`${provider}:${i.refId}`) === "err")
    ? "err"
    : folder.items.some((i) => sevOf.get(`${provider}:${i.refId}`) === "warn")
      ? "warn"
      : null;
  return (
    <div>
      <ClampedRow text={folder.label} label={`Show the full name of folder ${folder.label}`}>
        {(clamp) => (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={`${ROW} min-h-[27px] min-w-0 flex-1 py-[3px]`}
          >
            <ChevronRight
              aria-hidden="true"
              className={`size-[10px] flex-none text-t3 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] ${open ? "rotate-90" : ""}`}
            />
            <span ref={clamp.attach} style={clamp.style} className="min-w-0 flex-1 text-[11.5px] font-medium text-t2">
              {folder.label}
            </span>
            <SevDot sev={sev} />
            <span className="tabular font-mono text-[9px] text-t3">{folder.items.length}</span>
          </button>
        )}
      </ClampedRow>
      <Accordion open={open}>
        <div className="my-px mb-[3px]">
          {folder.items.map((it) => (
            <WorkflowRow key={it.refId} item={it} provider={provider} sevOf={sevOf} changedOf={changedOf} pathname={pathname} indent />
          ))}
        </div>
      </Accordion>
    </div>
  );
});

/**
 * Height-and-fade expand, the one shared accordion in the browser column.
 *
 * `initial={false}` so nothing animates on first paint — a sidebar that
 * unfurls every open folder on load looks broken, not polished.
 *
 * Height is animated to `auto`, which means Motion measures the content each
 * time it opens. That is fine at this scale (a folder is tens of rows, not
 * thousands) and is what keeps the row heights honest when names wrap.
 */
function Accordion({ open, children }: { open: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  // Motion drives height only while the accordion is opening or closing. Once
  // settled we hand height back to the browser ("auto") — otherwise every
  // content change inside an open folder re-runs a height animation, which is
  // what made rows shift and stretch as a sync landed.
  const [animating, setAnimating] = useState(false);
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={
            reduced
              ? { duration: 0 }
              : {
                  // Matches --dur / --ease-out in globals.css, so the sidebar
                  // moves like the rest of the app rather than to its own clock.
                  height: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
                  // Fade slightly faster than the slide, so content is legible
                  // before the row stops moving.
                  opacity: { duration: 0.15, ease: [0.22, 1, 0.36, 1] },
                }
          }
          onAnimationStart={() => setAnimating(true)}
          onAnimationComplete={() => setAnimating(false)}
          style={{
            height: animating || !open ? undefined : "auto",
            overflow: animating || !open ? "hidden" : "visible",
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const WorkflowRow = memo(function WorkflowRow({
  item,
  provider,
  sevOf,
  changedOf,
  pathname,
  indent,
}: {
  item: NavItem;
  provider: ProviderId;
  sevOf: Map<string, Sev>;
  changedOf: Map<string, number>;
  pathname: string;
  indent: boolean;
}) {
  const href = workflowHref({ source: provider, refId: item.refId });
  const active = pathname === href;
  return (
    <ClampedRow text={item.name} label={`Show the full name of ${item.name}`}>
      {(clamp) => (
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={`${ROW} min-h-[26px] min-w-0 flex-1 py-[3px] ${indent ? "pl-[22px]" : ""} ${active ? "bg-hover" : ""}`}
        >
          <StatusDot item={item} />
          <span ref={clamp.attach} style={clamp.style} className={`min-w-0 flex-1 text-[11px] ${active ? "font-medium text-t1" : "text-t2"}`}>
            {item.name}
          </span>
          <ChangeCount n={changedOf.get(`${provider}:${item.refId}`)} />
          <SevDot sev={sevOf.get(`${provider}:${item.refId}`) ?? null} />
        </Link>
      )}
    </ClampedRow>
  );
});
