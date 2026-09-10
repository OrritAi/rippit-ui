"use client";

import type { CSSProperties } from "react";
import {
  CHILD_GAP_DEEP,
  CHILD_GAP_ROOT,
  DEEP_SPACER,
  FAN_AT,
  FAN_SPACER,
  ROOT_SPACER,
  STAGGER_CAP_MS,
  STAGGER_MS,
  TALL_COLUMN_AT,
} from "@/lib/workflowMap/tokens";
import type { MapNode } from "@/lib/workflowMap/types";
import { StepNode } from "./StepNode";
import { WorkflowPill } from "./WorkflowPill";
import type { RefCallback } from "./useMapMeasure";
import type { TreeItemProps } from "./useMapKeyboard";

/*
 * MapTree — the recursive row layout, any depth:
 *   [node][spacer 84 after roots / 72 deeper][children band][spacer][join column]
 * The join column (steps reached by several columns of the band, each
 * rendered once) is vertically centred against the band; each join head is
 * itself a row whose children band is its continuation.
 * The parent is vertically centred against a short leaf column (the
 * design's yes/no router); a tall one — the column's rendered subtree
 * holds TALL_COLUMN_AT nodes or more, or any child has its own column —
 * top-aligns instead, the parent nudged so its centre meets the first
 * child's, so edges fan downward from a nearby parent rather than
 * converging on one far-away point. A fan-out (FAN_AT children or more)
 * gets the wider FAN_SPACER so its edges have room to peel apart.
 * Root rows carry the `rise`
 * entrance (and `content-visibility: auto` on big maps); children columns get
 * `branchin` with a 50 ms stagger (capped at 250). Under LITE there is no
 * entrance stagger at all. Above ROOT_WINDOW_AT roots, rows far from the
 * viewport render as fixed-height placeholders (`ctx.near`).
 */

export interface TreeCtx {
  selectedId: string | null;
  /** Pairing focus from the connection panel: the source and target of the
   *  focused pair wear a shape-following outline; `pairTick` restarts the pulse. */
  pairRoleOf: (id: string) => "source" | "target" | null;
  pairTick: number;
  lite: boolean;
  /** True for ~650 ms after a toggle — fresh children columns get will-change. */
  unfolding: boolean;
  itemProps: (node: MapNode) => TreeItemProps;
  refFor: (id: string) => RefCallback;
  rowRefFor: (rootId: string) => RefCallback;
  placeholderRefFor: (rootId: string) => RefCallback;
  /** Root rows near the viewport when windowing; null = render everything. */
  near: ReadonlySet<string> | null;
  /** Big maps only: `content-visibility: auto` on root rows. Its paint
   *  containment clips the selection glow and hover lift at a subtree's
   *  edge, so small maps keep full visuals. */
  skipOffscreen: boolean;
  /** Zoomed out past FAR_AT: hide step labels and pill meta lines. */
  far: boolean;
  heightOf: (rootId: string) => number;
  onClick: (node: MapNode) => void;
  /** The pill's count chip: expand / collapse that flow. */
  onToggle: (node: MapNode) => void;
  srNoteFor?: (node: MapNode) => string | null;
  /** A children column mounted during the current unfold window. */
  isFreshGroup: (parentId: string) => boolean;
}

const delay = (i: number): CSSProperties => ({
  animationDelay: `${Math.min(i * STAGGER_MS, STAGGER_CAP_MS)}ms`,
});

function Row({
  node,
  index,
  depth,
  ctx,
}: {
  node: MapNode;
  index: number;
  depth: number;
  ctx: TreeCtx;
}) {
  const root = depth === 0;
  const selected = node.id === ctx.selectedId;
  const pair = ctx.pairRoleOf(node.id);
  const pairProps = pair ? { className: "wm-pair", "data-pulse": String(ctx.pairTick % 2), "data-pair": pair } : null;
  const anim = ctx.lite ? "" : root ? "wm-rise" : "wm-branch";
  const kids = node.children;
  const joins = node.joins;
  const weight =
    kids.reduce((n, k) => n + 1 + k.descendants, 0) +
    joins.reduce((n, j) => n + 1 + j.descendants, 0);
  const tall =
    weight >= TALL_COLUMN_AT ||
    kids.some((k) => k.children.length > 0 || k.joins.length > 0) ||
    joins.length > 0;
  const fan = kids.length >= FAN_AT;
  /* Band vs join column: centred against each other while both are short;
     once the join column carries a real subtree (the shared step usually
     fans out further) both top-align, so the band's tails and the join head
     stay near the parent instead of the band sinking to the middle of a
     very tall join column. */
  const joinWeight = joins.reduce((n, j) => n + 1 + j.descendants, 0);
  const innerAlign =
    joinWeight >= TALL_COLUMN_AT ? "items-start" : "items-center";
  /* Top-aligned: a 40px pill against a ~70px first card sits 15px down so
     the centres meet; card-on-card and anything-on-pill need no nudge. */
  const nudge = tall && node.pill && !kids[0].pill && !ctx.far ? 15 : 0;
  return (
    <div
      ref={root ? ctx.rowRefFor(node.id) : undefined}
      className={`flex ${tall ? "items-start" : "items-center"} ${root ? "wm-row" : ""} ${root && ctx.skipOffscreen ? "[content-visibility:auto] [contain-intrinsic-size:auto_60px]" : ""} ${anim}`}
      style={ctx.lite ? undefined : delay(index)}
    >
      {node.pill ? (
        <div style={nudge ? { marginTop: nudge } : undefined}>
          <WorkflowPill
            node={node}
            selected={selected} pair={pairProps}
            itemProps={ctx.itemProps(node)}
            nodeRef={ctx.refFor(node.id)}
            onClick={ctx.onClick}
            onToggle={ctx.onToggle}
            far={ctx.far}
          />
        </div>
      ) : (
        <StepNode
          node={node}
          selected={selected}
          itemProps={ctx.itemProps(node)}
          nodeRef={ctx.refFor(node.id)}
          onClick={ctx.onClick}
          srNote={ctx.srNoteFor?.(node)}
          far={ctx.far} pair={pairProps}
        />
      )}
      {(kids.length > 0 || joins.length > 0) && (
        <>
          <div
            className="flex-none"
            style={{
              width: fan ? FAN_SPACER : root ? ROOT_SPACER : DEEP_SPACER,
            }}
          />
          <div className={`flex ${innerAlign}`}>
            {kids.length > 0 && (
              <div
                role="group"
                className="flex flex-col"
                style={{
                  gap: root ? CHILD_GAP_ROOT : CHILD_GAP_DEEP,
                  willChange:
                    ctx.unfolding && ctx.isFreshGroup(node.id)
                      ? "transform, opacity"
                      : undefined,
                }}
              >
                {kids.map((c, i) => (
                  <Row
                    key={c.id}
                    node={c}
                    index={i}
                    depth={depth + 1}
                    ctx={ctx}
                  />
                ))}
              </div>
            )}
            {joins.length > 0 && (
              <>
                {kids.length > 0 && (
                  <div className="flex-none" style={{ width: DEEP_SPACER }} />
                )}
                <div
                  role="group"
                  aria-label="Shared steps"
                  className="flex flex-col"
                  style={{ gap: CHILD_GAP_DEEP }}
                >
                  {joins.map((j, i) => (
                    <Row
                      key={j.id}
                      node={j}
                      index={i}
                      depth={depth + 1}
                      ctx={ctx}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TopRows({ rows, ctx }: { rows: MapNode[]; ctx: TreeCtx }) {
  return (
    <>
      {rows.map((r, i) =>
        ctx.near !== null && !ctx.near.has(r.id) ? (
          <div
            key={r.id}
            ref={ctx.placeholderRefFor(r.id)}
            aria-hidden="true"
            style={{ height: ctx.heightOf(r.id) }}
          />
        ) : (
          <Row key={r.id} node={r} index={i} depth={0} ctx={ctx} />
        ),
      )}
    </>
  );
}

/*
 * Hub layout: [callers block][spacer][viewed tree]. The callers block is a
 * column of top-level rows (folded pills; an expanded caller grows its own
 * subtree inside the block — the block is `w-max`, so the viewed tree just
 * shifts right). With ≤ 3 folded callers the viewed pill is centred against
 * the block (estimated from pill/meta heights, no DOM read); a taller or
 * expanded block top-aligns with it. Both kinds of row register as root
 * rows for the measure hook (IntersectionObserver gate + windowing).
 */
const PILL_H = 40;
const META_H = 18;

export function MapTree({
  roots,
  callers,
  ctx,
}: {
  roots: MapNode[];
  callers: MapNode[];
  ctx: TreeCtx;
}) {
  if (callers.length === 0) {
    return (
      <div className="flex flex-col gap-[44px]">
        <TopRows rows={roots} ctx={ctx} />
      </div>
    );
  }
  const short =
    callers.length <= 3 &&
    callers.every((c) => !c.pill?.open && c.children.length === 0);
  const blockH =
    callers.length * PILL_H +
    (callers.length - 1) * CHILD_GAP_ROOT +
    callers.filter((c) => c.meta && !ctx.far).length * META_H;
  const nudge = short ? Math.max(0, Math.round((blockH - PILL_H) / 2)) : 0;
  return (
    <div className="flex items-start">
      <div
        role="group"
        aria-label="Workflows that call this one"
        className="flex w-max flex-col"
        style={{ gap: CHILD_GAP_ROOT }}
      >
        <TopRows rows={callers} ctx={ctx} />
      </div>
      <div className="flex-none" style={{ width: ROOT_SPACER }} />
      <div
        className="flex flex-col gap-[44px]"
        style={nudge ? { marginTop: nudge } : undefined}
      >
        <TopRows rows={roots} ctx={ctx} />
      </div>
    </div>
  );
}
