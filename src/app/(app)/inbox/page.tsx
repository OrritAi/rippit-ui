"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AtSign, History, Unplug, type LucideIcon } from "lucide-react";
import { DetailCard, DetailHeader } from "@/components/views/DetailFrame";
import { CommentsThread } from "@/components/shared/CommentsSection";
import { ChangesBody } from "@/components/shared/ChangesPanel";
import { IssuesSection } from "@/components/shared/IssuesSection";
import { isProviderId as isPid } from "@/lib/connectors";
import { useInbox, type InboxItem } from "@/components/inbox/useInbox";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { AppPuck } from "@/components/shared/AppPuck";
import { CONNECTORS, isProviderId } from "@/lib/connectors";
import { relativeTime } from "@/components/shared/RunsPanel";
import { RowCard, ViewBar, ViewBody, ViewTitle } from "@/components/views/ViewFrame";

/* Needs you — triage: broken · changed since you looked · mentions. */
export default function InboxPage() {
  const { broken, changed, threads, all, loading, total } = useInbox();
  const { connections, loading: connLoading } = useConnections();
  const itemKey = useSearchParams().get("item");
  const item = itemKey ? all.find((i) => i.key === itemKey) ?? null : null;

  useEffect(() => {
    document.title = "Needs you — Rippit";
  }, []);

  if (itemKey) {
    const conn = item && isPid(item.provider) ? CONNECTORS[item.provider] : null;
    const groupLabel = item?.group === "broken" ? "Broken" : item?.group === "changed" ? "Changed since you looked" : "Mentions & open threads";
    return (
      <div className="flex h-full min-w-0 flex-col">
        <ViewBar title="Needs you" />
        <ViewBody>
          {!item ? (
            <p className="text-[13px] text-t3">{loading ? "Loading…" : "This item is no longer waiting on you."}</p>
          ) : (
            <div key={item.key}>
              <DetailHeader
                backHref="/inbox"
                backLabel="all items"
                leading={<AppPuck app={conn?.id ?? item.provider} color={conn?.brandColor} size={34} />}
                title={item.card?.name ?? `${conn?.shortLabel ?? item.provider} ${item.refId}`}
                sub={`${groupLabel} · ${conn?.shortLabel ?? item.provider}${item.when ? ` · ${relativeTime(item.when)}` : ""}`}
                openHref={item.href}
                openLabel={item.action}
              />
              <DetailCard title="Why it needs you">
                <p className="m-0 text-[13px] leading-[1.6] text-t1">{item.reason}</p>
              </DetailCard>
              {item.group === "broken" && item.issues && isPid(item.provider) && (
                <DetailCard>
                  <IssuesSection issues={item.issues} />
                  <p className="m-0 text-[11.5px] text-t3">Each issue links to the failing step from the canvas — open it above.</p>
                </DetailCard>
              )}
              {item.group === "changed" && isPid(item.provider) && (
                <DetailCard title="Changes">
                  <div className="-mx-3.5 -my-3 flex flex-col">
                    <ChangesBody provider={item.provider} externalId={item.refId} />
                  </div>
                </DetailCard>
              )}
              {item.group === "mentions" && item.targetKey && (
                <DetailCard title="Thread">
                  <CommentsThread targetType={item.targetKey.startsWith("node:") ? "node" : item.targetKey.startsWith("issue:") ? "issue" : "workflow"} targetKey={item.targetKey} onCountChange={() => window.dispatchEvent(new Event("rippit:comments"))} />
                </DetailCard>
              )}
            </div>
          )}
        </ViewBody>
      </div>
    );
  }

  const groups: { label: string; icon: LucideIcon; sev: "err" | "warn" | null; blurb: string; items: InboxItem[] }[] = [
    { label: "Broken", icon: Unplug, sev: "err", blurb: "Dead cross-links, missing targets and failed runs — data may have silently stopped flowing.", items: broken },
    { label: "Changed since you looked", icon: History, sev: "warn", blurb: "Edits Rippit detected at sync that you haven't reviewed yet.", items: changed },
    { label: "Mentions & open threads", icon: AtSign, sev: null, blurb: "Comments waiting on you.", items: threads },
  ];

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="Needs you" meta={!loading ? `${total} item${total === 1 ? "" : "s"}` : undefined} />
      <ViewBody width={620}>
        <ViewTitle title="Needs you" sub={loading ? "checking the estate…" : total === 0 ? "nothing waiting · everything else is running clean" : `${total} item${total === 1 ? "" : "s"} · everything else is running clean`} />
        {!connLoading && connections.length === 0 && (
          <RowCard>
            <p className="px-4 py-6 text-center text-[13px] text-t2">
              Nothing connected yet.{" "}
              <Link href="/settings/connections" className="font-semibold text-t1 underline-offset-4 hover:underline">
                Connect a platform
              </Link>{" "}
              and broken links, changes and mentions land here.
            </p>
          </RowCard>
        )}
        {connections.length > 0 &&
          groups.map((g, gi) => {
            const Icon = g.icon;
            const color = g.sev === "err" ? "var(--err-text)" : g.sev === "warn" ? "var(--warn-text)" : "var(--t3)";
            const bar = g.sev === "err" ? "var(--err)" : g.sev === "warn" ? "var(--warn)" : "var(--line-strong)";
            return (
              <section key={g.label} aria-label={g.label} className="mb-4 anim-fade-up" style={{ animationDelay: `${gi * 0.07}s` }}>
                <div className="mb-[3px] flex items-center gap-[7px]">
                  <span className="inline-flex" style={{ color }}>
                    <Icon aria-hidden="true" className="size-[13px]" />
                  </span>
                  <h3 className="m-0 text-[13px] font-semibold">{g.label}</h3>
                  <span className="tabular font-mono text-[10px] text-t3">{g.items.length}</span>
                </div>
                <p className="mb-2 ml-5 mt-0 text-[11px] text-t3">{g.blurb}</p>
                <RowCard>
                  {g.items.length === 0 && <p className="px-3.5 py-3 text-[12px] italic text-t3">{loading ? "Loading…" : "Nothing here."}</p>}
                  {g.items.map((it) => {
                    const conn = isProviderId(it.provider) ? CONNECTORS[it.provider] : null;
                    return (
                      <div key={it.key} className="flex items-center gap-2.5 border-b border-line2 px-[13px] py-2.5 last:border-b-0">
                        <span aria-hidden="true" className="h-9 w-[6px] flex-none rounded-[3px]" style={{ background: bar }} />
                        <AppPuck app={conn?.id ?? it.provider} color={conn?.brandColor} size={22} />
                        <span className="min-w-0 flex-1">
                          <span className="block [overflow-wrap:anywhere] text-[12.5px] font-semibold text-t1">{it.card?.name ?? `${conn?.shortLabel ?? it.provider} ${it.refId}`}</span>
                          <span className="mt-[1px] block text-[11px] leading-[1.45] text-t2">
                            {it.reason}
                            {it.when ? <span className="text-t3"> · {relativeTime(it.when)}</span> : null}
                          </span>
                        </span>
                        <Link href={it.href} className="inline-flex h-[26px] flex-none items-center rounded-control border border-line-strong px-2.5 text-[12px] font-semibold text-t2 transition-colors hover:border-t1 hover:text-t1">
                          {it.action}
                        </Link>
                      </div>
                    );
                  })}
                </RowCard>
              </section>
            );
          })}
      </ViewBody>
    </div>
  );
}
