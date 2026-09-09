import { edgePath } from "@/components/canvas/layout";
import type { MartechBox, MartechLayout, MartechLayoutEdge, MartechModel } from "./types";

/*
 * layoutMartech — deterministic placement for the fixed diagram grammar.
 * Pure: no React, no DOM. `computeLayout`'s barycenter ordering is wrong
 * here on purpose — the column order *is* the funnel order.
 *
 * Column x runs left → right (ad, then stage / decision columns). Inside a
 * stage column: the page card, a stem, the stage bar, a stem, then rows of
 * 116px cards in two sub-lanes — assets and the pixel facet on the left,
 * each automation's trigger + actions on the right. A trigger starts on the
 * row of the asset it fires on (so the fires-on edge is horizontal), actions
 * stack below, and one blank row separates automations.
 */

export const MARGIN_X = 96;
export const MARGIN_Y = 72;
export const AD_W = 200;
export const AD_H = 64;
export const COL_W = 240;
export const COL_GAP = 64;
export const PAGE_W = 240;
export const THUMB_H = 135; // 16:9 of PAGE_W
export const PAGE_H = 186;
export const STEM_H = 20;
export const STAGE_H = 48;
export const DECISION_W = 160;
export const SUB_W = 116;
export const SUB_GAP = 8;
export const CARD_H = 54;
export const ROW_H = 66;
export const FIT_MIN = 0.45;
export const FIT_MAX = 1.0;

/** The disqualified page renders narrower, inside the decision column. */
export const BRANCH_PAGE_W = DECISION_W;
export const BRANCH_THUMB_H = 90; // 16:9 of BRANCH_PAGE_W
export const BRANCH_PAGE_H = 130;

/** Vertical S-curve: bottom-centre of one box to top-centre of another. */
export function edgePathV(x1: number, y1: number, x2: number, y2: number): string {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

const STAGE_Y = MARGIN_Y + PAGE_H + STEM_H;
/** Where the sub-rows start under a stage bar. */
const ROWS_Y = STAGE_Y + STAGE_H + STEM_H;

export function layoutMartech(model: MartechModel): MartechLayout {
  const boxes = new Map<string, MartechBox>();
  const columnOf = new Map<string, number>();
  const rowOf = new Map<string, number>();
  const order: string[] = [];

  /* ---- column x positions ---- */
  const colX: number[] = [];
  const colW: number[] = [];
  let x = MARGIN_X;
  for (const c of model.columns) {
    const w = c.kind === "ad" ? AD_W : c.kind === "decision" ? DECISION_W : COL_W;
    colX.push(x);
    colW.push(w);
    x += w + COL_GAP;
  }
  const worldW = x - COL_GAP + MARGIN_X;

  /* ---- heads and left lanes (rows of assets are needed before stacks) ---- */
  let maxBottom = ROWS_Y;
  const place = (id: string, col: number, box: MartechBox) => {
    boxes.set(id, box);
    columnOf.set(id, col);
    maxBottom = Math.max(maxBottom, box.y + box.h);
  };
  const rowY = (r: number) => ROWS_Y + r * ROW_H;

  model.columns.forEach((c, ci) => {
    const cx = colX[ci];
    if (c.kind === "ad") {
      place(c.headIds[0], ci, { x: cx, y: MARGIN_Y + THUMB_H / 2 - AD_H / 2, w: AD_W, h: AD_H });
      return;
    }
    if (c.kind === "stage") {
      const [pageId, stageId] = c.headIds;
      place(pageId, ci, { x: cx, y: MARGIN_Y, w: PAGE_W, h: PAGE_H });
      place(stageId, ci, { x: cx, y: STAGE_Y, w: COL_W, h: STAGE_H });
    } else {
      const [decisionId, branchPageId] = c.headIds;
      place(decisionId, ci, { x: cx, y: STAGE_Y, w: DECISION_W, h: STAGE_H });
      if (branchPageId) place(branchPageId, ci, { x: cx, y: ROWS_Y, w: BRANCH_PAGE_W, h: BRANCH_PAGE_H });
    }
    c.left.forEach((id, r) => {
      rowOf.set(id, r);
      place(id, ci, { x: cx, y: rowY(r), w: SUB_W, h: CARD_H });
    });
  });

  /* ---- right lanes: automation stacks ---- */
  model.columns.forEach((c, ci) => {
    if (c.kind === "ad") return;
    const cx = colX[ci];
    const laneX = c.kind === "decision" ? cx + (DECISION_W - SUB_W) / 2 : cx + SUB_W + SUB_GAP;
    // The branch page occupies the first rows of a decision column.
    let cursor = c.kind === "decision" && c.headIds[1] ? Math.ceil(BRANCH_PAGE_H / ROW_H) + 1 : 0;
    for (const s of c.stacks) {
      const assetRow = s.assetNodeId ? rowOf.get(s.assetNodeId) : undefined;
      const start = Math.max(cursor, assetRow ?? 0);
      rowOf.set(s.triggerId, start);
      place(s.triggerId, ci, { x: laneX, y: rowY(start), w: SUB_W, h: CARD_H });
      s.actionIds.forEach((id, i) => {
        rowOf.set(id, start + 1 + i);
        place(id, ci, { x: laneX, y: rowY(start + 1 + i), w: SUB_W, h: CARD_H });
      });
      cursor = start + 1 + s.actionIds.length + 1;
    }
  });

  const worldH = maxBottom + MARGIN_Y;

  /* ---- traversal order: column-major, top → bottom, left → right ---- */
  for (let ci = 0; ci < model.columns.length; ci++) {
    const ids = model.nodes.filter((n) => columnOf.get(n.id) === ci).map((n) => n.id);
    ids.sort((a, b) => {
      const A = boxes.get(a)!;
      const B = boxes.get(b)!;
      return A.y - B.y || A.x - B.x;
    });
    order.push(...ids);
  }

  /* ---- edges ---- */
  const edges: MartechLayoutEdge[] = [];
  for (const e of model.edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) continue;
    let d: string;
    let mx: number;
    let my: number;
    if (e.route === "v") {
      const x1 = a.x + a.w / 2;
      const y1 = a.y + a.h;
      const x2 = b.x + b.w / 2;
      const y2 = b.y;
      d = x1 === x2 ? `M ${x1} ${y1} L ${x2} ${y2}` : edgePathV(x1, y1, x2, y2);
      mx = (x1 + x2) / 2;
      my = (y1 + y2) / 2;
    } else if (b.x + b.w / 2 < a.x + a.w / 2) {
      // Target sits to the left (conversion reports back to the ad platform).
      const x1 = a.x;
      const y1 = a.y + a.h / 2;
      const x2 = b.x + b.w;
      const y2 = b.y + b.h / 2;
      d = edgePath(x1, y1, x2, y2);
      mx = (x1 + x2) / 2;
      my = (y1 + y2) / 2;
    } else {
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x;
      const y2 = b.y + b.h / 2;
      d = edgePath(x1, y1, x2, y2);
      mx = (x1 + x2) / 2;
      my = (y1 + y2) / 2;
    }
    edges.push({ id: e.id, d, mx, my });
  }

  return { w: worldW, h: worldH, boxes, edges, order, columnOf };
}
