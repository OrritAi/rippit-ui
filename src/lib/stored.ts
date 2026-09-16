"use client";

import type { ProviderId } from "@/lib/connectors/types";

import { useCallback, useSyncExternalStore } from "react";

/*
 * Hydration-safe localStorage readers. Snapshots are cached per raw string
 * so useSyncExternalStore gets a stable reference; writers notify every
 * subscriber (same tab) and `storage` events cover other tabs.
 */
const cache = new Map<string, { raw: string | null; value: unknown }>();
const subs = new Map<string, Set<() => void>>();

function notify(key: string) {
  subs.get(key)?.forEach((l) => l());
}

export function readStored<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    raw = null;
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

export function writeStored<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
  notify(key);
}

/** Read a JSON value from localStorage; re-renders on writes (same tab) and storage events. */
export function useStoredJson<T>(key: string, fallback: T, extraEvents: string[] = []): T {
  const subscribe = useCallback(
    (l: () => void) => {
      let set = subs.get(key);
      if (!set) subs.set(key, (set = new Set()));
      set.add(l);
      const onStorage = (e: StorageEvent) => e.key === key && l();
      window.addEventListener("storage", onStorage);
      extraEvents.forEach((ev) => window.addEventListener(ev, l));
      return () => {
        set!.delete(l);
        window.removeEventListener("storage", onStorage);
        extraEvents.forEach((ev) => window.removeEventListener(ev, l));
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, extraEvents.join("|")]
  );
  return useSyncExternalStore(subscribe, () => readStored(key, fallback), () => fallback);
}

/** True after hydration (false during SSR / first client render). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export interface RecentEntry {
  provider: ProviderId;
  id: string;
  name: string;
  at: number;
}
const EMPTY_RECENT: RecentEntry[] = [];
export function useRecentWorkflows(): RecentEntry[] {
  return useStoredJson<RecentEntry[]>("orrit.recent", EMPTY_RECENT, ["orrit:recent"]);
}
