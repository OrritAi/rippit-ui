"use client";

import { useCallback, useEffect, useState } from "react";
import { Comment, fetchMentions, fetchNotifications, NotificationItem } from "@/app/lib/api";

/* Small shared loaders for the side panels and their detail views. */

export function useNotifications() {
  const [data, setData] = useState<{ unread: number; notifications: NotificationItem[] } | null>(null);
  const [error, setError] = useState("");
  const [gen, setGen] = useState(0);
  useEffect(() => {
    let live = true;
    fetchNotifications()
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    const on = () => setGen((g) => g + 1);
    window.addEventListener("orrit:notifications", on);
    return () => {
      live = false;
      window.removeEventListener("orrit:notifications", on);
    };
  }, [gen]);
  const reload = useCallback(() => setGen((g) => g + 1), []);
  return { data, error, reload };
}

export function useMentions() {
  const [data, setData] = useState<{ comments: Comment[] } | null>(null);
  const [error, setError] = useState("");
  const [gen, setGen] = useState(0);
  useEffect(() => {
    let live = true;
    fetchMentions()
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    const on = () => setGen((g) => g + 1);
    window.addEventListener("orrit:comments", on);
    return () => {
      live = false;
      window.removeEventListener("orrit:comments", on);
    };
  }, [gen]);
  const reload = useCallback(() => setGen((g) => g + 1), []);
  return { data, error, reload };
}
