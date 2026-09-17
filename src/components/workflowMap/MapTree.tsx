"use client";

import type { CSSProperties } from "react";
import { chainsOf, fanSplit, flowsRight, stacksChain } from "@/lib/workflowMap/model";
import {
  CHAIN_GAP,
  CHAIN_RAIL_Y,
  COLUMN_GAP,
  DEEP_SPACER,
  DROP_X,
  FAN_AT,
  FAR_TILE,
  FAN_SPACER,
  HANG_GAP,
  HANG_RUN,
  LANE_GAP,
  PILL_MIN_H,
  ROOT_SPACER,
  ROW_GAP,
  TALL_COLUMN_AT,
} from "@/lib/workflowMap/tokens";
import type { RunState } from "@/lib/workflowMap/run";
import type { MapNode } from "@/lib/workflowMap/types";
import { StepNode } from "./StepNode";
import { WorkflowPill } from "./WorkflowPill";
import type { RefCallback } from "./useMapMeasure";
import type { TreeItemProps } from "./useMapKeyboard";

/*
 * MapTree — lines run LEFT TO RIGHT, except a connected workflow's own trunk,
 * which runs TOP TO BOTTOM (`flowsRight`).
 *
 *                                                    ┌─[No-Showed]──[Step]
 *   (Viewed)──[Trigger]──[Add to Workflow]──[Wait]──[Condition]─┼─[Canceled]───[Step]
 *                              │                                 └─[Reschedule]─[Step]
 *                              └─( PCF Submitted ⌃ )
 *                                    │
 *                                 [Condition]─┬─[Yes]──[Step]
 *                                             └─[No]───[Step]
 *
 * A ROW (the viewed workflow's flow, and every branch lane anywhere) is a grid
 * of bands: branches over the rail · the row itself · what its fan-out calls.
 * Every card of the row sits at the top of the middle band, so all of them
 * share one rail — CHAIN_RAIL_Y below that band's top — whatever rises above
 * it. Each card has a column of its own, and the workflows it calls hang
 * directly under it in that column, indented so the drop runs down and right
 * into each pill; one wider than its card widens that column and pushes the
 * rest of the row right. A row ends at a fan-out: its branches are one stack
 * beside it, centred on the rail by count (`fanSplit`) — the first half in
 * the band above, the rest from the rail down, the middle one on the rail
 * when the count is odd — so the Condition sits in the middle of its
 * branches. What the fan-out itself calls hangs in the band below, clear of
 * the trunk. Shared steps sit on the rail beyond the branches.
 *
 * DOM order is reading order, because the entrance stagger follows it: a
 * row's cards left to right, then what hangs below each, then its branches
 * top to bottom, then the steps they share.
 *
 * A group's card (a pill or a branch) is the first card of its first row,
 * placed in the same middle band through a subgrid, so it shares that rail.
 * Further entry chains stack under the first row, to the right of the card.
 *
 * A COLUMN (a connected workflow's trunk: its pill and the steps under it) is
 * left-aligned, so every "v" line runs straight down under the pucks. A step
 * in it keeps its branches and what it calls beside it, centred on its rail
 * the same way; the column simply grows around that. With two or more
 * entries, or shared steps, a connected group keeps its chains in a column
 * to its right, the way the map always drew them (`stacksChain`).
 *
 * Lines meet a step card at its rail and a pill at its centre, so a pill
 * whose line comes level from a card drops until its centre is on that
 * card's rail: the viewed pill starting its row, a pill fanning beside a
 * trunk step, a pill whose entry chains sit to its right. Zoomed out a step
 * is a FAR_TILE tile met at its centre, and a fan centres on that instead.
 *
 * Nothing here measures the DOM; `walk()` picks each line's anchor from the
 * same `flowsRight`, `chainsOf` and `stacksChain`, so layout and lines cannot
 * disagree. Each card stays the only child of its own wrapper (`StepNode` /
 * `WorkflowPill` render it), which is the box the motion layer animates, and
 * every card also sits in a wrapper of its own here — nothing but that one
 * card ever shares a parent with it.
 *
 * Rows carry no entrance of their own. `useMapMotion` reveals each card
 * once, keyed by node id, which is the only entrance in any mode: with
 * motion on it supersedes one here, and with motion off — reduced motion or
 * LITE — there should not be one. The row-level `rise` / `branchin` this
 * used to apply was worse than redundant: it was a `fill: both` animation
 * with an inline stagger delay, so under a reduced-motion reset that
 * shortens duration but not delay it pinned each row at its *first*
 * keyframe — invisible, displaced, undersized — for up to the stagger cap,
 * and edges were then measured against rows still held there. Root rows keep
 * `content-visibility: auto` on big maps; above ROOT_WINDOW_AT roots, rows
 * far from the viewport still render as fixed-height placeholders
 * (`ctx.near`).
 */

export interface TreeCtx {
  selectedId: string | null;
  /** Pairing focus from the connection panel: the source and target of the
   *  focused pair wear a shape-following outline; `pairTick` restarts the pulse. */
  pairRoleOf: (id: string) => "source" | "target" | null;
  pairTick: number;
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
  /** A card's step chip: draw the arm it stands for, or descend a rung when
   *  it stands for a whole fan-out or a packed run. */
  onDrillIn: (node: MapNode) => void;
  srNoteFor?: (node: MapNode) => string | null;
  /** A children column mounted during the current unfold window. */
  isFreshGroup: (parentId: string) => boolean;
  /** A run is being replayed: nodes carry `data-run` (lib/workflowMap/run.ts). */
  runActive: boolean;
  /** The node's state in that run, or null (no run / another workflow's node). */
  runStateOf: (node: MapNode) => RunState | null;
  /** The run's error / warning text for the node — the aria-label suffix. */
  runErrorOf?: (node: MapNode) => string | null;
  /** A related workflow's pill: its own run on the meta line ("ran 2h ago · failed"). */
  runMetaOf?: (node: MapNode) => string | null;
}

/** The viewed pill's wrapper carries 4px of margin (`WorkflowPill`: `m-1`,
 *  so its start-state ring never clips), which counts toward its drop. */
const VIEWED_RING = 4;
/** How far a pill that starts a row drops so its centre sits on the rail. */
const railDrop = (node: MapNode) => CHAIN_RAIL_Y - PILL_MIN_H / 2 - (node.isViewed ? VIEWED_RING : 0);
/** Where lines meet a card beside which lanes fan: its puck's centre, or
 *  zoomed out — where a step is a FAR_TILE tile and lines meet it at its
 *  centre — half the tile. */
const fanRail = (ctx: TreeCtx) => (ctx.far ? FAR_TILE / 2 : CHAIN_RAIL_Y);
/** How far a connected pill drops when its lines meet a step's rail: a lane
 *  beside a trunk step, or a pill whose entry chains sit to its right. Its
 *  centre is then on that rail, and the stub runs straight. */
const laneDrop = (ctx: TreeCtx) => fanRail(ctx) - PILL_MIN_H / 2;

const pillsOf = (node: MapNode) => node.children.filter((n) => !!n.pill);
const branchesOf = (node: MapNode) => node.children.filter((n) => n.kind === "route");
/** Beside a card: a spacer wide enough for the trunk its lanes hang off. */
const spacerFor = (lanes: number) => (lanes >= FAN_AT ? FAN_SPACER : DEEP_SPACER);

const fresh = (ctx: TreeCtx, parentId: string) =>
  ctx.unfolding && ctx.isFreshGroup(parentId) ? "transform, opacity" : undefined;

const rootClass = (ctx: TreeCtx) =>
  `wm-row ${ctx.skipOffscreen ? "[content-visibility:auto] [contain-intrinsic-size:auto_60px]" : ""}`;

/** Bands of a row, top to bottom. */
const ABOVE = 1;
const RAIL_BAND = 2;
const CALLS = 3;
const MORE = 4;
const grid = (columns: number, rows: number | "subgrid"): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(${columns}, auto)`,
  gridTemplateRows: rows === "subgrid" ? "subgrid" : `repeat(${rows}, auto)`,
  justifyItems: "start",
  alignItems: "start",
});

const Gap = ({ width }: { width: number }) => <div className="flex-none" style={{ width }} />;

/** One card: a workflow pill or a step card, wired to the tree context. */
function Card({ node, ctx, drop }: { node: MapNode; ctx: TreeCtx; drop?: number }) {
  const selected = node.id === ctx.selectedId;
  const pair = ctx.pairRoleOf(node.id);
  const pairProps = pair ? { className: "wm-pair", "data-pulse": String(ctx.pairTick % 2), "data-pair": pair } : null;
  const run = ctx.runActive ? ctx.runStateOf(node) : null;
  if (node.pill) {
    const runMeta = ctx.runActive && ctx.runMetaOf ? ctx.runMetaOf(node) : null;
    const pill = (
      <WorkflowPill
        node={node}
        selected={selected}
        pair={pairProps}
        itemProps={ctx.itemProps(node)}
        nodeRef={ctx.refFor(node.id)}
        onClick={ctx.onClick}
        onToggle={ctx.onToggle}
        far={ctx.far}
        run={run}
        runMeta={runMeta}
      />
    );
    /* Always its own wrapper, nudged or not: nothing but this one pill ever
       shares a parent with it. */
    return (
      <div className="flex flex-none" style={drop ? { marginTop: drop } : undefined}>
        {pill}
      </div>
    );
  }
  return (
    <StepNode
      node={node}
      selected={selected}
      itemProps={ctx.itemProps(node)}
      nodeRef={ctx.refFor(node.id)}
      onClick={ctx.onClick}
      srNote={ctx.srNoteFor?.(node)}
      onDrillIn={ctx.onDrillIn}
      far={ctx.far}
      pair={pairProps}
      run={run}
      runError={run && ctx.runErrorOf ? ctx.runErrorOf(node) : null}
    />
  );
}

/** A lane in a fan: a branch runs right, a connected workflow's pill runs
 *  down, its centre dropped onto the rail of the card it fans from. */
function Lane({ node, ctx }: { node: MapNode; ctx: TreeCtx }) {
  return flowsRight(node) ? <RowLane node={node} ctx={ctx} /> : <ColumnLane node={node} ctx={ctx} beside />;
}

/**
 * Lanes centred on a card's rail, as two grid items in `column`: the first
 * half over the rail in the band above, the rest from the rail down. With an
 * odd count the middle lane's first card sits on the rail; with an even one
 * the rail runs through the gap between the middle two.
 */
function Fan({ lanes, column, parentId, ctx, label }: { lanes: MapNode[]; column: number; parentId: string; ctx: TreeCtx; label: string }) {
  const { above, onRail } = fanSplit(lanes.length);
  const rail = fanRail(ctx);
  const marginLeft = spacerFor(lanes.length);
  const willChange = fresh(ctx, parentId);
  return (
    <>
      {above > 0 && (
        <div
          role="group"
          aria-label={label}
          className="flex flex-col items-start"
          style={{
            gridRow: ABOVE,
            gridColumn: column,
            alignSelf: "end",
            marginLeft,
            marginBottom: onRail ? LANE_GAP : LANE_GAP / 2 - rail,
            gap: LANE_GAP,
            willChange,
          }}
        >
          {lanes.slice(0, above).map((lane) => (
            <Lane key={lane.id} node={lane} ctx={ctx} />
          ))}
        </div>
      )}
      <div
        role="group"
        aria-label={above > 0 ? undefined : label}
        className="flex flex-col items-start"
        style={{ gridRow: RAIL_BAND, gridColumn: column, marginLeft, marginTop: onRail ? 0 : rail + LANE_GAP / 2, gap: LANE_GAP, willChange }}
      >
        {lanes.slice(above).map((lane) => (
          <Lane key={lane.id} node={lane} ctx={ctx} />
        ))}
      </div>
    </>
  );
}

/** The steps a card's lanes share, in a column of their own, first on the rail. */
function SharedSteps({ node, ctx, style }: { node: MapNode; ctx: TreeCtx; style: CSSProperties }) {
  return (
    <div role="group" aria-label="Shared steps" className="flex flex-col items-start" style={{ gap: LANE_GAP, ...style }}>
      {node.joins.map((head) =>
        flowsRight(head) ? <Row key={head.id} chain={[head, ...chainsOf(head).flat()]} ctx={ctx} /> : <ColumnJoin key={head.id} head={head} ctx={ctx} />,
      )}
    </div>
  );
}

/* ── rows: left to right ──────────────────────────────────────────────── */

/**
 * A group that runs right — the viewed pill, or a branch anywhere — with its
 * card on its first row's rail, further entry chains stacked under that row,
 * and the steps they share beyond them.
 */
function RowLane({ node, ctx, root = false, hub = false }: { node: MapNode; ctx: TreeCtx; root?: boolean; hub?: boolean }) {
  const [first, ...more] = chainsOf(node);
  const joins = node.joins;
  const lanes = more.length > 0 || joins.length > 0;
  const gap = !lanes ? CHAIN_GAP : more.length + 1 >= FAN_AT ? FAN_SPACER : root ? ROOT_SPACER : DEEP_SPACER;
  const heavy = joins.reduce((n, j) => n + 1 + j.descendants, 0) >= TALL_COLUMN_AT;
  return (
    <div
      ref={root ? ctx.rowRefFor(node.id) : undefined}
      className={root ? rootClass(ctx) : undefined}
      style={{ ...grid(3, hub ? "subgrid" : 4), ...(hub ? { gridRow: `${ABOVE} / span 4`, gridColumn: 3 } : null) }}
    >
      <div className="flex flex-none" style={{ gridRow: RAIL_BAND, gridColumn: 1, marginRight: first || joins.length > 0 ? gap : undefined }}>
        <Card node={node} ctx={ctx} drop={node.pill ? railDrop(node) : undefined} />
      </div>
      {first && <Row chain={first} ctx={ctx} inLane />}
      {more.length > 0 && (
        <div role="group" className="flex flex-col items-start" style={{ gridRow: MORE, gridColumn: 2, marginTop: LANE_GAP, gap: LANE_GAP, willChange: fresh(ctx, node.id) }}>
          {more.map((chain) => (
            <Row key={chain[0].id} chain={chain} ctx={ctx} />
          ))}
        </div>
      )}
      {joins.length > 0 && (
        <SharedSteps
          node={node}
          ctx={ctx}
          style={{ gridRow: `${RAIL_BAND} / span 3`, gridColumn: 3, marginLeft: first ? DEEP_SPACER : undefined, alignSelf: heavy ? "start" : "center" }}
        />
      )}
    </div>
  );
}

/**
 * One row, one grid column per card. The cards come first, left to right on
 * the rail band, then what hangs below each card in the next row of the same
 * columns — so DOM order is reading order, which the entrance stagger
 * follows. Those two rows are a subgrid of their own, sized by the cards and
 * what hangs from them alone: a workflow hangs directly under its step
 * however tall the branches beside the row, and one wider than its card
 * widens only that card's column, pushing the rest of the row right.
 *
 * When the row ends at a fan-out, its branches follow, centred on the rail
 * beside the last card, then the steps they share, then what the fan-out
 * card itself calls, in the band below the whole fan so the trunk never
 * crosses it. `inLane` makes the row a subgrid of its group's lane, so the
 * group's card shares the rail band.
 */
function Row({ chain, ctx, inLane = false }: { chain: MapNode[]; ctx: TreeCtx; inLane?: boolean }) {
  const n = chain.length;
  const last = chain[n - 1];
  const branches = branchesOf(last);
  const fan = branches.length > 0 || last.joins.length > 0;
  const gapAfter = (i: number) => (i < n - 1 ? CHAIN_GAP : undefined);
  const lastCalls = fan ? pillsOf(last) : [];
  return (
    <div style={{ ...grid(n + 2, inLane ? "subgrid" : 3), ...(inLane ? { gridRow: `${ABOVE} / span 3`, gridColumn: 2 } : null) }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "subgrid",
          gridTemplateRows: "repeat(2, auto)",
          gridRow: RAIL_BAND,
          gridColumn: `1 / span ${n}`,
          justifyItems: "start",
          alignItems: "start",
        }}
      >
        {chain.map((node, i) => (
          <div key={node.id} className="flex flex-none" style={{ gridRow: 1, gridColumn: i + 1, marginRight: gapAfter(i) }}>
            <Card node={node} ctx={ctx} />
          </div>
        ))}
        {chain.map((node, i) => {
          const pills = fan && i === n - 1 ? [] : pillsOf(node);
          return pills.length > 0 ? (
            <div key={`${node.id}/calls`} style={{ gridRow: 2, gridColumn: i + 1, marginRight: gapAfter(i) }}>
              <Hanging node={node} pills={pills} ctx={ctx} />
            </div>
          ) : null;
        })}
      </div>
      {branches.length > 0 && <Fan lanes={branches} column={n + 1} parentId={last.id} ctx={ctx} label="Branches" />}
      {last.joins.length > 0 && (
        <SharedSteps node={last} ctx={ctx} style={{ gridRow: RAIL_BAND, gridColumn: n + 2, marginLeft: DEEP_SPACER }} />
      )}
      {lastCalls.length > 0 && (
        <div style={{ gridRow: CALLS, gridColumn: n }}>
          <Hanging node={last} pills={lastCalls} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

/** The workflows a row's card calls, under it: each a column of its own,
 *  indented so the drop line runs down and then right into its pill. */
function Hanging({ node, pills, ctx }: { node: MapNode; pills: MapNode[]; ctx: TreeCtx }) {
  return (
    <div
      role="group"
      aria-label="Workflows this step calls"
      className="flex flex-col items-start"
      style={{ marginTop: HANG_GAP, paddingLeft: DROP_X + HANG_RUN, gap: LANE_GAP, willChange: fresh(ctx, node.id) }}
    >
      {pills.map((pill) => (
        <ColumnLane key={pill.id} node={pill} ctx={ctx} />
      ))}
    </div>
  );
}

/* ── columns: a connected workflow's trunk, top to bottom ─────────────── */

/** A connected workflow's pill, or a shared step of its trunk, with its chain
 *  stacked under it; or, with several entries or shared steps, its chains in
 *  a column to its right. */
function ColumnLane({ node, ctx, root = false, beside = false }: { node: MapNode; ctx: TreeCtx; root?: boolean; beside?: boolean }) {
  const chains = chainsOf(node);
  const ref = root ? ctx.rowRefFor(node.id) : undefined;
  if (stacksChain(node)) {
    return (
      <div ref={ref} className={`flex flex-none flex-col items-start ${root ? rootClass(ctx) : ""}`}>
        <Card node={node} ctx={ctx} drop={beside ? laneDrop(ctx) : undefined} />
        {chains[0] && <Column chain={chains[0]} ctx={ctx} parentId={node.id} below />}
      </div>
    );
  }
  const heavy = node.joins.reduce((n, j) => n + 1 + j.descendants, 0) >= TALL_COLUMN_AT;
  return (
    <div ref={ref} className={`flex items-start ${root ? rootClass(ctx) : ""}`}>
      <Card node={node} ctx={ctx} drop={laneDrop(ctx)} />
      <Gap width={spacerFor(chains.length)} />
      {chains.length > 0 && (
        <div role="group" className="flex flex-col items-start" style={{ gap: LANE_GAP, willChange: fresh(ctx, node.id) }}>
          {chains.map((chain) => (
            <Column key={chain[0].id} chain={chain} ctx={ctx} parentId={node.id} />
          ))}
        </div>
      )}
      {node.joins.length > 0 && (
        <SharedSteps node={node} ctx={ctx} style={{ marginLeft: chains.length > 0 ? DEEP_SPACER : undefined, alignSelf: heavy ? "flex-start" : "center" }} />
      )}
    </div>
  );
}

/** A chain of a connected workflow's trunk: one left-aligned column. */
function Column({ chain, ctx, parentId, below = false }: { chain: MapNode[]; ctx: TreeCtx; parentId: string; below?: boolean }) {
  return (
    <div
      role="group"
      className="flex flex-none flex-col items-start"
      style={{ gap: COLUMN_GAP, marginTop: below ? COLUMN_GAP : undefined, willChange: below ? fresh(ctx, parentId) : undefined }}
    >
      {chain.map((node) => (
        <ColumnRow key={node.id} node={node} ctx={ctx} />
      ))}
    </div>
  );
}

/** A card in a trunk column, with its branches and what it calls beside it,
 *  centred on its rail, and the steps those share beyond them. */
function ColumnRow({ node, ctx }: { node: MapNode; ctx: TreeCtx }) {
  const side = node.children.filter((k) => k.kind !== "step");
  if (side.length === 0 && node.joins.length === 0)
    return (
      <div className="flex flex-none">
        <Card node={node} ctx={ctx} />
      </div>
    );
  return (
    <div style={grid(3, 2)}>
      <div className="flex flex-none" style={{ gridRow: RAIL_BAND, gridColumn: 1 }}>
        <Card node={node} ctx={ctx} />
      </div>
      {side.length > 0 && <Fan lanes={side} column={2} parentId={node.id} ctx={ctx} label="Branches and workflows this step calls" />}
      {node.joins.length > 0 && (
        <SharedSteps node={node} ctx={ctx} style={{ gridRow: RAIL_BAND, gridColumn: 3, marginLeft: DEEP_SPACER }} />
      )}
    </div>
  );
}

/** A shared step of a trunk: its own row, then its chain under it. */
function ColumnJoin({ head, ctx }: { head: MapNode; ctx: TreeCtx }) {
  const chain = chainsOf(head).flat();
  return (
    <div className="flex flex-none flex-col items-start">
      <ColumnRow node={head} ctx={ctx} />
      {chain.length > 0 && <Column chain={chain} ctx={ctx} parentId={head.id} below />}
    </div>
  );
}

function TopRows({ rows, ctx }: { rows: MapNode[]; ctx: TreeCtx }) {
  return (
    <>
      {rows.map((r) =>
        ctx.near !== null && !ctx.near.has(r.id) ? (
          <div
            key={r.id}
            ref={ctx.placeholderRefFor(r.id)}
            aria-hidden="true"
            style={{ height: ctx.heightOf(r.id) }}
          />
        ) : flowsRight(r) ? (
          <RowLane key={r.id} node={r} ctx={ctx} root />
        ) : (
          <ColumnLane key={r.id} node={r} ctx={ctx} root />
        ),
      )}
    </>
  );
}

/*
 * Hub layout: [callers block][spacer][viewed tree], one grid. The viewed
 * pill's lane is a subgrid of it, so the callers block sits in the same rail
 * band as the viewed pill, however many branches rise above that row. The
 * block is a column of top-level rows — folded pills; an expanded caller is a
 * connected workflow and grows its column inside the block, which is `w-max`,
 * so the viewed tree just shifts right. With ≤ 3 folded callers the middle of
 * the callers' centres meets the viewed pill's rail (estimated from pill and
 * meta heights, no DOM read); a taller or expanded block top-aligns with the
 * pill's row. Both kinds of row register as root rows for the measure hook
 * (IntersectionObserver gate + windowing).
 */
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
  const viewed = roots.length === 1 && flowsRight(roots[0]) && (ctx.near === null || ctx.near.has(roots[0].id)) ? roots[0] : null;
  if (callers.length === 0 || !viewed) {
    return (
      <div className="flex items-start">
        {callers.length > 0 && (
          <>
            <div role="group" aria-label="Workflows that call this one" className="flex w-max flex-col items-start" style={{ gap: LANE_GAP }}>
              <TopRows rows={callers} ctx={ctx} />
            </div>
            <div className="flex-none" style={{ width: ROOT_SPACER }} />
          </>
        )}
        <div className="flex flex-col items-start" style={{ gap: ROW_GAP }}>
          <TopRows rows={roots} ctx={ctx} />
        </div>
      </div>
    );
  }
  const short =
    callers.length <= 3 &&
    callers.every((c) => !c.pill?.open && c.children.length === 0);
  /* The last caller's top: every caller above it, its meta line and a gap. */
  const lastTop = callers
    .slice(0, -1)
    .reduce((y, c) => y + PILL_MIN_H + ((c.meta || (ctx.runActive && ctx.runMetaOf?.(c))) && !ctx.far ? META_H : 0) + LANE_GAP, 0);
  /* How far the callers block sits below the viewed pill's row when the
     middle of the callers' centres meets the pill's rail. Negative: it rises
     above the row, and the whole hub makes that room at its top. */
  const offset = short ? Math.round(CHAIN_RAIL_Y - PILL_MIN_H / 2 - lastTop / 2) : 0;
  return (
    <div style={{ ...grid(3, 4), gridTemplateColumns: `auto ${ROOT_SPACER}px auto`, paddingTop: offset < 0 ? -offset : undefined }}>
      <div
        role="group"
        aria-label="Workflows that call this one"
        className="flex w-max flex-col items-start"
        style={{ gridRow: RAIL_BAND, gridColumn: 1, gap: LANE_GAP, marginTop: offset !== 0 ? offset : undefined }}
      >
        <TopRows rows={callers} ctx={ctx} />
      </div>
      <RowLane node={viewed} ctx={ctx} root hub />
    </div>
  );
}
