"use client";

import { memo, type CSSProperties, type ReactElement } from "react";
import { GitBranch } from "lucide-react";
import { AppPuck } from "@/components/shared/AppPuck";
import { runAria, type RunState } from "@/lib/workflowMap/run";
import { FAR_TILE, STEP_COL_W } from "@/lib/workflowMap/tokens";
import type { MapNode } from "@/lib/workflowMap/types";
import { ExpandCap } from "./ExpandCap";
import { MapTip } from "./MapTip";
import { NodeLinkButton } from "./NodeLinkButton";
import type { RefCallback } from "./useMapMeasure";
import type { TreeItemProps } from "./useMapKeyboard";

/*
 * Step node — a readable card: 32px puck, the full name (wrapping, never an
 * ellipsis) and one detail line. A "Go to" step reads "→ target" on its
 * detail line and the jump edge points at the target.
 *
 * A BRANCH card is the same card with its emphasis moved. A branch is the
 * next step, so its name IS the card — carried in the accent, and never
 * behind a prefix, a position ("Route 2 of 3") or a restatement of itself.
 * It wears a branch glyph rather than an app puck, because a branch belongs
 * to no app and a repeated app tile down a band is a category error; the
 * second line is the predicate that decides it, or nothing at all. Two controls, siblings
 * inside the card (no nested interactives):
 *   body (role=treeitem) → select: sidebar + centre
 *   ↗    (link, top-right) → open the owning workflow on its platform;
 *        shown on hover / focus-within and whenever the card is selected,
 *        always in the tab order.
 * The card element carries the measure ref, the selected ring and the hover
 * lift. In far mode (semantic zoom) the card collapses to a FAR_TILE puck
 * tile with no text — the name lives in `title` and in the sidebar — and
 * the ↗ control is left to the sidebar.
 * A card standing for more than itself — a branch holding its folded arm, a
 * card standing for a whole fan-out (`node.fold`), or a step holding the run
 * that follows it (`node.pack`) — grows a footer, `.wm-fold`, a sibling of the
 * body so nothing nests inside the treeitem:
 *   ×9               (.wm-fold-count) → outcomes behind a fan-out card
 *   12 steps (⌄)     (.wm-fold-open)  → show what it stands for — the map's one
 *                                       expand control (ExpandCap), the same
 *                                       end cap a connected workflow's pill wears
 * The card element carries `data-fold="open" | "closed"`.
 *
 * Every branch is its own card and names only itself. Branches that share a
 * shape are never drawn as one card with the others compressed into chips
 * beneath it — reaching `Canceled` must not mean clicking a pill under a card
 * called `No-Showed`. So the count and `.wm-stack` (the thickness IS the
 * claim) appear only on the Overview card standing for a whole fan-out, which
 * is genuinely many things at once and lists none of them by name. In far
 * mode that card is the usual tile with its count under it — the one number
 * that keeps it honest when the text is gone.
 *
 * Run replay: `run` lands as `data-run` on the card (the element that also
 * carries `data-pair`; globals.css styles it), the aria-label gains the
 * state ("— not reached in this run", "— failed in this run: …"), and an
 * unchecked node explains itself with a tooltip. Nothing else changes —
 * a grayed card is still selectable and still opens its platform link.
 */
const RING = "0 0 0 2px var(--map-accent), 0 0 16px color-mix(in srgb, var(--map-accent) 45%, transparent)";
/* A card of the viewed workflow's own flow (`node.main`) sits on the
   main-flow surface. It swaps the two tokens the card is built from rather
   than restyling each part, so everything drawn with them — the card, its
   footer rule, the branch glyph's frame, the ↗ control, the stack layers
   behind a fan-out card — changes together. */
const MAIN_SURFACE = { "--pill": "var(--map-main)", "--line": "var(--map-main-line)" } as CSSProperties;

export const StepNode = memo(function StepNode({
  node,
  selected,
  itemProps,
  nodeRef,
  onClick,
  srNote,
  far = false,
  pair = null,
  run = null,
  runError = null,
  onDrillIn,
}: {
  node: MapNode;
  selected: boolean;
  itemProps: TreeItemProps;
  nodeRef: RefCallback;
  onClick: (node: MapNode) => void;
  /** Screen-reader-only annotation ("changed since you last looked", …). */
  srNote?: string | null;
  /** Show what this card stands for — draw the arm, or descend a rung when
   *  the card stands for a whole fan-out or a packed run. */
  onDrillIn?: (node: MapNode) => void;
  far?: boolean;
  /** Pairing focus attributes (class + data-pulse + data-pair) or null. */
  pair?: { className: string; "data-pulse": string; "data-pair": "source" | "target" } | null;
  /** State in the replayed run (lib/workflowMap/run.ts), or null when no run
   *  is active / the node belongs to another workflow. */
  run?: RunState | null;
  /** The run's error or warning text for this node (aria-label suffix). */
  runError?: string | null;
}) {
  const name = node.hit ? "text-map-accent-text" : "text-t1";
  /* A branch card, but not a card standing for a whole fan-out: that one is
     a summary of many branches, not one of them, and keeps the plain
     treatment so the two never read as the same object. */
  const onABranch = node.kind === "route";
  /* A card standing for a whole fan-out wears the glyph too — it is about
     branches — but keeps the plain name treatment: it summarises a decision
     rather than being one of its outcomes, and the two must not read as the
     same object. */
  const branch = onABranch && node.fold?.scope !== "band";
  const fold = node.fold;
  const pack = node.pack;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  /* What the card stands for, said once so the body, the control and the
     aria-label all agree. */
  const stands = fold
    ? fold.scope === "band"
      ? [plural(fold.count, "outcome"), fold.patterns < fold.count ? plural(fold.patterns, "pattern") : null, plural(fold.totalSteps, "step")].filter(Boolean).join(" · ")
      : fold.count > 1
        ? `${plural(fold.count, "outcome")} · ${plural(fold.totalSteps, "step")}`
        : plural(fold.steps, "step")
    : pack
      ? plural(pack.steps, "step")
      : null;
  /* The control's own words: what is inside, said the same way shut or open —
     the circle beside it says which. */
  const drillLabel = fold
    ? fold.scope === "band"
      ? plural(fold.patterns, "pattern")
      : plural(fold.steps, "step")
    : pack
      ? plural(pack.steps, "step")
      : null;
  const openable = !!fold || !!pack;
  const expandedNow = !!fold?.open || !!pack?.open;
  const ariaLabel = [node.name, openable && !expandedNow ? stands : null, srNote, runAria(run, runError)].filter(Boolean).join(" — ");
  /* An unchecked node says so on hover / focus; every other state is legible from the card itself. */
  const tip = (el: ReactElement) => (run === "unknown" ? <MapTip label="Not checked in this run">{el}</MapTip> : el);
  /* Never an ellipsis on the map: an API summary that trails off ("… / …")
     loses its tail here; the sidebar lists the full set. */
  const raw = node.desc ? node.desc.replace(/\s*\/\s*…\.?$/, "").replace(/\s*…\s*$/, "").trim() : "";
  const detail = raw && raw !== node.name.trim() ? raw : null;
  /* Written out literally (not spread) so jsx-a11y can see the role, focus and key handling. */
  const { tabIndex, onKeyDown, onFocus, "aria-level": ariaLevel, "aria-selected": ariaSelected, "aria-expanded": ariaExpanded } = itemProps;
  if (far) {
    return (
      <div className="flex flex-none flex-col" style={{ width: FAR_TILE }}>
        {tip(
          <div
            ref={nodeRef}
            data-node-id={node.id}
            data-branch={node.kind === "route" ? "" : undefined}
            role="treeitem"
            tabIndex={tabIndex}
            aria-level={ariaLevel}
            aria-selected={ariaSelected}
            aria-expanded={ariaExpanded}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            title={node.name}
            aria-label={ariaLabel}
            onClick={() => onClick(node)}
            data-pair={pair?.["data-pair"]}
            data-pulse={pair?.["data-pulse"]}
            data-run={run ?? undefined}
            data-fold={fold ? (fold.open ? "open" : "closed") : undefined}
            className={`${pair ? "wm-pair " : ""}pointer-events-auto flex cursor-pointer select-none rounded-[12px] transition-[box-shadow,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-[2px]`}
            style={{ ...(node.main ? MAIN_SURFACE : null), boxShadow: selected ? RING : undefined }}
          >
            {onABranch ? (
              <span className="flex items-center justify-center rounded-[12px] border border-line text-t3" style={{ width: FAR_TILE, height: FAR_TILE }}>
                <GitBranch className="size-[18px]" />
              </span>
            ) : (
              <AppPuck app={node.app} size={FAR_TILE} radius={12} />
            )}
          </div>,
        )}
        {/* Far drops every label; the count is the one mark that keeps a
            card honest at this scale, so it is the last thing to go. */}
        {((fold && !fold.open && fold.count > 1) || pack) && (
          <span className="wm-fold-count mt-1 text-center font-mono text-[10px] text-t2">×{fold && !fold.open ? fold.count : pack!.steps}</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-none flex-col" style={{ width: STEP_COL_W }}>
      <div
        ref={nodeRef}
        data-node-id={node.id}
        data-pair={pair?.["data-pair"]}
        data-pulse={pair?.["data-pulse"]}
        data-run={run ?? undefined}
        data-fold={openable ? (expandedNow ? "open" : "closed") : undefined}
        className={`${pair ? "wm-pair " : ""}${fold && !fold.open && fold.count > 1 ? "wm-stack " : ""}group/card pointer-events-auto relative w-full rounded-card border bg-pill shadow-[var(--shadow-card)] transition-[box-shadow,transform,border-color] duration-200 ease-[var(--ease-out)] hover:-translate-y-[2px] hover:border-line-strong`}
        style={{
          ...(node.main ? MAIN_SURFACE : null),
          boxShadow: selected ? RING : undefined,
          borderColor: selected ? "color-mix(in srgb, var(--map-accent) 55%, transparent)" : "var(--line)",
        }}
      >
        {tip(
          <div
            role="treeitem"
            tabIndex={tabIndex}
            aria-level={ariaLevel}
            aria-selected={ariaSelected}
            aria-expanded={ariaExpanded}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            aria-label={ariaLabel}
            onClick={() => onClick(node)}
            className="flex w-full cursor-pointer select-none items-start gap-2.5 rounded-card p-2.5 pr-9 text-left"
          >
            {onABranch ? (
              <span aria-hidden="true" className="flex size-[32px] flex-none items-center justify-center rounded-[9px] border border-line text-t3">
                <GitBranch className="size-[15px]" />
              </span>
            ) : (
              <AppPuck app={node.app} size={32} radius={9} />
            )}
            <div className="min-w-0 flex-1 pt-px">
              <div className={`${branch ? "text-[13px] font-bold text-map-accent-text" : "text-[12.5px] font-semibold"} leading-[1.3] [overflow-wrap:anywhere] ${branch ? "" : name}`}>{node.name}</div>
              {detail && !far && <div className="mt-1 text-[11px] leading-[1.4] text-t3 [overflow-wrap:anywhere]">{detail}</div>}
            </div>
          </div>,
        )}
        {openable && (
          <div className="wm-fold flex items-center justify-between gap-2 border-t border-line py-1.5 pl-2.5 pr-1.5">
            <span className="flex min-w-0 items-center">
              {fold && fold.count > 1 && (
                <>
                  <span className="wm-fold-count font-mono text-[9.5px] text-t2" title={stands ?? undefined}>
                    ×{fold.count}
                  </span>
                  {/* A card standing for a whole fan-out names no outcomes on
                      the canvas: being ONE element is its job, and the count
                      plus the variety is the honest summary. The names are for
                      a screen reader, which cannot glance at the band below. */}
                  <span className="sr-only">{`${fold.members.map((mem) => mem.label).join(", ")} — ${stands}`}</span>
                </>
              )}
            </span>
            <ExpandCap
              className="wm-fold-open"
              open={expandedNow}
              label={drillLabel}
              ariaExpanded={fold ? fold.open : pack?.inPlace ? !!pack.open : undefined}
              ariaLabel={expandedNow ? `Fold ${node.name} away again` : `Show what ${node.name} stands for — ${stands}`}
              onToggle={() => onDrillIn?.(node)}
            />
          </div>
        )}
        <NodeLinkButton
          node={node}
          className={`absolute right-1.5 top-1.5 transition-opacity duration-150 focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 ${selected ? "opacity-100" : "opacity-0"}`}
        />
      </div>
    </div>
  );
});
