import { edgePath } from "@/components/canvas/layout";
import { ACTION_KIND_LABEL, ASSET_KIND_LABEL } from "./labels";
import type { MartechBox, MartechLayout, MartechLayoutEdge, MartechModel, MartechNode } from "./types";

/*
 * layoutMartech — deterministic placement for the fixed diagram grammar.
 * Pure: no React, no DOM. `computeLayout`'s barycenter ordering is wrong
 * here on purpose — the column order *is* the funnel order.
 *
 * Column x runs left → right (ad, then stage / decision columns). Inside a
 * stage column: the page card, a stem, the stage bar, a stem, then rows of
 * 116px-wide cards in two sub-lanes — assets and the pixel facet on the
 * left, each automation's trigger + actions on the right. A trigger starts
 * on the row of the asset it fires on (so the fires-on edge is horizontal),
 * actions stack below, and one blank row separates automations.
 *
 * Names are never cut: every card wraps its text and grows. Heights come
 * from `nodeHeight`, a generous character-count estimate of the wrapped
 * line count (there is no DOM here), so the constants below are minimums:
 * a one-line card keeps its classic size, a longer name makes its row —
 * and, on the spine, the whole page or stage band — taller. Card roots use
 * min-height, so an estimate that still falls short lets the card outgrow
 * its box rather than clip a name.
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
/** Gap between sub-lane rows (ROW_H − CARD_H when every card is one line). */
export const ROW_GAP = ROW_H - CARD_H;
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

/* ---- text metrics — a pure, deliberately generous estimate ---- */

/** Average glyph width as a fraction of the font size, erring wide so a
 * card is sooner too tall than too short. */
const SANS_EM = 0.54;
const MONO_EM = 0.62;
const CAPS_EM = 0.68;

/** Lines `text` takes when wrapped (words first, then anywhere) in `widthPx`. */
export function estimateLines(text: string | null | undefined, widthPx: number, fontPx: number, em = SANS_EM): number {
  const words = (text ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const perLine = Math.max(1, Math.floor(widthPx / (fontPx * em)));
  let lines = 1;
  let col = 0;
  for (const word of words) {
    let len = word.length;
    if (col > 0 && col + 1 + len <= perLine) {
      col += 1 + len;
      continue;
    }
    if (col > 0) lines++;
    while (len > perLine) {
      lines++;
      len -= perLine;
    }
    col = len;
  }
  return lines;
}

const textH = (text: string | null | undefined, w: number, fontPx: number, lineH: number, em?: number) => estimateLines(text, w, fontPx, em) * lineH;

/** Line heights matching the node components (leading-tight = 1.25 for names). */
const PAGE_TEXT_W = (w: number) => w - 22; // px-2.5 + border
const STAGE_TEXT_W = COL_W - 24 - 24 - 10 - 2; // px-3, position badge, gap, border
const DECISION_TEXT_W = DECISION_W - 20 - 28 - 8 - 2;
const AD_TEXT_W = AD_W - 24 - 32 - 10 - 2;
const CARD_TEXT_W = SUB_W - 16 - 24 - 8 - 2;

function cardCaption(n: MartechNode): string {
  switch (n.kind) {
    case "asset":
      return ASSET_KIND_LABEL[n.asset.kind];
    case "pixel":
      return "Pixel";
    case "trigger":
      return "Trigger";
    case "action":
      return n.action ? ACTION_KIND_LABEL[n.action.kind] : "Actions";
    default:
      return "";
  }
}

/** Height of a node's card once its text wraps; never below the kind's minimum. */
export function nodeHeight(n: MartechNode): number {
  switch (n.kind) {
    case "ad":
      return Math.max(AD_H, 32 + textH(n.label, AD_TEXT_W, 12.5, 16) + textH(n.sublabel, AD_TEXT_W, 10, 13));
    case "page": {
      const branch = n.lane === "branch";
      const w = PAGE_TEXT_W(branch ? BRANCH_PAGE_W : PAGE_W);
      const sub = n.sublabel ?? (n.evidence === "not-captured" ? "Not captured" : "");
      const strip = 12 + textH(n.label, w, 12, 15) + Math.max(13, textH(sub, w, 9.5, 13, MONO_EM));
      return Math.max(branch ? BRANCH_PAGE_H : PAGE_H, (branch ? BRANCH_THUMB_H : THUMB_H) + strip);
    }
    case "stage":
      return Math.max(STAGE_H, 24 + textH(n.label, STAGE_TEXT_W, 12.5, 16) + textH(n.sublabel, STAGE_TEXT_W, 10, 13));
    case "decision": {
      const outcomes = n.decision.branches.map((b) => b.outcome);
      const sub = outcomes.length ? outcomes.join(" / ") : n.sublabel;
      return Math.max(STAGE_H, 24 + textH(n.label, DECISION_TEXT_W, 12, 15) + textH(sub, DECISION_TEXT_W, 9.5, 12, CAPS_EM));
    }
    default:
      return Math.max(CARD_H, 24 + textH(cardCaption(n), CARD_TEXT_W, 9, 12, CAPS_EM) + textH(n.label, CARD_TEXT_W, 11, 14));
  }
}

type Slot = { id: string; x: number; w: number; h: number };

export function layoutMartech(model: MartechModel): MartechLayout {
  const boxes = new Map<string, MartechBox>();
  const columnOf = new Map<string, number>();
  const rowOf = new Map<string, number>();
  const order: string[] = [];
  const heightOf = new Map(model.nodes.map((n) => [n.id, nodeHeight(n)]));
  const hOf = (id: string) => heightOf.get(id) ?? CARD_H;

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

  /* ---- spine bands: the tallest page / stage head sets the band so every
          column's stage bar (and its sub-rows) starts on one line ---- */
  let pageBand = PAGE_H;
  let stageBand = STAGE_H;
  for (const c of model.columns) {
    if (c.kind === "stage") {
      pageBand = Math.max(pageBand, hOf(c.headIds[0]));
      stageBand = Math.max(stageBand, hOf(c.headIds[1]));
    } else if (c.kind === "decision") {
      stageBand = Math.max(stageBand, hOf(c.headIds[0]));
    }
  }
  const stageY = MARGIN_Y + pageBand + STEM_H;
  /** Where the sub-rows start under a stage bar. */
  const rowsY = stageY + stageBand + STEM_H;

  let maxBottom = rowsY;
  const place = (id: string, col: number, box: MartechBox) => {
    boxes.set(id, box);
    columnOf.set(id, col);
    maxBottom = Math.max(maxBottom, box.y + box.h);
  };

  /* ---- heads; sub-lane cards are collected into rows first, because a
          row is as tall as its tallest card ---- */
  const colRows: Slot[][][] = model.columns.map(() => []);
  const slot = (ci: number, row: number, s: Slot) => {
    const rows = colRows[ci];
    while (rows.length <= row) rows.push([]);
    rows[row].push(s);
  };

  model.columns.forEach((c, ci) => {
    const cx = colX[ci];
    if (c.kind === "ad") {
      const h = hOf(c.headIds[0]);
      place(c.headIds[0], ci, { x: cx, y: MARGIN_Y + THUMB_H / 2 - h / 2, w: AD_W, h });
      return;
    }
    if (c.kind === "stage") {
      const [pageId, stageId] = c.headIds;
      place(pageId, ci, { x: cx, y: MARGIN_Y, w: PAGE_W, h: hOf(pageId) });
      place(stageId, ci, { x: cx, y: stageY, w: COL_W, h: hOf(stageId) });
    } else {
      const [decisionId, branchPageId] = c.headIds;
      place(decisionId, ci, { x: cx, y: stageY, w: DECISION_W, h: hOf(decisionId) });
      // The branch page is the first row of a decision column.
      if (branchPageId) slot(ci, 0, { id: branchPageId, x: cx, w: BRANCH_PAGE_W, h: hOf(branchPageId) });
    }
    c.left.forEach((id, r) => {
      rowOf.set(id, r);
      slot(ci, r, { id, x: cx, w: SUB_W, h: hOf(id) });
    });
  });

  /* ---- right lanes: automation stacks ---- */
  model.columns.forEach((c, ci) => {
    if (c.kind === "ad") return;
    const cx = colX[ci];
    const laneX = c.kind === "decision" ? cx + (DECISION_W - SUB_W) / 2 : cx + SUB_W + SUB_GAP;
    // The branch page takes row 0 of a decision column; one blank row after it.
    let cursor = c.kind === "decision" && c.headIds[1] ? 2 : 0;
    for (const s of c.stacks) {
      const assetRow = s.assetNodeId ? rowOf.get(s.assetNodeId) : undefined;
      const start = Math.max(cursor, assetRow ?? 0);
      rowOf.set(s.triggerId, start);
      slot(ci, start, { id: s.triggerId, x: laneX, w: SUB_W, h: hOf(s.triggerId) });
      s.actionIds.forEach((id, i) => {
        rowOf.set(id, start + 1 + i);
        slot(ci, start + 1 + i, { id, x: laneX, w: SUB_W, h: hOf(id) });
      });
      cursor = start + 1 + s.actionIds.length + 1;
    }
  });

  /* ---- rows: cumulative tops per column, each row as tall as its tallest card ---- */
  colRows.forEach((rows, ci) => {
    let y = rowsY;
    for (const row of rows) {
      const rowH = row.reduce((m, s) => Math.max(m, s.h), CARD_H);
      for (const s of row) place(s.id, ci, { x: s.x, y, w: s.w, h: s.h });
      y += rowH + ROW_GAP;
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
