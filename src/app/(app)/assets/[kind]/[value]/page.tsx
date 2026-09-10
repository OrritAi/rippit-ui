"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { fetchRefUses, RefUses } from "@/app/lib/api";
import { getConnector, isProviderId } from "@/lib/connectors";
import { workflowHref } from "@/lib/portals";
import { kindLabel } from "@/components/shared/AssetsSection";
import { KindIcon, openLabel } from "@/components/assets/assetKinds";
import { AppPuck } from "@/components/shared/AppPuck";
import { EmptyRow, RowCard, ViewBar, ViewBody } from "@/components/views/ViewFrame";
import { ErrorCard } from "@/components/shared/ErrorCard";

/*
 * One asset: every (workflow, step) across both platforms that references
 * it, plus "open in its native tool" when a URL is derivable (never for
 * hashed webhooks/endpoints).
 */
export default function AssetDetailPage({ params }: { params: Promise<{ kind: string; value: string }> }) {
  const { kind: rawKind, value: rawValue } = use(params);
  const kind = decodeURIComponent(rawKind);
  const value = decodeURIComponent(rawValue);
  const [result, setResult] = useState<{ key: string; data?: RefUses; error?: string } | null>(null);
  const key = `${kind}:${value}`;

  useEffect(() => {
    let live = true;
    fetchRefUses(kind, value)
      .then((d) => live && setResult({ key, data: d }))
      .catch((e: Error) => live && setResult({ key, error: e.message }));
    return () => {
      live = false;
    };
  }, [kind, value, key]);

  const current = result && result.key === key ? result : null;
  const data = current?.data ?? null;
  const title = data?.label || kindLabel(kind);
  useEffect(() => {
    document.title = `${title} — Assets — Rippit`;
  }, [title]);

  const grouped = new Map<string, RefUses["uses"]>();
  for (const u of data?.uses ?? []) {
    const k = `${u.provider}:${u.workflowExternalId}`;
    grouped.set(k, [...(grouped.get(k) ?? []), u]);
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="Assets" meta={data ? `${data.workflows} workflow${data.workflows === 1 ? "" : "s"} · ${data.uses.length} step${data.uses.length === 1 ? "" : "s"}` : undefined} />
      <ViewBody width={640}>
        <Link href="/assets" className="mb-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-t3 transition-colors hover:text-t1">
          <ArrowLeft aria-hidden="true" className="size-[11px]" /> all assets
        </Link>
        {current?.error ? (
          <ErrorCard title="Couldn’t load this asset" message={current.error} backHref="/assets" backLabel="Back to assets" />
        ) : (
          <div key={key} className="anim-fade-up">
            <div className="mb-3.5 flex items-center gap-3">
              <span className="inline-flex size-[38px] flex-none items-center justify-center rounded-control border border-line bg-hover text-t1">
                <KindIcon kind={kind} className="size-[17px]" />
              </span>
              <span className="min-w-0 flex-1">
                <h2 className="m-0 [overflow-wrap:anywhere] text-[16px] font-bold tracking-[-0.01em]">{title}</h2>
                <p className="tabular m-0 mt-[2px] font-mono text-[10.5px] text-t3">
                  {kindLabel(kind).toLowerCase()}
                  {data ? ` · ${data.uses.length} use${data.uses.length === 1 ? "" : "s"} across the estate` : ""}
                </p>
              </span>
              {data?.url ? (
                <a href={data.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-[26px] items-center gap-1 rounded-control bg-t1 px-2.5 text-[12px] font-semibold text-bg transition-opacity hover:opacity-90">
                  <ArrowUpRight aria-hidden="true" className="size-[11px]" /> {openLabel(kind)}
                </a>
              ) : data ? (
                <span className="text-[10.5px] text-t3" title="Webhooks and endpoints are indexed hashed — Rippit never stores or shows the raw URL">
                  no native link
                </span>
              ) : null}
            </div>
            {!data ? (
              <div role="status" className="flex flex-col gap-2" aria-label="Loading uses">
                {[0, 1, 2].map((i) => (
                  <div key={i} aria-hidden="true" className="h-[52px] animate-pulse rounded-card bg-hover motion-reduce:animate-none" />
                ))}
              </div>
            ) : (
              <RowCard>
                {data.uses.length === 0 && <EmptyRow>No references found (as of the last sync).</EmptyRow>}
                {[...grouped.entries()].flatMap(([k, uses]) =>
                  uses.map((u, i) => {
                    if (!isProviderId(u.provider)) return null;
                    const connector = getConnector(u.provider);
                    const href = `${workflowHref({ source: u.provider, refId: u.workflowExternalId })}${u.nodeId ? `?step=${encodeURIComponent(u.nodeId)}` : ""}`;
                    return (
                      <Link key={`${k}:${u.nodeId ?? i}`} href={href} className="flex w-full items-center gap-2.5 border-b border-line2 px-3.5 py-[11px] text-left transition-[background] duration-[var(--dur-fast)] last:border-b-0 hover:bg-hover">
                        <AppPuck app={u.provider} size={22} />
                        <span className="min-w-0 flex-1">
                          <span className="block [overflow-wrap:anywhere] text-[12.5px] font-semibold text-t1">
                            {u.workflowName || `${connector.shortLabel} ${u.workflowExternalId}`}
                            {u.isActive === false && <span className="ml-1.5 text-[10.5px] font-normal text-t3">· inactive</span>}
                          </span>
                          <span className="tabular mt-[1px] block [overflow-wrap:anywhere] font-mono text-[9.5px] text-t3">
                            {connector.nouns.step} {u.ordinal ?? u.nodeId ?? "?"}
                            {u.nodeLabel ? ` · ${u.nodeLabel}` : ""} · {connector.shortLabel}
                            {u.connectionLabel ? ` · ${u.connectionLabel}` : ""}
                            {u.dynamic ? " · mapped at runtime" : ""}
                          </span>
                        </span>
                        <span className="text-[11px] font-semibold text-t3">open in canvas →</span>
                      </Link>
                    );
                  })
                )}
              </RowCard>
            )}
            {data && data.uses.length > 0 && (
              <p className="mx-0.5 mt-2.5 text-[11px] text-t3">
                Renaming or deleting this asset would ripple into {data.uses.length} step{data.uses.length === 1 ? "" : "s"} across {data.workflows} workflow{data.workflows === 1 ? "" : "s"} — Rippit flags every one before you touch it.
              </p>
            )}
          </div>
        )}
      </ViewBody>
    </div>
  );
}
