"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { IconBtn } from "@/components/shell/IconBtn";
import { useCamera } from "@/components/canvas/useCamera";
import { EVIDENCE_LABEL, LITE_AT, roleLabel } from "@/lib/martech/labels";
import { BRANCH_THUMB_H, FIT_MAX, FIT_MIN, THUMB_H } from "@/lib/martech/layout";
import type { MartechEdge, MartechLayout, MartechModel, MartechNode } from "@/lib/martech/types";
import { AdPlatformNode } from "./nodes/AdPlatformNode";
import { CardNode } from "./nodes/CardNode";
import { DecisionNode } from "./nodes/DecisionNode";
import { PageNode } from "./nodes/PageNode";
import { StageNode } from "./nodes/StageNode";

/*
 * Martech canvas — the funnel as one picture: pages left → right, and under
 * each page its assets, pixel facet and automations. Shell: sr-only list →
 * viewport → world → SVG edges → label pills → absolute nodes; the camera
 * is the shared useCamera hook, the placement
 * is layoutMartech. Keyboard: Tab reaches nodes (roving tabindex,
 * column-major), ↑/↓ move within a column, ←/→ across columns, Enter opens;
 * with the viewport focused arrows pan and + / − / F zoom / fit.
 */

const THUMB_PLACEHOLDER_BELOW = 0.4;

export function MartechCanvas({
  model,
  layout,
  selectedId,
  onSelect,
  dockOpen = false,
  dockWidth = 340,
  entrance = true,
  onZoomChange,
}: {
  model: MartechModel;
  layout: MartechLayout;
  selectedId: string | null;
  onSelect: (id: string) => void;
  dockOpen?: boolean;
  dockWidth?: number;
  entrance?: boolean;
  onZoomChange?: (zoom: number) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const lite = model.nodes.length > LITE_AT;
  const camera = useCamera({ worldW: layout.w, worldH: layout.h, dockOpen, dockWidth, fitMin: FIT_MIN, fitMax: FIT_MAX, onZoomChange });
  const { cam, drag, settled, vp } = camera;

  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes]);
  const edgeById = useMemo(() => new Map(model.edges.map((e) => [e.id, e])), [model.edges]);
  const orderIndex = useMemo(() => new Map(layout.order.map((id, i) => [id, i])), [layout.order]);

  const boxCenter = useCallback(
    (id: string) => {
      const b = layout.boxes.get(id);
      return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
    },
    [layout.boxes]
  );

  const select = useCallback(
    (id: string) => {
      onSelect(id);
      const c = boxCenter(id);
      if (c) camera.centerOn(c.x, c.y);
    },
    [onSelect, boxCenter, camera]
  );

  // Programmatic selection brings the node into view.
  useEffect(() => {
    if (selectedId) {
      const c = boxCenter(selectedId);
      if (c) camera.centerOn(c.x, c.y);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /* ---------- keyboard ---------- */

  const [focusId, setFocusId] = useState<string | null>(null);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const tabTarget = focusId && byId.has(focusId) ? focusId : layout.order[0];

  const focusNode = useCallback((id: string | undefined) => {
    if (id) nodeEls.current.get(id)?.focus();
  }, []);

  /** Nearest node (by vertical centre) in the column `dir` steps away. */
  const neighbourAcross = useCallback(
    (id: string, dir: 1 | -1): string | undefined => {
      const col = layout.columnOf.get(id);
      const me = boxCenter(id);
      if (col === undefined || !me) return undefined;
      let target = col + dir;
      while (target >= 0 && target < model.columns.length) {
        let best: string | undefined;
        let bestD = Infinity;
        for (const nid of layout.order) {
          if (layout.columnOf.get(nid) !== target) continue;
          const c = boxCenter(nid);
          if (!c) continue;
          const d = Math.abs(c.y - me.y);
          if (d < bestD) {
            bestD = d;
            best = nid;
          }
        }
        if (best) return best;
        target += dir;
      }
      return undefined;
    },
    [layout, model.columns.length, boxCenter]
  );

  const neighbourWithin = useCallback(
    (id: string, dir: 1 | -1): string | undefined => {
      const col = layout.columnOf.get(id);
      const i = orderIndex.get(id);
      if (col === undefined || i === undefined) return undefined;
      const next = layout.order[i + dir];
      return next && layout.columnOf.get(next) === col ? next : undefined;
    },
    [layout, orderIndex]
  );

  const nodeKeyDown = useCallback(
    (e: React.KeyboardEvent, n: MartechNode) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(n.id);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        focusNode(neighbourWithin(n.id, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusNode(neighbourWithin(n.id, -1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        focusNode(neighbourAcross(n.id, 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        focusNode(neighbourAcross(n.id, -1));
      } else if (e.key === "Home") {
        e.preventDefault();
        focusNode(layout.order[0]);
      } else if (e.key === "End") {
        e.preventDefault();
        focusNode(layout.order[layout.order.length - 1]);
      }
    },
    [select, focusNode, neighbourWithin, neighbourAcross, layout.order]
  );

  const canvasKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      camera.keyDown(e);
    },
    [camera]
  );

  /* ---------- accessibility strings ---------- */

  const outgoing = useMemo(() => {
    const map = new Map<string, MartechEdge[]>();
    for (const e of model.edges) {
      if (!byId.has(e.from) || !byId.has(e.to)) continue;
      map.set(e.from, [...(map.get(e.from) ?? []), e]);
    }
    return map;
  }, [model.edges, byId]);

  const nodeAriaLabel = useCallback(
    (n: MartechNode) => {
      const parts: string[] = [n.label];
      switch (n.kind) {
        case "ad":
          parts.push(n.inferred ? "traffic source, inferred" : "traffic source");
          break;
        case "page":
          parts.push(n.lane === "branch" ? "disqualified page" : "page");
          if (n.role) parts.push(roleLabel(n.role) ?? "");
          break;
        case "stage":
          parts.push(n.position > 0 ? `step ${n.position} of ${n.total}` : "unplaced automations");
          break;
        case "decision":
          parts.push("qualification decision");
          break;
        case "asset":
          parts.push(`${n.asset.kind} on this page`);
          break;
        case "pixel":
          parts.push("browser tracking");
          break;
        case "trigger":
          parts.push(`trigger of ${n.automation.name}`);
          if (n.automation.trigger.conditionText) parts.push(n.automation.trigger.conditionText);
          break;
        case "action":
          parts.push(n.action ? `action ${n.index + 1} of ${n.automation.name}` : `more actions of ${n.automation.name}`);
          break;
      }
      parts.push(EVIDENCE_LABEL[n.evidence]);
      return parts.filter(Boolean).join(", ");
    },
    []
  );

  /* ---------- rendering ---------- */

  const enter = entrance && !lite && !reduced && settled;
  const placeholderThumbs = lite || cam.zoom < THUMB_PLACEHOLDER_BELOW;

  const edgeViews = useMemo(
    () =>
      layout.edges
        .map((le) => {
          const e = edgeById.get(le.id);
          return e ? { ...le, e } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [layout.edges, edgeById]
  );

  return (
    <div className="absolute inset-0 overflow-hidden bg-plane">
      {/* screen-reader alternative: the funnel as a structured list */}
      <div className="sr-only">
        <h2>Funnel structure</h2>
        <ol>
          {model.columns.map((c) => (
            <li key={c.index}>
              {c.kind === "ad" ? "Traffic source" : c.kind === "decision" ? "Decision" : byId.get(c.headIds[1])?.label ?? "Step"}
              <ul>
                {layout.order
                  .filter((id) => layout.columnOf.get(id) === c.index)
                  .map((id) => {
                    const n = byId.get(id);
                    if (!n) return null;
                    const targets = outgoing.get(id)?.map((e) => `${edgeVerb(e)} ${byId.get(e.to)?.label ?? ""}${e.label ? ` (${e.label})` : ""}`);
                    return (
                      <li key={id}>
                        {nodeAriaLabel(n)}
                        {targets?.length ? ` — ${targets.join("; ")}` : ""}
                      </li>
                    );
                  })}
              </ul>
            </li>
          ))}
        </ol>
      </div>

      {/* The pan surface is a focusable group on purpose: it takes arrows / + / − / F
          itself and its aria-label says so. jsx-a11y cannot see that from the role. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={vp}
        {...camera.viewportHandlers}
        onKeyDown={canvasKeyDown}
        tabIndex={0}
        role="group"
        aria-label="Funnel canvas. Tab to reach nodes, up and down move within a step, left and right move between steps, Enter opens details. With the canvas itself focused, arrow keys pan and plus or minus zoom; F fits."
        className="absolute inset-0 outline-none"
        style={{
          cursor: drag ? "grabbing" : "grab",
          touchAction: "none",
          backgroundImage: "radial-gradient(var(--dot) 1.2px, transparent 1.6px)",
          backgroundSize: `${24 * cam.zoom}px ${24 * cam.zoom}px`,
          backgroundPosition: `${cam.panX}px ${cam.panY}px`,
          opacity: settled ? 1 : 0,
          transition: reduced ? "none" : "opacity .2s var(--ease-out)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: layout.w,
            height: layout.h,
            transform: `translate(${cam.panX}px, ${cam.panY}px) scale(${cam.zoom})`,
            transition: reduced ? "transform 0s" : camera.worldTransition,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          {/* edges */}
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ overflow: "visible" }} width={1} height={1}>
            {edgeViews.map(({ id, d, e }) => {
              const s = edgeStyle(e);
              return <path key={id} d={d} fill="none" stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} opacity={s.opacity} strokeLinecap="round" />;
            })}
          </svg>

          {/* edge label pills */}
          {!lite &&
            edgeViews
              .filter(({ e }) => e.label)
              .map(({ id, mx, my, e }) => {
                const accent = e.tone === "err" ? "var(--err)" : e.tone === "warn" ? "var(--warn)" : null;
                const text = e.tone === "err" ? "var(--err-text)" : e.tone === "warn" ? "var(--warn-text)" : "var(--t2)";
                return (
                  <div
                    key={`l${id}`}
                    className="pointer-events-none absolute w-max max-w-[160px] -translate-x-1/2 -translate-y-1/2 [overflow-wrap:anywhere] rounded-full border px-2 py-[2px] text-center text-[10px] font-semibold shadow-[var(--shadow-card)]"
                    style={{
                      left: mx,
                      top: my,
                      color: text,
                      borderColor: accent ? `color-mix(in srgb, ${accent} 40%, transparent)` : "var(--line)",
                      background: accent ? `color-mix(in srgb, ${accent} 12%, var(--pill))` : "var(--pill)",
                    }}
                  >
                    {e.validity !== "current" ? `! ${e.label}` : e.label}
                  </div>
                );
              })}

          {/* nodes */}
          {layout.order.map((id, i) => {
            const n = byId.get(id);
            const box = layout.boxes.get(id);
            if (!n || !box) return null;
            const selected = selectedId === id;
            const delay = enter ? `${(Math.min(i, 40) * 0.025).toFixed(3)}s` : "0s";
            return (
              <div
                key={id}
                ref={(el) => {
                  if (el) nodeEls.current.set(id, el);
                  else nodeEls.current.delete(id);
                }}
                onPointerDown={(e) => camera.nodeDown(e, id)}
                onPointerMove={camera.nodeMove}
                onPointerUp={(e) => {
                  const clicked = camera.nodeUp(e);
                  if (clicked) select(clicked);
                }}
                onKeyDown={(e) => nodeKeyDown(e, n)}
                onFocus={() => {
                  setFocusId(id);
                  const c = boxCenter(id);
                  if (c) camera.centerOn(c.x, c.y);
                }}
                role="button"
                tabIndex={tabTarget === id ? 0 : -1}
                aria-label={nodeAriaLabel(n)}
                aria-pressed={selected}
                className="absolute cursor-pointer outline-none transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:-translate-y-[1px] focus-visible:[&>*]:ring-2 focus-visible:[&>*]:ring-[var(--ringc)] focus-visible:[&>*]:ring-offset-2 focus-visible:[&>*]:ring-offset-[var(--plane)]"
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.w,
                  height: box.h,
                  touchAction: "none",
                  zIndex: selected ? 2 : 1,
                  animation: enter ? `fadeUp .3s var(--ease-out) ${delay} both` : undefined,
                }}
              >
                {n.kind === "page" ? (
                  <PageNode node={n} width={box.w} thumbH={n.lane === "branch" ? BRANCH_THUMB_H : THUMB_H} selected={selected} placeholder={placeholderThumbs} />
                ) : n.kind === "stage" ? (
                  <StageNode node={n} selected={selected} />
                ) : n.kind === "decision" ? (
                  <DecisionNode node={n} selected={selected} />
                ) : n.kind === "ad" ? (
                  <AdPlatformNode node={n} selected={selected} />
                ) : (
                  <CardNode node={n} selected={selected} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* zoom cluster — sibling of the pan surface so clicks always land */}
      <div onPointerDown={(e) => e.stopPropagation()} className="absolute bottom-3 right-3 z-[2] flex items-center gap-1 anim-fade-in" style={{ animationDelay: ".3s" }}>
        <IconBtn icon={Minus} label="Zoom out (−)" size={26} onClick={() => camera.zoomBy(0.83)} className="bg-glass backdrop-blur-[8px]" />
        <IconBtn icon={Plus} label="Zoom in (+)" size={26} onClick={() => camera.zoomBy(1.2)} className="bg-glass backdrop-blur-[8px]" />
        <IconBtn icon={Maximize2} label="Fit to view (F)" size={26} onClick={camera.fit} className="bg-glass backdrop-blur-[8px]" />
      </div>
    </div>
  );
}

/** Stroke per edge kind — must match MartechLegend. */
function edgeStyle(e: MartechEdge): { stroke: string; width: number; dash?: string; opacity: number } {
  if (e.validity !== "current") return { stroke: "var(--err)", width: 1.5, dash: "6 6", opacity: 0.9 };
  if (e.evidence === "not-captured" || e.kind === "inferred") return { stroke: "var(--t3)", width: 1.5, dash: "4 4", opacity: 0.7 };
  switch (e.kind) {
    case "conversion-report":
      return { stroke: "var(--warn)", width: 1.5, dash: "7 6", opacity: 0.9 };
    case "shared-asset":
      return { stroke: "var(--t3)", width: 1.5, dash: "2 5", opacity: 0.8 };
    case "fires-on":
      return { stroke: "var(--t3)", width: 1.5, dash: "2 4", opacity: 0.9 };
    case "branch":
      return { stroke: e.tone === "err" ? "var(--err)" : "var(--edge)", width: 1.75, opacity: 1 };
    case "spine":
      return { stroke: "var(--edge)", width: 1.75, opacity: 1 };
    default:
      // stem / automation
      return { stroke: "var(--edge)", width: 1.5, opacity: 1 };
  }
}

function edgeVerb(e: MartechEdge): string {
  switch (e.kind) {
    case "spine":
      return "then";
    case "branch":
      return "branches to";
    case "fires-on":
      return "triggers";
    case "automation":
      return "then";
    case "conversion-report":
      return "reports to";
    case "shared-asset":
      return "same asset as";
    case "inferred":
      return "sends traffic to";
    default:
      return "leads to";
  }
}
