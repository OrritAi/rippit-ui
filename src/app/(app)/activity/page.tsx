"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ActivityItem, fetchActivity, fetchNotifications, markNotificationsRead, NotificationItem } from "@/app/lib/api";
import { Segmented } from "@/components/shared/Segmented";
import { ViewBar, ViewBody, ViewTitle } from "@/components/views/ViewFrame";
import { FeedList, activityRow, describeActivity, hrefForTarget } from "@/components/feed/FeedList";
import { DetailCard, DetailHeader } from "@/components/views/DetailFrame";
import { KvRow } from "@/components/shared/DetailPanelKit";
import { CommentsThread } from "@/components/shared/CommentsSection";
import { relativeTime } from "@/components/shared/RunsPanel";
import { useNotifications } from "@/components/feed/useFeeds";

/* One notification, shown in the main area when picked in the side panel. */
function NotificationDetail({ id }: { id: string }) {
  const { data } = useNotifications();
  const n = data?.notifications.find((x) => String(x.id) === id) ?? null;
  useEffect(() => {
    if (!n || n.readAt) return;
    markNotificationsRead([n.id])
      .then(() => window.dispatchEvent(new Event("rippit:notifications")))
      .catch(() => {});
  }, [n]);
  if (!data) return <p className="text-[13px] text-t3">Loading…</p>;
  if (!n) return <p className="text-[13px] text-t3">This notification is gone.</p>;
  const a = n.activity;
  const p = a.payload as Record<string, unknown>;
  const row = activityRow(a);
  const Icon = row.icon;
  const href = hrefForTarget(a.targetKey);
  const isComment = a.kind === "comment.created" && a.targetKey;
  return (
    <div key={n.id}>
      <DetailHeader
        backHref="/activity"
        backLabel="all notifications"
        leading={
          <span className="inline-flex size-[34px] flex-none items-center justify-center rounded-control border border-line bg-hover" style={{ color: row.tone === "err" ? "var(--err-text)" : row.tone === "warn" ? "var(--warn-text)" : "var(--t2)" }}>
            <Icon aria-hidden="true" className="size-4" />
          </span>
        }
        title={`${a.actorName ?? "Rippit"} ${describeActivity(a)}`}
        sub={`${a.kind} · ${relativeTime(a.createdAt)}${n.readAt ? "" : " · unread"}`}
        openHref={href}
        openLabel="Open workflow"
      />
      <DetailCard title="Details">
        <div className="flex flex-col">
          {typeof p.workflowName === "string" && <KvRow k="Workflow" v={p.workflowName} />}
          {a.targetKey && <KvRow k="Target" v={a.targetKey} />}
          {p.count !== undefined && <KvRow k="Changes" v={String(p.count)} />}
          {p.version !== undefined && <KvRow k="Sync" v={`#${p.version}`} />}
          {typeof p.excerpt === "string" && <KvRow k="Comment" v={p.excerpt} />}
          {Array.isArray(p.tags) && <KvRow k="Tags" v={(p.tags as string[]).join(", ")} />}
          {typeof p.error === "string" && <KvRow k="Error" v={p.error} />}
          {typeof p.provider === "string" && <KvRow k="Platform" v={`${p.provider} ${String(p.label ?? p.externalId ?? "")}`} />}
          <KvRow k="When" v={new Date(a.createdAt).toLocaleString()} />
        </div>
      </DetailCard>
      {isComment && (
        <DetailCard title="Thread">
          <CommentsThread targetType={a.targetKey!.startsWith("node:") ? "node" : a.targetKey!.startsWith("issue:") ? "issue" : "workflow"} targetKey={a.targetKey!} onCountChange={() => window.dispatchEvent(new Event("rippit:comments"))} />
        </DetailCard>
      )}
    </div>
  );
}

/*
 * Notifications: your inbox (mentions, watched/owned workflows) plus the
 * workspace feed (Everything / Mine / Watched).
 */
type Mode = "inbox" | "all" | "mine" | "watched";

export default function ActivityPage() {
  const selected = useSearchParams().get("n");
  const [mode, setMode] = useState<Mode>("inbox");
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [inbox, setInbox] = useState<{ unread: number; notifications: NotificationItem[] } | null>(null);
  const [error, setError] = useState("");
  const [gen, setGen] = useState(0);

  useEffect(() => {
    document.title = "Notifications — Rippit";
  }, []);

  useEffect(() => {
    let live = true;
    const p = mode === "inbox" ? fetchNotifications().then((d) => live && setInbox(d)) : fetchActivity({ mine: mode === "mine", watched: mode === "watched", limit: 200 }).then((d) => live && setActivity(d.activity));
    p.then(() => live && setError("")).catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [mode, gen]);

  const unread = inbox?.unread ?? 0;
  const rows = useMemo(
    () => (mode === "inbox" ? (inbox?.notifications ?? []).map((n) => ({ ...activityRow(n.activity, !n.readAt), key: `n${n.id}` })) : (activity ?? []).map((a) => activityRow(a))),
    [mode, inbox, activity]
  );
  const loading = mode === "inbox" ? !inbox : !activity;

  if (selected) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <ViewBar title="Notifications" />
        <ViewBody>
          <NotificationDetail id={selected} />
        </ViewBody>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="Notifications" meta={unread > 0 ? `${unread} unread` : undefined}>
        <Segmented
          label="Scope"
          value={mode}
          options={[
            { value: "inbox", label: unread > 0 ? `Inbox (${unread})` : "Inbox" },
            { value: "all", label: "Everything" },
            { value: "mine", label: "Mine" },
            { value: "watched", label: "Watched" },
          ]}
          onChange={setMode}
        />
        {mode === "inbox" && unread > 0 && (
          <button
            type="button"
            onClick={() =>
              markNotificationsRead()
                .then(() => {
                  setGen((g) => g + 1);
                  window.dispatchEvent(new Event("rippit:notifications"));
                })
                .catch(() => {})
            }
            className="h-[26px] cursor-pointer rounded-control border border-line-strong px-2.5 text-[12px] font-semibold text-t2 transition-colors hover:text-t1"
          >
            Mark all read
          </button>
        )}
      </ViewBar>
      <ViewBody width={600}>
        <ViewTitle title={mode === "inbox" ? "Inbox" : mode === "all" ? "Everything" : mode === "mine" ? "Mine" : "Watched"} sub={mode === "inbox" ? "mentions · watched and owned workflows · failed runs" : "organization activity, newest first"} />
        {error && (
          <p role="alert" className="mb-3 text-[13px] text-err-text">
            {error}
          </p>
        )}
        {loading && !error ? (
          <div role="status" className="flex flex-col gap-2" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} aria-hidden="true" className="h-[52px] animate-pulse rounded-card bg-hover motion-reduce:animate-none" />
            ))}
          </div>
        ) : (
          <FeedList
            rows={rows}
            empty={
              mode === "inbox"
                ? "Nothing for you yet — you're notified when someone @mentions you, and for changes, comments and failed runs on workflows you watch or own."
                : "No activity yet. Syncs that detect changes, comments, tags, owners and connections show up here."
            }
          />
        )}
      </ViewBody>
    </div>
  );
}
