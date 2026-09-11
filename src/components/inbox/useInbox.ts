"use client";

import { useEffect, useMemo, useState } from "react";
import { Comment, fetchMentions, Issue, WorkflowCard } from "@/app/lib/api";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { issueRunId, runReplayHref } from "@/lib/workflowMap/run";

/*
 * "Needs you" = what is actually broken (error-severity issues), what
 * changed since you last looked, and open threads that mention you. All
 * composed from data we already have (link map) + one mentions query. A
 * failed run that names its execution (Make) opens the canvas replaying it
 * (?run=, plus ?step= for the failing step) instead of the step alone.
 */
export interface InboxItem {
  key: string;
  card: WorkflowCard | null;
  provider: string;
  refId: string;
  reason: string;
  action: string;
  href: string;
  when?: string | null;
  /** Comment target for mention items (drives the thread on the right). */
  targetKey?: string;
  /** Error-severity issues for broken items. */
  issues?: Issue[];
  group: "broken" | "changed" | "mentions";
}

export function useInbox() {
  const { linkMap, loading } = useConnections();
  const [mentions, setMentions] = useState<Comment[] | null>(null);
  const [mentionsError, setMentionsError] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMentions()
      .then((d) => live && setMentions(d.comments))
      .catch(() => live && setMentionsError(true));
    return () => {
      live = false;
    };
  }, []);

  return useMemo(() => {
    const cards = new Map<string, WorkflowCard>();
    for (const w of linkMap?.workflows ?? []) cards.set(`${w.source}:${w.refId}`, w);

    // Broken: error-severity issues, one row per workflow (worst message).
    const brokenBy = new Map<string, Issue[]>();
    for (const i of linkMap?.issues ?? []) {
      if (i.severity !== "error") continue;
      const k = `${i.provider}:${i.workflowExternalId}`;
      brokenBy.set(k, [...(brokenBy.get(k) ?? []), i]);
    }
    const broken: InboxItem[] = [...brokenBy.entries()].map(([k, issues]) => {
      const [provider, refId] = k.split(":");
      const first = issues[0];
      const extra = issues.length - 1;
      const runId = issueRunId(first);
      return {
        key: `b:${k}`,
        card: cards.get(k) ?? null,
        provider,
        refId,
        reason: `${first.message}${extra > 0 ? ` · +${extra} more` : ""}`,
        action: runId ? "Replay on map" : first.code === "last-run-failed" ? "See failing step" : first.code.startsWith("dead") || first.code.includes("link") ? "Trace link" : "Open",
        href: runId ? runReplayHref(provider, refId, runId, first.nodeId) : `/w/${provider}/${refId}${first.nodeId != null ? `?step=${encodeURIComponent(String(first.nodeId))}` : ""}`,
        issues,
        group: "broken" as const,
      };
    });

    const changed: InboxItem[] = (linkMap?.workflows ?? [])
      .filter((w) => (w.changedSince?.count ?? 0) > 0)
      .sort((a, b) => (b.changedSince?.at ?? "").localeCompare(a.changedSince?.at ?? ""))
      .map((w) => ({
        key: `c:${w.source}:${w.refId}`,
        card: w,
        provider: w.source,
        refId: w.refId,
        reason: `${w.changedSince!.count} change${w.changedSince!.count === 1 ? "" : "s"} since you last looked`,
        action: `Review ${w.changedSince!.count} change${w.changedSince!.count === 1 ? "" : "s"}`,
        href: `/w/${w.source}/${w.refId}`,
        when: w.changedSince!.at,
        group: "changed" as const,
      }));

    const threads: InboxItem[] = (mentions ?? []).map((c) => {
      const parts = c.targetKey.split(":");
      const provider = c.targetKey.startsWith("issue:") ? parts[2] : parts[1];
      const refId = c.targetKey.startsWith("issue:") ? parts[3] : parts[2];
      const node = c.targetKey.startsWith("node:") ? parts[3] : c.targetKey.startsWith("issue:") ? parts[4] : null;
      const k = `${provider}:${refId}`;
      return {
        key: `m:${c.id}`,
        card: cards.get(k) ?? null,
        provider,
        refId,
        reason: `${c.authorName ?? "Someone"}: “${c.body}”`,
        action: c.parentId ? "Open thread" : "Reply",
        href: `/w/${provider}/${refId}${node && node !== "-" ? `?step=${encodeURIComponent(node)}` : ""}`,
        when: c.createdAt,
        targetKey: c.targetKey,
        group: "mentions" as const,
      };
    });

    const all = [...broken, ...changed, ...threads];
    return { broken, changed, threads, all, loading: loading && !linkMap, mentionsLoading: mentions === null && !mentionsError, total: all.length };
  }, [linkMap, loading, mentions, mentionsError]);
}
