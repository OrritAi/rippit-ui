"use client";

import { useSearchParams } from "next/navigation";
import { AtSign, History, Unplug } from "lucide-react";
import { useInbox } from "@/components/inbox/useInbox";
import { relativeTime } from "@/components/shared/RunsPanel";
import { ListRow, PanelEmpty, PanelSection, PanelSkeleton } from "./ListRow";

/* Needs-you side panel: the items, grouped; clicking shows the item on the right. */
export function InboxPanel() {
  const { broken, changed, threads, loading, mentionsLoading } = useInbox();
  const sp = useSearchParams();
  const active = sp.get("item");
  const groups = [
    { title: "Broken", icon: Unplug, tone: "err" as const, items: broken },
    { title: "Changed", icon: History, tone: "warn" as const, items: changed },
    { title: "Mentions", icon: AtSign, tone: null, items: threads },
  ];
  if (loading) return <PanelSkeleton />;
  return (
    <div className="thin-scroll stagger min-h-0 flex-1 overflow-y-auto p-[7px]">
      {groups.map((g) => (
        <PanelSection key={g.title} title={g.title} count={g.items.length}>
          {g.items.length === 0 && <PanelEmpty>{g.title === "Mentions" && mentionsLoading ? "Loading…" : "Nothing here"}</PanelEmpty>}
          {g.items.map((it) => (
            <ListRow
              key={it.key}
              href={`/inbox?item=${encodeURIComponent(it.key)}`}
              active={active === it.key}
              icon={g.icon}
              tone={g.tone}
              title={it.card?.name ?? `${it.provider} ${it.refId}`}
              sub={`${it.reason}${it.when ? ` · ${relativeTime(it.when)}` : ""}`}
            />
          ))}
        </PanelSection>
      ))}
    </div>
  );
}

export function useInboxCount(): string {
  const { total, loading } = useInbox();
  return loading ? "…" : String(total);
}
