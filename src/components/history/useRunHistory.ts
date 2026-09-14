"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, fetchExecutions, fetchRuns, RUNS_MAX_LIMIT, type RunRow, type RunStatus } from "@/app/lib/api";
import type { ProviderId } from "@/lib/connectors/types";
import { executionToRow, RUN_STATUSES } from "@/lib/triage";

/*
 * One workflow's whole run history, fetched once and shared by both places
 * that show it: the list at level 1 and the switcher dropdown at level 2.
 *
 * Sharing it is not just deduplication — it is what makes the two agree. The
 * chips filter identically in both because they are literally the same
 * counts, and switching level never re-fetches, so the dropdown opens
 * instantly over a canvas that is already drawn.
 *
 * Every row comes up front. The history is scoped to one workflow and bounded
 * by execution retention, so three cursor pages hold all of it — and holding
 * it in memory is what buys an exact total, exact per-status counts, and a
 * page jump that does not wait on the network. `/runs` has neither an offset
 * parameter nor a count query, by design; this needs neither.
 */

const MAX_PAGES = 3;

/* Broken first. History is a triage surface: an operator scanning it should
   meet failures before successes, so `failed` leads rather than sitting in
   the middle. Deliberately a different order from /triage's RunFilters, which
   reads healthy → broken across the whole estate — the words are the same
   (RUN_TONE either side), only the sequence differs. Derived from
   RUN_STATUSES rather than listed, so a status added there cannot end up with
   no chip and counts that do not add up; an unranked one lands at the end. */
const CHIP_RANK: Record<string, number> = { error: 0, incomplete: 1, warning: 2, success: 3 };
export const CHIP_STATUSES: RunStatus[] = RUN_STATUSES.map((s) => s.value).sort(
  (a, b) => (CHIP_RANK[a] ?? 9) - (CHIP_RANK[b] ?? 9),
);

export interface RunHistory {
  rows: RunRow[];
  counts: Partial<Record<RunStatus, number>>;
  /** True when retention holds more than three pages — a total reads `N+`. */
  truncated: boolean;
  loading: boolean;
  error: string;
  /** Why this platform has no run history, when it has none. */
  unsupported: string | null;
  retry: () => void;
}

export function useRunHistory(provider: ProviderId, workflowId: string): RunHistory {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const key = `${provider}|${workflowId}|${attempt}`;
  // Keyed by the request it answers, so an answer in flight when the workflow
  // changes is never painted under the new one — and "loading" is derived
  // from that rather than set inside the effect.
  const loaded = answer?.key === key ? answer : null;

  useEffect(() => {
    let live = true;
    loadAll(key, provider, workflowId)
      .then((r) => live && setAnswer(r))
      .catch(() =>
        // `/runs` is not up (or refused this query): the per-workflow endpoint
        // answers the same runs, unwindowed and unpaged.
        fetchExecutions(provider, workflowId)
          .then((d) => {
            if (!live) return;
            const ctx = { provider, workflowExternalId: workflowId, workflowName: null };
            setAnswer({
              key,
              rows: d.supported ? d.executions.map((e) => executionToRow(e, ctx)) : [],
              truncated: !!d.hasMore,
              error: "",
              unsupported: d.supported ? null : (d.reason ?? "This platform exposes no run history"),
            });
          })
          .catch((e: unknown) =>
            live && setAnswer({ key, rows: [], truncated: false, error: readError(e), unsupported: null }),
          ),
      );
    return () => {
      live = false;
    };
  }, [key, provider, workflowId]);

  const rows = useMemo(() => loaded?.rows ?? [], [loaded]);
  const counts = useMemo(() => {
    const c: Partial<Record<RunStatus, number>> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return {
    rows,
    counts,
    truncated: !!loaded?.truncated,
    loading: !loaded,
    error: loaded?.error ?? "",
    unsupported: loaded?.unsupported ?? null,
    retry: () => setAttempt((a) => a + 1),
  };
}

interface Answer {
  key: string;
  rows: RunRow[];
  truncated: boolean;
  error: string;
  unsupported: string | null;
}

async function loadAll(key: string, provider: ProviderId, workflowId: string): Promise<Answer> {
  const rows: RunRow[] = [];
  let cursor: string | null = null;
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchRuns({
      provider,
      workflow: workflowId,
      window: "all",
      limit: RUNS_MAX_LIMIT,
      cursor: cursor ?? undefined,
    });
    rows.push(...res.runs);
    cursor = res.nextCursor;
    if (!cursor) break;
    // A fourth page exists: the total reads `N+` rather than pretending the
    // third page was the end of the history.
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { key, rows, truncated, error: "", unsupported: null };
}

function readError(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : "Could not load this workflow's runs";
}

/** `success · 3 min ago · 9/9` — the run as a sentence, for the level 2 title. */
export function runSummaryLine(row: RunRow, steps: string | null, now: number): string {
  const when = relativeFrom(row.startedAt, now);
  return [row.status, when, steps].filter(Boolean).join(" · ");
}

function relativeFrom(iso: string | null, now: number): string {
  if (!iso) return "";
  const ms = now - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
