"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AtSign, MessageSquare } from "lucide-react";
import { ViewBar, ViewBody, ViewTitle } from "@/components/views/ViewFrame";
import { FeedList, hrefForTarget, type FeedRow } from "@/components/feed/FeedList";
import { DetailCard, DetailHeader } from "@/components/views/DetailFrame";
import { CommentsThread } from "@/components/shared/CommentsSection";
import { relativeTime } from "@/components/shared/RunsPanel";
import { useMentions } from "@/components/feed/useFeeds";

/* Mentions & comments — open threads that @mention you, newest first. */
export default function MentionsPage() {
  const { data, error } = useMentions();
  const selected = useSearchParams().get("c");

  useEffect(() => {
    document.title = "Mentions — Orrit";
  }, []);

  const rows = useMemo<FeedRow[]>(
    () =>
      (data?.comments ?? []).map((c) => ({
        key: c.id,
        icon: c.parentId ? MessageSquare : AtSign,
        who: c.authorName ?? "Someone",
        text: c.body,
        sub: c.targetKey.replace(/^(wf|node|issue):/, "").replace(/:/g, " / "),
        when: c.createdAt,
        href: hrefForTarget(c.targetKey),
        unread: false,
      })),
    [data]
  );

  if (selected) {
    const c = data?.comments.find((x) => x.id === selected) ?? null;
    const type = c?.targetKey.startsWith("node:") ? "node" : c?.targetKey.startsWith("issue:") ? "issue" : "workflow";
    return (
      <div className="flex h-full min-w-0 flex-col">
        <ViewBar title="Mentions & comments" />
        <ViewBody>
          {!data ? (
            <p className="text-[13px] text-t3">Loading…</p>
          ) : !c ? (
            <p className="text-[13px] text-t3">This thread no longer mentions you, or was resolved.</p>
          ) : (
            <div key={c.id}>
              <DetailHeader
                backHref="/mentions"
                backLabel="all mentions"
                leading={
                  <span className="inline-flex size-[34px] flex-none items-center justify-center rounded-control border border-line bg-hover text-t2">
                    {c.parentId ? <MessageSquare aria-hidden="true" className="size-4" /> : <AtSign aria-hidden="true" className="size-4" />}
                  </span>
                }
                title={`${c.authorName ?? "Someone"} mentioned you`}
                sub={`${c.targetKey.replace(/^(wf|node|issue):/, "").replace(/:/g, " / ")} · ${relativeTime(c.createdAt)}`}
                openHref={hrefForTarget(c.targetKey)}
              />
              <DetailCard title="Thread">
                <CommentsThread targetType={type} targetKey={c.targetKey} onCountChange={() => window.dispatchEvent(new Event("orrit:comments"))} />
              </DetailCard>
            </div>
          )}
        </ViewBody>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="Mentions & comments" meta={data ? `${rows.length} open` : undefined} />
      <ViewBody width={600}>
        <ViewTitle title="Mentions & comments" sub="open threads that @mention you · click to reply in context" />
        {error && (
          <p role="alert" className="mb-3 text-[13px] text-err-text">
            {error}
          </p>
        )}
        {!data && !error ? (
          <div role="status" className="flex flex-col gap-2" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <div key={i} aria-hidden="true" className="h-[52px] animate-pulse rounded-card bg-hover motion-reduce:animate-none" />
            ))}
          </div>
        ) : (
          <FeedList rows={rows} empty="No open threads mention you. Teammates can @mention you in any workflow or step comment." />
        )}
      </ViewBody>
    </div>
  );
}
