"use client";

import { useCallback, useSyncExternalStore } from "react";
import { fetchWorkflowSummaries, type ScenarioSummary } from "@/app/lib/api";
import { SUMMARY_LRU_MAX } from "./tokens";
import type { SummaryEntry, WorkflowKey } from "./types";

/*
 * Summary store for the workflow map.
 *
 * One module-level `Map<WorkflowKey, SummaryEntry>` (LRU, 200 entries) that
 * survives navigation, plus an in-flight set so a key is never requested
 * twice. `ensure(keys)` marks the missing keys as loading and batches every
 * call made in the same tick — one `queueMicrotask` — into a single
 * `fetchWorkflowSummaries` (which chunks at 40). Results land as `ok` or
 * `error` entries and bump `version`; consumers key their `useMemo` on it.
 *
 * The viewed workflow is *seeded* from `connector.loadWorkflow` (the page
 * already has it) and pinned so the LRU never drops it; it is never fetched
 * through this store. `reseed` replaces it after a refresh and evicts every
 * neighbour so the next build re-requests them.
 *
 * Usage:
 *   const store = useSummaryStore(seed);                // seed = {key, summary} | null
 *   const model = useMemo(() => buildMap({ summaries: store.summaries, … }), [store.version, …]);
 *   useEffect(() => store.ensure(model.wanted), [model.wanted, store]);
 */

export interface SummarySeed {
  key: WorkflowKey;
  summary: ScenarioSummary;
}

export interface SummaryStore {
  /** Live view of the cache. Same object every render — read it under `version`. */
  summaries: ReadonlyMap<WorkflowKey, SummaryEntry>;
  /** Changes whenever an entry lands, is evicted or is reseeded. */
  version: number;
  /** Request whatever is missing. Present, loading and in-flight keys are skipped. */
  ensure: (keys: Iterable<WorkflowKey>) => void;
  /** Replace the viewed summary (after a refresh) and evict every neighbour. */
  reseed: (seed: SummarySeed) => void;
  /** Drop every entry except the pinned seed (and `keep`). */
  evictNeighbours: (keep?: Iterable<WorkflowKey>) => void;
  /** Forget specific entries so the next `ensure` refetches them (retry). */
  invalidate: (keys: Iterable<WorkflowKey>) => void;
}

/* ── module state ─────────────────────────────────────────────────────── */

const cache = new Map<WorkflowKey, SummaryEntry>();
const inflight = new Set<WorkflowKey>();
let pinned: WorkflowKey | null = null;
let seeded: ScenarioSummary | null = null;
let pending: WorkflowKey[] = [];
let flushQueued = false;
let version = 0;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const getVersion = () => version;

function emit() {
  version++;
  for (const l of listeners) l();
}

/** Insert (or move to the tail) and trim the oldest entries past the cap. */
function put(key: WorkflowKey, entry: SummaryEntry) {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size <= SUMMARY_LRU_MAX) return;
  for (const k of cache.keys()) {
    if (cache.size <= SUMMARY_LRU_MAX) break;
    if (k === pinned || inflight.has(k)) continue;
    cache.delete(k);
  }
}

function touch(key: WorkflowKey) {
  const e = cache.get(key);
  if (e) {
    cache.delete(key);
    cache.set(key, e);
  }
}

/** Seed synchronously (called during render — idempotent, never emits, so no
 *  other subscriber is notified mid-render; they read the new version on
 *  their own next render). */
function seedNow(seed: SummarySeed) {
  if (seeded === seed.summary && pinned === seed.key) return;
  seeded = seed.summary;
  pinned = seed.key;
  inflight.delete(seed.key);
  put(seed.key, { state: "ok", summary: seed.summary });
  version++;
}

async function flush() {
  flushQueued = false;
  const keys = pending;
  pending = [];
  if (keys.length === 0) return;
  try {
    const { summaries } = await fetchWorkflowSummaries(keys);
    for (const k of keys) {
      inflight.delete(k);
      const r = summaries[k];
      if (!r) put(k, { state: "error", error: "not-synced" });
      else if ("error" in r && typeof r.error === "string")
        put(k, { state: "error", error: r.error, stepsUnavailable: r.stepsUnavailable });
      else put(k, { state: "ok", summary: r as ScenarioSummary });
    }
  } catch {
    /* Network / auth failure: settle every key so pills stop spinning;
       `invalidate` lets the caller retry. */
    for (const k of keys) {
      inflight.delete(k);
      put(k, { state: "error", error: "fetch-failed" });
    }
  }
  emit();
}

/** Plain-function form of `ensure` for code outside React (palette, tests). */
export function ensureSummaries(keys: Iterable<WorkflowKey>) {
  for (const k of keys) {
    if (inflight.has(k)) continue;
    const e = cache.get(k);
    if (e && e.state !== "loading") {
      touch(k);
      continue;
    }
    cache.set(k, { state: "loading" });
    inflight.add(k);
    pending.push(k);
  }
  if (pending.length > 0 && !flushQueued) {
    flushQueued = true;
    queueMicrotask(() => {
      void flush();
    });
  }
}

function evictAllExcept(keep: Set<WorkflowKey>) {
  for (const k of [...cache.keys()]) {
    if (k === pinned || keep.has(k) || inflight.has(k)) continue;
    cache.delete(k);
  }
}

/** Test/dev only: wipe everything (the harness stub calls this on mount). */
export function resetSummaryStore() {
  cache.clear();
  inflight.clear();
  pending = [];
  pinned = null;
  seeded = null;
  emit();
}

/** Dev harness: preload entries without a network (see /w/preview). */
export function primeSummaryStore(entries: Iterable<[WorkflowKey, SummaryEntry]>) {
  for (const [k, e] of entries) put(k, e);
  emit();
}

/* ── hook ─────────────────────────────────────────────────────────────── */

export function useSummaryStore(seed: SummarySeed | null): SummaryStore {
  /* Seed before reading the snapshot so the very first model build already
     holds the viewed summary and never asks the network for it. */
  if (seed) seedNow(seed);
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);

  const ensure = useCallback((keys: Iterable<WorkflowKey>) => ensureSummaries(keys), []);

  const reseed = useCallback((next: SummarySeed) => {
    seedNow(next);
    evictAllExcept(new Set());
    emit();
  }, []);

  const evictNeighbours = useCallback((keep?: Iterable<WorkflowKey>) => {
    evictAllExcept(new Set(keep ?? []));
    emit();
  }, []);

  const invalidate = useCallback((keys: Iterable<WorkflowKey>) => {
    let changed = false;
    for (const k of keys) {
      if (k === pinned || inflight.has(k)) continue;
      changed = cache.delete(k) || changed;
    }
    if (changed) emit();
  }, []);

  return { summaries: cache, version: v, ensure, reseed, evictNeighbours, invalidate };
}
