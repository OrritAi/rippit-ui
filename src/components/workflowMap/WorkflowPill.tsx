"use client";

import {
  memo,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { AppPuck } from "@/components/shared/AppPuck";
import { pillChip } from "@/lib/workflowMap/model";
import { runAria, type RunState } from "@/lib/workflowMap/run";
import { PILL_NAME_MAX_W } from "@/lib/workflowMap/tokens";
import type { MapNode } from "@/lib/workflowMap/types";
import { MapTip } from "./MapTip";
import { NodeLinkButton, RippitLinkButton } from "./NodeLinkButton";
import type { RefCallback } from "./useMapMeasure";
import type { TreeItemProps } from "./useMapKeyboard";

/*
 * Workflow pill — a root caller or an attached workflow preview. Three
 * distinct controls, siblings inside one capsule (no nested interactives):
 *   body  (role=treeitem)  → select: sidebar + centre
 *   chip  (button)         → expand / collapse the flow ("+ 3 nodes" / "− fold")
 *   ↗     (link)           → open the workflow on its platform
 * The capsule element carries the measure ref (edges leave from its right
 * edge) and the tint. Connected pills wear the accent — a faint tint at rest
 * (6 % bg / 28 % border), stronger when open (7 % / 35 %) and selected
 * (55 %) — and carry a second control, "Open in Rippit". The VIEWED
 * workflow's pill (every copy of it) is the map's start state, drawn like an
 * FSM start node: solid `--text` fill, name and chip in `--bg`, and a double
 * ring (`0 0 0 2px --bg, 0 0 0 4px --text`; accent + glow when selected).
 * The wrapper gets 4px of margin so the ring never clips; the capsule is
 * still the measured element, so edges attach exactly as before. It also
 * carries aria-current and an "(viewing)" aria-label suffix.
 * Steps stay on the plain card surface; the mono meta line hangs under it.
 * Run replay: `run` lands as `data-run` on the capsule (the measured element,
 * which also carries `data-pair`) — "reached" for a pill under a step the
 * run went through, "untouched" under a step it never reached — and the
 * aria-label says so. A related workflow's own run (`runMeta`, "ran 2h ago
 * · failed") joins the meta line under the capsule and the aria-label; the
 * line wraps within the pill's width and never truncates.
 */
const stop = (e: MouseEvent | PointerEvent) => e.stopPropagation();
const baseLabel = (node: MapNode) => (node.isViewed ? `${node.name} (viewing)` : node.name);

export const WorkflowPill = memo(function WorkflowPill({
  node,
  selected,
  itemProps,
  nodeRef,
  onClick,
  onToggle,
  far = false,
  pair = null,
  run = null,
  runMeta = null,
}: {
  node: MapNode;
  selected: boolean;
  itemProps: TreeItemProps;
  nodeRef: RefCallback;
  onClick: (node: MapNode) => void;
  onToggle: (node: MapNode) => void;
  /** Zoomed out: hide the meta line. */
  far?: boolean;
  /** Pairing focus attributes (class + data-pulse + data-pair) or null. */
  pair?: { className: string; "data-pulse": string; "data-pair": "source" | "target" } | null;
  /** State in the replayed run (lib/workflowMap/run.ts), or null. */
  run?: RunState | null;
  /** This workflow's own run related to the replayed one ("ran 2h ago · failed"), or null. */
  runMeta?: string | null;
}) {
  const p = node.pill;
  const ariaLabel = [baseLabel(node), runAria(run), runMeta].filter(Boolean).join(" — ");
  const meta = [node.meta, runMeta].filter(Boolean).join(" · ");
  const tip = (el: ReactElement) => (run === "unknown" ? <MapTip label="Not checked in this run">{el}</MapTip> : el);
  const open = !!p?.open;
  const full = pillChip(node);
  /* Far mode: the name stays, the chip shrinks to a glyph, the meta hides. */
  const chip =
    !far || !full
      ? full
      : p?.cycle
        ? "↺"
        : p?.unavailable || p?.error
          ? "!"
          : p?.loading
            ? "↻"
            : open
              ? "−"
              : "+";
  const canToggle = !!p && !p.pinned && !p.cycle && !p.unavailable && !p.error;
  const viewed = !!node.isViewed;
  const tinted = open || selected;
  const borderColor = viewed
    ? "var(--text)"
    : selected
      ? "color-mix(in srgb, var(--map-accent) 55%, transparent)"
      : open
        ? "color-mix(in srgb, var(--map-accent) 35%, transparent)"
        : "color-mix(in srgb, var(--map-accent) 28%, transparent)";
  const background = viewed
    ? "var(--text)"
    : tinted
      ? "color-mix(in srgb, var(--map-accent) 7%, var(--pill))"
      : "color-mix(in srgb, var(--map-accent) 6%, var(--pill))";
  const chipOpen = open && canToggle && !p?.loading && !viewed;
  /* The start-state rings; selected swaps the outer ring for the accent + glow. */
  const ring = viewed
    ? selected
      ? "0 0 0 2px var(--bg), 0 0 0 4px var(--map-accent), 0 0 16px color-mix(in srgb, var(--map-accent) 45%, transparent)"
      : "0 0 0 2px var(--bg), 0 0 0 4px var(--text)"
    : undefined;
  /* Written out literally (not spread) so jsx-a11y can see the role, focus and key handling. */
  const {
    tabIndex,
    onKeyDown,
    onFocus,
    "aria-level": ariaLevel,
    "aria-selected": ariaSelected,
    "aria-expanded": ariaExpanded,
  } = itemProps;

  return (
    <div className={`flex flex-none flex-col gap-1.5 ${viewed ? "m-1" : ""}`}>
      <div
        ref={nodeRef}
        data-node-id={node.id}
        data-pair={pair?.["data-pair"]}
        data-pulse={pair?.["data-pulse"]}
        data-run={run ?? undefined}
        className={`${pair ? "wm-pair " : ""}pointer-events-auto flex min-h-10 flex-none items-center gap-[9px] rounded-full border border-[var(--pill-border)] bg-pill py-1.5 pl-[9px] pr-1.5 shadow-[var(--shadow-card)] transition-[border-color,background,transform,box-shadow] duration-[220ms] ease-[var(--ease-out)] hover:-translate-y-[2px] ${viewed ? "text-bg" : "text-t1 hover:border-line-strong"}`}
        style={
          {
            "--pill-border": borderColor,
            background,
            boxShadow: ring,
          } as CSSProperties
        }
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
            aria-current={viewed ? "true" : undefined}
            title={node.desc}
            aria-label={ariaLabel}
            onClick={() => onClick(node)}
            className="flex min-w-0 cursor-pointer select-none items-center gap-[9px] rounded-full text-left"
          >
            <span className="relative flex flex-none">
              <AppPuck app={node.app} size={24} />
              {node.status && (
                <span
                  aria-hidden="true"
                  className={`absolute -bottom-px -right-px size-1.5 rounded-full border border-pill ${node.status === "ok" ? "bg-ok" : "bg-off"}`}
                  style={
                    node.status === "ok"
                      ? { animation: "blinkdot 1.6s ease-in-out infinite" }
                      : undefined
                  }
                />
              )}
              {node.status && (
                <span className="sr-only">
                  {node.status === "ok" ? "active" : "paused"}
                </span>
              )}
            </span>
            <span
              className={`text-[12.5px] font-semibold leading-[1.25] [overflow-wrap:anywhere] ${viewed ? `text-bg ${node.hit ? "underline decoration-map-accent decoration-2 underline-offset-2" : ""}` : node.hit ? "text-map-accent-text" : "text-t1"}`}
              style={{ maxWidth: PILL_NAME_MAX_W }}
            >
              {node.name}
            </span>
          </div>,
        )}
        {chip &&
          (canToggle ? (
            <MapTip label={open ? "Collapse" : "Expand"}>
              <button
                type="button"
                aria-expanded={open}
                aria-label={
                  open ? `Collapse ${node.name}` : `Expand ${node.name}`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(node);
                }}
                onPointerDown={stop}
                className={`flex-none cursor-pointer whitespace-nowrap rounded-full border px-[7px] py-px font-mono text-[9.5px] transition-colors duration-200 ${chipOpen ? "text-map-accent-text hover:border-line-strong" : viewed ? "text-bg" : "border-line-strong text-t2 hover:border-line-strong"}`}
                style={
                  chipOpen
                    ? {
                        borderColor:
                          "color-mix(in srgb, var(--map-accent) 40%, transparent)",
                      }
                    : viewed
                      ? {
                          borderColor:
                            "color-mix(in srgb, var(--bg) 45%, transparent)",
                        }
                      : undefined
                }
              >
                {chip}
              </button>
            </MapTip>
          ) : (
            <span className="flex-none whitespace-nowrap rounded-full border border-line-strong px-[7px] py-px font-mono text-[9.5px] text-t2">
              {chip}
            </span>
          ))}
        <RippitLinkButton node={node} />
        <NodeLinkButton node={node} />
      </div>
      {meta && !far && (
        <div
          className="pl-3 font-mono text-[10px] text-t3 [overflow-wrap:anywhere]"
          style={{ maxWidth: PILL_NAME_MAX_W + 60 }}
        >
          {meta}
        </div>
      )}
    </div>
  );
});
