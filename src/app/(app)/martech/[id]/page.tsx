"use client";

import { use, useCallback, useEffect, useState } from "react";
import { detectFunnels, fetchFunnelGraph, type FunnelGraph } from "@/app/lib/api";
import { ErrorCard } from "@/components/shared/ErrorCard";
import { LoadingState } from "@/components/shared/LoadingState";
import { MartechView } from "@/components/martech/MartechView";

/*
 * Martech detail — one funnel as a picture. Fetches the graph (schema v2)
 * and hands it to MartechView; loading, error and empty states live here.
 * "Detect funnels" re-reads captured artifacts only; nothing is written to
 * GoHighLevel.
 */
export default function MartechDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [graph, setGraph] = useState<FunnelGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return fetchFunnelGraph(id)
      .then((g) => {
        setGraph(g);
        document.title = `${g.funnel.name} — Martech`;
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this funnel"));
  }, [id]);

  useEffect(() => {
    document.title = "Martech — Rippit";
    void load();
  }, [load]);

  const detect = useCallback(async () => {
    const conn = graph?.funnel.primaryConnectionId;
    if (!conn) return;
    setDetecting(true);
    try {
      await detectFunnels(conn);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }, [graph, load]);

  if (error) {
    return <ErrorCard title="Couldn’t load this funnel" message={error} backHref="/martech" backLabel="Back to Martech" onRetry={load} />;
  }
  if (!graph) return <LoadingState message="Loading funnel…" />;

  return <MartechView graph={graph} onDetect={graph.funnel.primaryConnectionId ? detect : undefined} detecting={detecting} />;
}
