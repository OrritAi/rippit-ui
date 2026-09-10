"use client";

import { memo } from "react";
import { AppPuck } from "@/components/shared/AppPuck";
import { FAR_TILE, STEP_COL_W } from "@/lib/workflowMap/tokens";
import type { MapNode } from "@/lib/workflowMap/types";
import { NodeLinkButton } from "./NodeLinkButton";
import type { RefCallback } from "./useMapMeasure";
import type { TreeItemProps } from "./useMapKeyboard";

/*
 * Step node — a readable card: 32px puck, the full name (wrapping, never an
 * ellipsis) and one detail line. Route nodes are the same card with the
 * `router` app; a "Go to" step reads "→ target" on its detail line and the
 * jump edge points at the target. Two controls, siblings
 * inside the card (no nested interactives):
 *   body (role=treeitem) → select: sidebar + centre
 *   ↗    (link, top-right) → open the owning workflow on its platform;
 *        shown on hover / focus-within and whenever the card is selected,
 *        always in the tab order.
 * The card element carries the measure ref, the selected ring and the hover
 * lift. In far mode (semantic zoom) the card collapses to a FAR_TILE puck
 * tile with no text — the name lives in `title` and in the sidebar — and
 * the ↗ control is left to the sidebar.
 */
const RING = "0 0 0 2px var(--map-accent), 0 0 16px color-mix(in srgb, var(--map-accent) 45%, transparent)";

export const StepNode = memo(function StepNode({
  node,
  selected,
  itemProps,
  nodeRef,
  onClick,
  srNote,
  far = false,
}: {
  node: MapNode;
  selected: boolean;
  itemProps: TreeItemProps;
  nodeRef: RefCallback;
  onClick: (node: MapNode) => void;
  /** Screen-reader-only annotation ("changed since you last looked", …). */
  srNote?: string | null;
  far?: boolean;
}) {
  const name = node.hit ? "text-map-accent-text" : "text-t1";
  /* Never an ellipsis on the map: an API summary that trails off ("… / …")
     loses its tail here; the sidebar lists the full set. */
  const raw = node.desc ? node.desc.replace(/\s*\/\s*…\.?$/, "").replace(/\s*…\s*$/, "").trim() : "";
  const detail = raw && raw !== node.name.trim() ? raw : null;
  /* Written out literally (not spread) so jsx-a11y can see the role, focus and key handling. */
  const { tabIndex, onKeyDown, onFocus, "aria-level": ariaLevel, "aria-selected": ariaSelected, "aria-expanded": ariaExpanded } = itemProps;
  if (far) {
    return (
      <div className="flex flex-none flex-col" style={{ width: FAR_TILE }}>
        <div
          ref={nodeRef}
          data-node-id={node.id}
          role="treeitem"
          tabIndex={tabIndex}
          aria-level={ariaLevel}
          aria-selected={ariaSelected}
          aria-expanded={ariaExpanded}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          title={node.name}
          aria-label={srNote ? `${node.name} — ${srNote}` : node.name}
          onClick={() => onClick(node)}
          className="flex cursor-pointer select-none rounded-[12px] transition-[box-shadow,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-[2px]"
          style={{ boxShadow: selected ? RING : undefined }}
        >
          <AppPuck app={node.app} size={FAR_TILE} radius={12} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-none flex-col" style={{ width: STEP_COL_W }}>
      <div
        ref={nodeRef}
        data-node-id={node.id}
        className="group/card relative w-full rounded-card border bg-pill shadow-[var(--shadow-card)] transition-[box-shadow,transform,border-color] duration-200 ease-[var(--ease-out)] hover:-translate-y-[2px] hover:border-line-strong"
        style={{
          boxShadow: selected ? RING : undefined,
          borderColor: selected ? "color-mix(in srgb, var(--map-accent) 55%, transparent)" : "var(--line)",
        }}
      >
        <div
          role="treeitem"
          tabIndex={tabIndex}
          aria-level={ariaLevel}
          aria-selected={ariaSelected}
          aria-expanded={ariaExpanded}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          aria-label={srNote ? `${node.name} — ${srNote}` : node.name}
          onClick={() => onClick(node)}
          className="flex w-full cursor-pointer select-none items-start gap-2.5 rounded-card p-2.5 pr-9 text-left"
        >
          <AppPuck app={node.app} size={32} radius={9} />
          <div className="min-w-0 flex-1 pt-px">
            <div className={`text-[12.5px] font-semibold leading-[1.3] [overflow-wrap:anywhere] ${name}`}>{node.name}</div>
            {detail && !far && <div className="mt-1 text-[11px] leading-[1.4] text-t3 [overflow-wrap:anywhere]">{detail}</div>}
          </div>
        </div>
        <NodeLinkButton
          node={node}
          className={`absolute right-1.5 top-1.5 transition-opacity duration-150 focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 ${selected ? "opacity-100" : "opacity-0"}`}
        />
      </div>
    </div>
  );
});
