"use client";

import { CircleArrowRight } from "lucide-react";
import { AppPuck } from "@/components/shared/AppPuck";
import { Section } from "@/components/shared/DetailPanelKit";
import { connectionKindLabel, pairFor, pairsFor, type EdgeGroup, type EdgePair } from "@/lib/workflowMap/edgeGroups";
import type { MapNode } from "@/lib/workflowMap/types";
import { MapTip } from "./MapTip";

/*
 * MapEdgeSidebar — the 322px panel for a selected connection. Header
 * "Connection" · mono "kind · N sources · M targets" · ×, then the focused
 * pairing (Source → Target, with the route label when one side is a route),
 * then the Source and Target lists. A row's body focuses that pairing (the
 * map lights the route, outlines both nodes and frames them) — it never
 * navigates; the trailing "Open this node" control is the only thing that
 * opens the node panel. The focused pair's rows carry aria-current, an
 * accent bar and a tinted background. No prose.
 */

function rowMeta(n: MapNode): string {
  if (n.pill) return n.kind;
  if (n.kind === "route") return "route";
  const ord = n.module?.ordinal;
  return ord ? `#${ord}` : (n.module?.kind ?? "step");
}

function NodeRow({
  node,
  side,
  group,
  focused,
  onFocusPair,
  onOpen,
}: {
  node: MapNode;
  side: "source" | "target";
  group: EdgeGroup;
  focused: EdgePair | null;
  onFocusPair: (edgeKey: string) => void;
  onOpen: (node: MapNode) => void;
}) {
  const mine = pairsFor(group, node.id, side);
  const active = !!focused && (side === "source" ? focused.from === node.id : focused.to === node.id);
  const first = mine[0] ?? pairFor(group, node.id, side);
  const otherName = (p: EdgePair) => (side === "source" ? group.tos : group.froms).find((n) => n.id === (side === "source" ? p.to : p.from))?.name ?? "";
  return (
    <li className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={() => first && onFocusPair(first.edgeKey)}
        aria-current={active ? "true" : undefined}
        aria-label={`Focus ${side} ${node.name}`}
        className={`flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-row border-l-2 py-1.5 pl-2 pr-1 text-left transition-colors duration-[var(--dur-fast)] hover:bg-hover ${active ? "border-map-accent bg-[color-mix(in_srgb,var(--map-accent)_8%,transparent)]" : "border-transparent"}`}
      >
        <AppPuck app={node.app} size={24} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold leading-[1.3] text-t1 [overflow-wrap:anywhere]">{node.name}</span>
          <span className="block font-mono text-[10px] leading-[1.4] text-t3">{rowMeta(node)}</span>
          {mine.length > 1 && (
            <span className="mt-1 block font-mono text-[10px] leading-[1.5] text-t3 [overflow-wrap:anywhere]">
              {mine.map((p) => (
                <span key={p.edgeKey} className="block">
                  · {otherName(p)}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      <MapTip label="Open this node" side="left">
        <button
          type="button"
          onClick={() => onOpen(node)}
          aria-label={`Open ${node.name}`}
          className="inline-flex size-6 flex-none cursor-pointer items-center justify-center self-center rounded-control border border-line bg-pill text-t3 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-t1"
        >
          <CircleArrowRight aria-hidden="true" className="size-3.5" />
        </button>
      </MapTip>
    </li>
  );
}

export function MapEdgeSidebar({
  group,
  focused,
  onFocusPair,
  onOpen,
  onClose,
}: {
  group: EdgeGroup;
  /** The focused pairing (defaults to the clicked edge). */
  focused: EdgePair | null;
  onFocusPair: (edgeKey: string) => void;
  onOpen: (node: MapNode) => void;
  onClose: () => void;
}) {
  const all = [...group.froms, ...group.tos];
  const src = focused ? all.find((n) => n.id === focused.from) : undefined;
  const dst = focused ? all.find((n) => n.id === focused.to) : undefined;
  return (
    <div className="thin-scroll wm-slidein box-border h-full w-[322px] overflow-auto px-4 pb-6 pt-4">
      <div className="mb-3 flex items-start gap-2.5">
        <div className="min-w-0 flex-1 pt-px">
          <div className="text-[13.5px] font-semibold leading-[1.3]">Connection</div>
          <div className="mt-0.5 font-mono text-[10.5px] leading-[1.4] text-t3">
            {connectionKindLabel(group.kind)} · {group.froms.length} source{group.froms.length === 1 ? "" : "s"} · {group.tos.length} target{group.tos.length === 1 ? "" : "s"}
          </div>
        </div>
        <MapTip label="Close · Esc" side="left">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-[6px] border-0 bg-transparent px-1.5 py-[3px] font-sans text-[15px] leading-none text-t3 transition-colors duration-200 hover:bg-hover hover:text-t1"
          >
            ×
          </button>
        </MapTip>
      </div>

      {src && dst && (
        <div
          data-focused-pair={focused?.edgeKey}
          className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-row border px-2.5 py-2 text-[12.5px] font-semibold leading-[1.3]"
          style={{ borderColor: "color-mix(in srgb, var(--map-accent) 40%, transparent)", background: "color-mix(in srgb, var(--map-accent) 7%, transparent)" }}
        >
          <AppPuck app={src.app} size={20} />
          <span className="[overflow-wrap:anywhere]">{src.name}</span>
          <span aria-hidden="true" className="text-map-accent-text">→</span>
          <AppPuck app={dst.app} size={20} />
          <span className="[overflow-wrap:anywhere]">{dst.name}</span>
          {focused?.label && <span className="basis-full font-mono text-[10px] font-normal text-t3">{focused.label}</span>}
        </div>
      )}

      <Section title={`Source · ${group.froms.length}`}>
        <ul className="flex flex-col gap-1">
          {group.froms.map((n) => (
            <NodeRow key={n.id} node={n} side="source" group={group} focused={focused} onFocusPair={onFocusPair} onOpen={onOpen} />
          ))}
        </ul>
      </Section>
      <Section title={`Target · ${group.tos.length}`}>
        <ul className="flex flex-col gap-1">
          {group.tos.map((n) => (
            <NodeRow key={n.id} node={n} side="target" group={group} focused={focused} onFocusPair={onFocusPair} onOpen={onOpen} />
          ))}
        </ul>
      </Section>
    </div>
  );
}
