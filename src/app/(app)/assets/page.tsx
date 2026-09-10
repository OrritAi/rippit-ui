"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, Search } from "lucide-react";
import { AssetIndexEntry, fetchAssets } from "@/app/lib/api";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { kindLabel, assetHref } from "@/components/shared/AssetsSection";
import { KindIcon } from "@/components/assets/assetKinds";
import { EmptyRow, RowCard, ViewBar, ViewBody, ViewTitle } from "@/components/views/ViewFrame";
import { CONNECTORS } from "@/lib/connectors";

/*
 * Assets registry — every external asset Rippit indexed (sheets, webhooks,
 * pipelines, tags, templates…) with uses across all workflows. Webhooks and
 * endpoints are stored hashed: they list, they trace, they never expose the
 * raw URL and never get an "open" link.
 */
export default function AssetsPage() {
  const { connections, loading: connLoading } = useConnections();
  const [data, setData] = useState<{ assets: AssetIndexEntry[]; kinds: Record<string, number>; total: number } | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Assets — Rippit";
  }, []);
  useEffect(() => {
    if (connections.length === 0) return;
    let live = true;
    fetchAssets({ limit: 2000 })
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [connections.length]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.assets.filter((a) => (!kind || a.kind === kind) && (!needle || (a.label || "").toLowerCase().includes(needle) || kindLabel(a.kind).toLowerCase().includes(needle)));
  }, [data, q, kind]);
  const kinds = useMemo(() => Object.entries(data?.kinds ?? {}).sort((a, b) => b[1] - a[1]), [data]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ViewBar title="Assets" meta={data ? `${data.total} indexed` : undefined}>
        <label className="flex h-[26px] items-center gap-[7px] rounded-control border border-line bg-hover px-[9px] transition-[border-color] duration-[var(--dur-fast)] focus-within:border-line-strong">
          <Search aria-hidden="true" className="size-[11px] text-t3" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter assets…" aria-label="Filter assets" className="w-[160px] min-w-0 border-0 bg-transparent text-[12px] text-t1 outline-none placeholder:text-t3" />
        </label>
      </ViewBar>
      <ViewBody width={640}>
        <ViewTitle title="Assets" sub={data ? `${data.total} indexed · ${kinds.map(([k]) => kindLabel(k).toLowerCase()).join(", ")}` : "sheets, webhooks, templates, pipelines"} />
        {kinds.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
            <button type="button" onClick={() => setKind(null)} aria-pressed={kind === null} className={`rounded-full border px-2.5 py-[3px] text-[11px] font-semibold transition-colors ${kind === null ? "border-t1 bg-t1 text-bg" : "border-line text-t2 hover:border-line-strong hover:text-t1"}`}>
              All
            </button>
            {kinds.map(([k, n]) => (
              <button key={k} type="button" onClick={() => setKind(kind === k ? null : k)} aria-pressed={kind === k} className={`rounded-full border px-2.5 py-[3px] text-[11px] font-semibold transition-colors ${kind === k ? "border-t1 bg-t1 text-bg" : "border-line text-t2 hover:border-line-strong hover:text-t1"}`}>
                {kindLabel(k)} <span className="tabular font-mono opacity-70">{n}</span>
              </button>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="mb-3 text-[13px] text-err-text">
            {error}
          </p>
        )}
        {!connLoading && connections.length === 0 ? (
          <RowCard>
            <EmptyRow>
              Nothing connected yet.{" "}
              <Link href="/settings/connections" className="not-italic font-semibold text-t1 underline-offset-4 hover:underline">
                Connect a platform
              </Link>{" "}
              and Rippit indexes every sheet, webhook, pipeline and tag your workflows touch.
            </EmptyRow>
          </RowCard>
        ) : !data && !error ? (
          <div role="status" className="flex flex-col gap-2" aria-label="Loading assets">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} aria-hidden="true" className="h-[52px] animate-pulse rounded-card bg-hover motion-reduce:animate-none" />
            ))}
          </div>
        ) : (
          <RowCard>
            {rows.length === 0 && <EmptyRow>{data && data.total === 0 ? "No assets indexed yet — sync a connection first." : "Nothing matches."}</EmptyRow>}
            {rows.map((a) => {
              return (
                <div key={`${a.kind}:${a.value}`} className="flex w-full items-center gap-[11px] border-b border-line2 px-3.5 py-[11px] transition-[background] duration-[var(--dur-fast)] last:border-b-0 hover:bg-hover">
                  <Link href={assetHref(a.kind, a.value)} title="Dependencies — every workflow and step using this asset" className="flex min-w-0 flex-1 items-center gap-[11px]">
                    <span className="inline-flex size-7 flex-none items-center justify-center rounded-control border border-line bg-hover text-t2">
                      <KindIcon kind={a.kind} className="size-[13px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block [overflow-wrap:anywhere] text-[13px] font-semibold text-t1">{a.label || kindLabel(a.kind)}</span>
                      <span className="tabular mt-[1px] block font-mono text-[9.5px] text-t3">
                        {kindLabel(a.kind).toLowerCase()} · used by {a.workflows} workflow{a.workflows === 1 ? "" : "s"} · {a.uses} step{a.uses === 1 ? "" : "s"}
                        {a.providers.length > 0 ? ` · ${a.providers.map((p) => CONNECTORS[p]?.shortLabel ?? p).join(" + ")}` : ""}
                      </span>
                    </span>
                  </Link>
                  {a.url && (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${a.label || kindLabel(a.kind)} on its platform`}
                      title="Open the asset on its platform in a new tab"
                      className="inline-flex flex-none items-center gap-[3px] text-[11.5px] font-semibold text-t2 transition-colors hover:text-t1"
                    >
                      open <ArrowUpRight aria-hidden="true" className="size-[10px]" />
                    </a>
                  )}
                  <Link href={assetHref(a.kind, a.value)} aria-label="View dependencies" className="flex-none">
                    <ChevronRight aria-hidden="true" className="size-3 text-t3" />
                  </Link>
                </div>
              );
            })}
          </RowCard>
        )}
      </ViewBody>
    </div>
  );
}
