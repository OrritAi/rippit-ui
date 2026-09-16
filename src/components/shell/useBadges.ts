"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchBadges } from "@/app/lib/api";
import { useConnections } from "@/components/app/ConnectionsProvider";

/*
 * Rail badge counts. Needs-you is derived from the link map already in
 * memory (error-severity issues + workflows changed since you last looked);
 * unread notifications poll every 60 s; mentions poll the same way once
 * the API exposes them.
 */
export interface Badges {
  needsYou: number;
  unread: number;
  mentions: number;
}

const POLL_MS = 60_000;

export function useBadges(): Badges {
  const { linkMap, connections } = useConnections();
  const [unread, setUnread] = useState(0);
  const [mentions, setMentions] = useState(0);

  useEffect(() => {
    if (connections.length === 0) return;
    let live = true;
    const load = () => {
      fetchBadges()
        .then((d) => {
          if (!live) return;
          setUnread(d.unread);
          setMentions(d.mentions);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("orrit:notifications", load);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("orrit:notifications", load);
    };
  }, [connections.length]);

  const needsYou = useMemo(() => {
    if (!linkMap) return 0;
    const broken = (linkMap.issues ?? []).filter((i) => i.severity === "error").length;
    const changed = linkMap.workflows.filter((w) => (w.changedSince?.count ?? 0) > 0).length;
    return broken + changed;
  }, [linkMap]);

  return { needsYou, unread, mentions };
}
