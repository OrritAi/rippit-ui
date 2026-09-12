"use client";

import { use, useEffect } from "react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { getConnector, isProviderId } from "@/lib/connectors";
import { LoadingState } from "@/components/shared/LoadingState";
import { useFullBleed } from "@/components/shell/shell-context";

/*
 * The run log is a surface over the workflow's own page, not a screen of its
 * own — but this path was the way in before it was, and links to it are out
 * there. It stays a deep link: on mount it turns the surface on and hands
 * over, carrying the log's filters across so a shared link still opens on
 * the page it was shared from. It claims the surface's full bleed while it
 * does, so the shell's chrome never flashes in between.
 */
const CARRIED = ["status", "page", "size", "run", "step"];

export default function WorkflowHistoryPage({ params }: { params: Promise<{ provider: string; id: string }> }) {
  const { provider, id } = use(params);
  if (!isProviderId(provider)) notFound();
  const connector = getConnector(provider);

  const router = useRouter();
  const searchParams = useSearchParams();
  useFullBleed("full");

  useEffect(() => {
    const next = new URLSearchParams();
    next.set("history", "1");
    for (const k of CARRIED) {
      const v = searchParams.get(k);
      if (v) next.set(k, v);
    }
    router.replace(`/w/${provider}/${encodeURIComponent(id)}?${next.toString()}`);
  }, [router, searchParams, provider, id]);

  return <LoadingState message={`Loading ${connector.nouns.workflow}…`} />;
}
