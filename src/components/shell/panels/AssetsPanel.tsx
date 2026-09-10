"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { AssetIndexEntry, fetchAssets } from "@/app/lib/api";
import { useConnections } from "@/components/app/ConnectionsProvider";
import { kindLabel, assetHref } from "@/components/shared/AssetsSection";
import { KindIcon } from "@/components/assets/assetKinds";
import { useStoredJson, writeStored } from "@/lib/stored";
import { ListRow, PanelEmpty, PanelSkeleton } from "./ListRow";

/* Assets side panel: the registry as a structure — kinds (with counts) that
   expand into their assets; clicking an asset opens it on the right. */
const OPEN_KEY = "rippit.assets.open";
const EMPTY: Record<string, boolean> = {};

export function AssetsPanel() {
  const { connections } = useConnections();
  const pathname = usePathname();
  const [data, setData] = useState<{ assets: AssetIndexEntry[]; kinds: Record<string, number> } | null>(null);
  const open = useStoredJson<Record<string, boolean>>(OPEN_KEY, EMPTY);
  useEffect(() => {
    if (connections.length === 0) return;
    let live = true;
    fetchAssets({ limit: 2000 })
      .then((d) => live && setData(d))
      .catch(() => live && setData({ assets: [], kinds: {} }));
    return () => {
      live = false;
    };
  }, [connections.length]);
  if (connections.length === 0) return <PanelEmpty>Nothing connected yet</PanelEmpty>;
  if (!data) return <PanelSkeleton />;
  const kinds = Object.entries(data.kinds).sort((a, b) => b[1] - a[1]);
  return (
    <div className="thin-scroll stagger min-h-0 flex-1 overflow-y-auto p-[7px]">
      {kinds.length === 0 && <PanelEmpty>No assets indexed yet</PanelEmpty>}
      {kinds.map(([kind, n]) => {
        const isOpen = !!open[kind];
        const items = data.assets.filter((a) => a.kind === kind);
        return (
          <div key={kind}>
            <button
              type="button"
              onClick={() => writeStored(OPEN_KEY, { ...open, [kind]: !isOpen })}
              aria-expanded={isOpen}
              className="flex min-h-[27px] w-full cursor-pointer items-center gap-1.5 rounded-row px-1.5 text-left transition-[background] duration-[var(--dur-fast)] hover:bg-hover"
            >
              <ChevronRight aria-hidden="true" className={`size-[10px] flex-none text-t3 transition-transform duration-[var(--dur-fast)] ${isOpen ? "rotate-90" : ""}`} />
              <KindIcon kind={kind} className="size-[11px] flex-none text-t3" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-[11.5px] font-medium text-t2">{kindLabel(kind)}</span>
              <span className="tabular font-mono text-[9px] text-t3">{n}</span>
            </button>
            {isOpen && (
              <div className="mb-1">
                {items.map((a) => {
                  const href = assetHref(a.kind, a.value);
                  return <ListRow key={`${a.kind}:${a.value}`} href={href} active={pathname === href} title={a.label || kindLabel(a.kind)} sub={`${a.workflows} workflow${a.workflows === 1 ? "" : "s"} · ${a.uses} step${a.uses === 1 ? "" : "s"}`} leading={<span className="ml-[18px]" />} />;
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
