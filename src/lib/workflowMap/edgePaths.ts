import { CHAIN_RAIL_Y, EDGE_MIN_RUN, ELBOW_R } from "./tokens.ts";

/*
 * The shapes of the workflow map's orthogonal lines, from their end points.
 *
 * `useMapMeasure` measures the cards and picks a shape for each pair; these
 * turn the numbers into a path. Pure and free of React and the DOM, so the
 * verdict checks run them under node — the same functions the map draws with,
 * not a copy of them. Every coordinate is in the edge layer's user space.
 */

/**
 * Where a line with no anchor meets a card, from the card's top and bottom:
 * on its rail, CHAIN_RAIL_Y below its top — the height every card of a row
 * shares, and the one a Condition's branches are centred on — so a fan leaves
 * from the rail its lanes are centred on and lands on each lane's own. A pill
 * meets it at its centre, which is what sits on the rail when a pill starts a
 * row, and so does a card shorter than two rail heights (a far-mode tile),
 * whose rail would sit below its middle.
 */
export function railY(pill: boolean, top: number, bottom: number): number {
  return pill || bottom - top < 2 * CHAIN_RAIL_Y ? (top + bottom) / 2 : top + CHAIN_RAIL_Y;
}

/** A chain link along a row: one straight segment on the target's rail. */
export function railPath(sx: number, tx: number, rail: number): string {
  return `M ${sx} ${rail} L ${tx} ${rail}`;
}

/** A chain link down a column: one straight segment under the pucks. */
export function columnPath(x: number, sy: number, ty: number): string {
  return `M ${x} ${sy} L ${x} ${ty}`;
}

/**
 * A drop from a step to a pill hanging below it: straight down from the
 * step's bottom to the pill's vertical centre, then right into its left edge,
 * one corner — rounded where there is room. Orthogonal, like a stub. Ends on
 * `L tx ty`.
 */
export function dropPath(sx: number, sy: number, tx: number, ty: number): string {
  const r = ELBOW_R;
  if (ty - sy <= r || tx - sx <= r) return `M ${sx} ${sy} V ${ty} L ${tx} ${ty}`;
  return `M ${sx} ${sy} V ${ty - r} Q ${sx} ${ty} ${sx + r} ${ty} L ${tx} ${ty}`;
}

/**
 * Back-edge (target left of, or level with, the source): out to the right
 * of the source, down/up to the gap between the rows, left past the target,
 * then into its left-centre — never across a card. Ends on `L tx ty`.
 */
export function backPath(sx: number, sy: number, tx: number, ty: number): string {
  const r = ELBOW_R;
  const run = EDGE_MIN_RUN;
  const x1 = sx + run; // right of the source
  const x2 = tx - run; // left of the target
  const midY = Math.round(((sy + ty) / 2) * 2) / 2;
  if (Math.abs(ty - sy) <= 2 * r) return `M ${sx} ${sy} L ${tx} ${ty}`;
  const s = ty > sy ? 1 : -1;
  return [
    `M ${sx} ${sy}`,
    `H ${x1 - r}`,
    `Q ${x1} ${sy} ${x1} ${sy + s * r}`,
    `V ${midY - s * r}`,
    `Q ${x1} ${midY} ${x1 - r} ${midY}`,
    `H ${x2 + r}`,
    `Q ${x2} ${midY} ${x2} ${midY + s * r}`,
    `V ${ty - s * r}`,
    `Q ${x2} ${ty} ${x2 + r} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(" ");
}

/** Whether the stub to a child's row turns a corner off the trunk: the row is
 *  more than two corner radii from the parent's, and there is room for the
 *  corner before the child. Otherwise it runs straight along the row. */
function turns(sy: number, ty: number, trunkX: number, tx: number): boolean {
  return Math.abs(ty - sy) > 2 * ELBOW_R && tx - trunkX >= ELBOW_R;
}

/**
 * One trunk per elbow parent: parent → trunkX, then along the trunk to the
 * outermost children, `tx` being the children's nearest left edge.
 *
 * Each leg ends exactly where the outermost stub on its side starts — at the
 * start of its corner, ELBOW_R short of the row, or on the row when the stub
 * runs straight — so no leg runs on past the curve that leaves it.
 *
 * A fan-out centred on its branches has children above the parent's row as
 * well as below it, so the trunk goes straight into its junction and gets one
 * leg per side, each its own subpath starting at the parent. A line draws,
 * drifts and carries its pulse from its start, so both legs run away from the
 * parent — one top-to-bottom stroke would run the upper leg toward it, and
 * draw it detached from the parent until it reached the parent's row. The
 * same shape serves a child level with the parent, whose stub carries straight
 * on from the junction. Only when every child is on one side, clear of the
 * parent's row, does the trunk turn off it with a rounded corner instead.
 * Starts on `M sx sy`.
 */
export function trunkPath(sx: number, sy: number, trunkX: number, minTy: number, maxTy: number, tx: number): string {
  const r = ELBOW_R;
  const top = turns(sy, minTy, trunkX, tx) ? minTy + r : minTy;
  const bottom = turns(sy, maxTy, trunkX, tx) ? maxTy - r : maxTy;
  if (trunkX - sx >= r && minTy > sy + r) return `M ${sx} ${sy} H ${trunkX - r} Q ${trunkX} ${sy} ${trunkX} ${sy + r} V ${bottom}`;
  if (trunkX - sx >= r && maxTy < sy - r) return `M ${sx} ${sy} H ${trunkX - r} Q ${trunkX} ${sy} ${trunkX} ${sy - r} V ${top}`;
  const into = trunkX - sx < r ? `L ${trunkX} ${sy}` : `H ${trunkX}`;
  const ends = [minTy < sy ? top : null, maxTy > sy ? bottom : null].filter((y): y is number => y !== null);
  return ends.length > 0 ? ends.map((y) => `M ${sx} ${sy} ${into} V ${y}`).join(" ") : `M ${sx} ${sy} ${into}`;
}

/** Fan-in (several callers into the viewed pill): one trunk left of the
 *  target spanning every source's row, ending with the single stub into the
 *  target — its LAST point is the target's left-centre. */
export function trunkInPath(trunkX: number, minSy: number, maxSy: number, tx: number, ty: number): string {
  const top = Math.min(minSy, ty);
  const bottom = Math.max(maxSy, ty);
  return `M ${trunkX} ${top} V ${bottom} M ${trunkX} ${ty} L ${tx} ${ty}`;
}

/** Fan-in source stub: from the source's right-centre onto the trunk, with
 *  the rounded corner turning toward the target's row. Starts on `M sx sy`. */
export function stubInPath(sx: number, sy: number, trunkX: number, ty: number): string {
  const r = ELBOW_R;
  const dy = ty - sy;
  if (Math.abs(dy) <= 2 * r || trunkX - sx < r) return `M ${sx} ${sy} L ${trunkX} ${sy}`;
  const s = dy > 0 ? 1 : -1;
  return `M ${sx} ${sy} H ${trunkX - r} Q ${trunkX} ${sy} ${trunkX} ${sy + s * r}`;
}

/** One stub per elbow child: off the trunk at the child's row (rounded
 *  corner on the side the trunk arrives from) into the child's left-centre. */
export function stubPath(trunkX: number, sy: number, tx: number, ty: number): string {
  const r = ELBOW_R;
  if (!turns(sy, ty, trunkX, tx)) return `M ${trunkX} ${ty} L ${tx} ${ty}`;
  const s = ty > sy ? 1 : -1;
  return `M ${trunkX} ${ty - s * r} Q ${trunkX} ${ty} ${trunkX + r} ${ty} L ${tx} ${ty}`;
}

/**
 * Orthogonal route with rounded corners: right from the parent to the trunk,
 * along the trunk to the child's row, right to the child. Ends on an
 * absolute `L tx ty` so the last point is always the child's left-centre.
 * Rows within one corner radius of each other get a straight line.
 */
export function elbowPath(sx: number, sy: number, trunkX: number, tx: number, ty: number): string {
  const r = ELBOW_R;
  const dy = ty - sy;
  if (Math.abs(dy) <= 2 * r || trunkX - sx < r || tx - trunkX < r) return `M ${sx} ${sy} L ${tx} ${ty}`;
  const s = dy > 0 ? 1 : -1;
  return [
    `M ${sx} ${sy}`,
    `H ${trunkX - r}`,
    `Q ${trunkX} ${sy} ${trunkX} ${sy + s * r}`,
    `V ${ty - s * r}`,
    `Q ${trunkX} ${ty} ${trunkX + r} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(" ");
}
